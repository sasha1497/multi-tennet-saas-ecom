import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES, adminUrl } from '@retailos/config';
import { NotificationTemplate, type NotificationChannel } from '@retailos/types';
import { AppConfigService } from '@/config/config.module';
import { RequestContextService, createRequestContext } from '@/core/context/request-context';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { AppLogger } from '@/core/logger/logger.service';
import { NotificationsService } from '@/modules/notifications/notifications.service';
import type {
  LowStockAlertJob,
  NotifyJob,
  OrderPlacedJob,
  OrderStatusChangedJob,
} from '@/core/queue/queue.types';

/** Which order statuses are worth telling a customer about. */
const CUSTOMER_STATUS_TEMPLATES: Record<string, string> = {
  CONFIRMED: NotificationTemplate.ORDER_CONFIRMED,
  SHIPPED: NotificationTemplate.ORDER_SHIPPED,
  OUT_FOR_DELIVERY: NotificationTemplate.ORDER_OUT_FOR_DELIVERY,
  DELIVERED: NotificationTemplate.ORDER_DELIVERED,
  CANCELLED: NotificationTemplate.ORDER_CANCELLED,
};

/**
 * Notification worker.
 *
 * Runs in the **worker process**, not the API. That separation is the point of
 * requirement §13: a slow SMTP handshake or a flaky push provider degrades a
 * background queue, never a shopper's checkout response.
 *
 * Because AsyncLocalStorage does not survive the hop through Redis, each handler
 * re-establishes a request context from the job payload so log lines still carry
 * tenant and request ids and can be traced back to the originating HTTP call.
 */
@Processor(QUEUE_NAMES.NOTIFICATIONS, { concurrency: 5 })
export class NotificationsProcessor extends WorkerHost {
  private readonly logger: AppLogger;

  constructor(
    private readonly notifications: NotificationsService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly master: MasterPrismaService,
    private readonly context: RequestContextService,
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    super();
    this.logger = logger.withContext('NotificationsWorker');
  }

  async process(job: Job): Promise<void> {
    const data = job.data as { tenantId?: string; requestId?: string };

    await this.context.run(
      createRequestContext({
        requestId: data.requestId ?? `job:${job.id}`,
        method: 'JOB',
        path: `${job.queueName}/${job.name}`,
      }),
      async () => {
        switch (job.name) {
          case JOB_NAMES.ORDER_PLACED:
            return this.handleOrderPlaced(job.data as OrderPlacedJob);
          case JOB_NAMES.ORDER_STATUS_CHANGED:
            return this.handleStatusChanged(job.data as OrderStatusChangedJob);
          case JOB_NAMES.LOW_STOCK_ALERT:
            return this.handleLowStock(job.data as LowStockAlertJob);
          case JOB_NAMES.SEND_EMAIL:
            return this.handleGeneric(job.data as NotifyJob);
          default:
            this.logger.warn('Unknown notification job', { name: job.name });
        }
      },
    );
  }

  /** Order placed: receipt to the customer, alert to the merchant. */
  private async handleOrderPlaced(data: OrderPlacedJob): Promise<void> {
    const order = await this.tenantDb.runFor(data.tenantId, (db) =>
      db.order.findUnique({
        where: { id: data.orderId },
        include: { items: { select: { id: true } } },
      }),
    );
    if (!order) return;

    await this.notifications.deliver({
      tenantId: data.tenantId,
      template: NotificationTemplate.ORDER_PLACED,
      channels: ['EMAIL', 'IN_APP', 'PUSH'],
      email: order.customerEmail,
      phone: order.customerPhone,
      customerId: order.customerId,
      data: {
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        total: order.totalAmount,
        paymentMethod: order.paymentMethod,
        itemCount: order.items.length,
      },
    });

    // The merchant needs to know too — otherwise nobody packs the box.
    const owner = await this.master.tenant.findUnique({
      where: { id: data.tenantId },
      select: { contactEmail: true },
    });

    if (owner?.contactEmail) {
      await this.notifications.deliver({
        tenantId: data.tenantId,
        template: NotificationTemplate.NEW_ORDER_MERCHANT,
        channels: ['EMAIL'],
        email: owner.contactEmail,
        data: {
          orderNumber: order.orderNumber,
          customerName: order.customerName,
          total: order.totalAmount,
          itemCount: order.items.length,
          paymentMethod: order.paymentMethod,
          consoleUrl: `${adminUrl(this.config.domain)}/orders/${order.id}`,
        },
      });
    }
  }

  private async handleStatusChanged(data: OrderStatusChangedJob): Promise<void> {
    const template = CUSTOMER_STATUS_TEMPLATES[data.toStatus];
    if (!template) return; // e.g. PROCESSING is internal-only.

    const order = await this.tenantDb.runFor(data.tenantId, (db) =>
      db.order.findUnique({ where: { id: data.orderId } }),
    );
    if (!order) return;

    const channels: NotificationChannel[] = ['EMAIL', 'IN_APP', 'PUSH'];
    // Out-for-delivery is the one update worth an SMS: it is time-sensitive.
    if (data.toStatus === 'OUT_FOR_DELIVERY') channels.push('SMS');

    await this.notifications.deliver({
      tenantId: data.tenantId,
      template,
      channels,
      email: order.customerEmail,
      phone: order.customerPhone,
      customerId: order.customerId,
      data: {
        orderNumber: order.orderNumber,
        customerName: order.customerName,
        total: order.totalAmount,
        reason: order.cancellationReason,
      },
    });
  }

  private async handleLowStock(data: LowStockAlertJob): Promise<void> {
    const [tenant, items] = await Promise.all([
      this.master.tenant.findUnique({
        where: { id: data.tenantId },
        select: { contactEmail: true },
      }),
      this.tenantDb.runFor(data.tenantId, (db) =>
        db.inventory.findMany({
          where: { variantId: { in: data.variantIds } },
          include: { variant: { include: { product: { select: { name: true } } } } },
        }),
      ),
    ]);

    if (!tenant?.contactEmail || items.length === 0) return;

    await this.notifications.deliver({
      tenantId: data.tenantId,
      template: NotificationTemplate.LOW_STOCK_ALERT,
      channels: ['EMAIL'],
      email: tenant.contactEmail,
      data: {
        itemCount: items.length,
        consoleUrl: `${adminUrl(this.config.domain)}/inventory`,
        items: items.map((i) => ({
          name: i.variant.product.name,
          sku: i.variant.sku,
          available: Math.max(0, i.quantity - i.reserved),
        })),
      },
    });
  }

  private async handleGeneric(data: NotifyJob): Promise<void> {
    if (!data.tenantId) return;
    await this.notifications.deliver({
      tenantId: data.tenantId,
      template: data.template,
      channels: data.channels ?? ['EMAIL'],
      email: data.email ?? null,
      phone: data.phone ?? null,
      customerId: data.customerId ?? null,
      data: data.data ?? {},
    });
  }
}
