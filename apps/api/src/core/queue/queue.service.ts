import { Injectable } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue, type JobsOptions } from 'bullmq';
import { JOB_NAMES, QUEUE_NAMES } from '@retailos/config';
import type { QueueStats } from '@retailos/types';
import { AppConfigService } from '@/config/config.module';
import { RequestContextService } from '@/core/context/request-context';
import { AppLogger } from '@/core/logger/logger.service';
import type {
  DeprovisionTenantJob,
  GenerateReportJob,
  LowStockAlertJob,
  MaintenanceJob,
  NotifyJob,
  OrderPlacedJob,
  OrderStatusChangedJob,
  ProcessImageJob,
  ProvisionTenantJob,
  SendEmailJob,
} from './queue.types';

/**
 * The only way application code puts work on a queue.
 *
 * Requirement §13: the API must not do expensive work synchronously. Anything
 * that talks to an external provider (email, SMS, push), touches many rows
 * (reports), or can take seconds (tenant provisioning, image processing) is
 * enqueued here and handled by the separate worker process.
 *
 * Enqueue failures are logged and swallowed for *notifications* — a merchant's
 * order must still succeed if the mail queue is briefly unreachable — but
 * rethrown for provisioning, where losing the job means a tenant is stuck.
 */
@Injectable()
export class QueueService {
  private readonly logger: AppLogger;

  constructor(
    @InjectQueue(QUEUE_NAMES.NOTIFICATIONS) private readonly notifications: Queue,
    @InjectQueue(QUEUE_NAMES.PROVISIONING) private readonly provisioning: Queue,
    @InjectQueue(QUEUE_NAMES.IMAGES) private readonly images: Queue,
    @InjectQueue(QUEUE_NAMES.REPORTS) private readonly reports: Queue,
    @InjectQueue(QUEUE_NAMES.MAINTENANCE) private readonly maintenance: Queue,
    private readonly config: AppConfigService,
    private readonly context: RequestContextService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('QueueService');
  }

  private base<T extends object>(data: T): T & { enqueuedAt: string; requestId?: string } {
    return { ...data, enqueuedAt: new Date().toISOString(), requestId: this.context.requestId };
  }

  private get defaultOptions(): JobsOptions {
    return {
      attempts: this.config.queue.attempts,
      backoff: { type: 'exponential', delay: this.config.queue.backoffMs },
      // Keep a short history so the ops page can show recent failures without
      // letting Redis grow unbounded.
      removeOnComplete: { age: 3600, count: 500 },
      removeOnFail: { age: 86_400, count: 1000 },
    };
  }

  // ------------------------------------------------------- notifications --

  async sendEmail(data: Omit<SendEmailJob, 'enqueuedAt'>): Promise<void> {
    await this.enqueueSafely(this.notifications, JOB_NAMES.SEND_EMAIL, this.base(data));
  }

  /** High-level: renders a template and fans out across the given channels. */
  async notify(data: Omit<NotifyJob, 'enqueuedAt'>): Promise<void> {
    await this.enqueueSafely(this.notifications, JOB_NAMES.SEND_EMAIL, this.base(data), {
      // Notifications are best-effort; do not retry forever on a bad address.
      attempts: 3,
    });
  }

  async orderPlaced(data: Omit<OrderPlacedJob, 'enqueuedAt'>): Promise<void> {
    await this.enqueueSafely(this.notifications, JOB_NAMES.ORDER_PLACED, this.base(data));
  }

  async orderStatusChanged(data: Omit<OrderStatusChangedJob, 'enqueuedAt'>): Promise<void> {
    await this.enqueueSafely(this.notifications, JOB_NAMES.ORDER_STATUS_CHANGED, this.base(data));
  }

  async lowStockAlert(data: Omit<LowStockAlertJob, 'enqueuedAt'>): Promise<void> {
    await this.enqueueSafely(this.notifications, JOB_NAMES.LOW_STOCK_ALERT, this.base(data), {
      // One alert per tenant per hour, no matter how many SKUs trip it.
      jobId: `low-stock:${data.tenantId}:${new Date().toISOString().slice(0, 13)}`,
      attempts: 2,
    });
  }

  // --------------------------------------------------------- provisioning --

  /**
   * Queues tenant provisioning. Unlike notifications this rethrows: a lost
   * provisioning job leaves a merchant staring at "setting up your store".
   *
   * `jobId` is the idempotency key, so BullMQ itself de-duplicates a double
   * submit before our own idempotent runner ever sees it.
   */
  async provisionTenant(data: Omit<ProvisionTenantJob, 'enqueuedAt'>): Promise<void> {
    await this.provisioning.add(JOB_NAMES.PROVISION_TENANT, this.base(data), {
      ...this.defaultOptions,
      jobId: data.idempotencyKey,
      attempts: 5,
      backoff: { type: 'exponential', delay: 10_000 },
    });
    this.logger.info('Queued tenant provisioning', { tenantId: data.tenantId });
  }

  async deprovisionTenant(data: Omit<DeprovisionTenantJob, 'enqueuedAt'>): Promise<void> {
    await this.provisioning.add(JOB_NAMES.DEPROVISION_TENANT, this.base(data), {
      ...this.defaultOptions,
      jobId: `deprovision:${data.tenantId}`,
      // Deliberate delay: a mistaken deletion can still be cancelled.
      delay: 60_000,
      attempts: 3,
    });
    this.logger.warn('Queued tenant deprovisioning', { tenantId: data.tenantId });
  }

  // -------------------------------------------------------- images/reports --

  async processImage(data: Omit<ProcessImageJob, 'enqueuedAt'>): Promise<void> {
    await this.enqueueSafely(this.images, JOB_NAMES.PROCESS_IMAGE, this.base(data));
  }

  async generateReport(data: Omit<GenerateReportJob, 'enqueuedAt'>): Promise<void> {
    await this.enqueueSafely(this.reports, JOB_NAMES.GENERATE_REPORT, this.base(data));
  }

  async maintenance_(data: Omit<MaintenanceJob, 'enqueuedAt'>): Promise<void> {
    await this.enqueueSafely(this.maintenance, data.task, this.base(data));
  }

  // ------------------------------------------------------------- ops views --

  async stats(): Promise<QueueStats[]> {
    const queues: [string, Queue][] = [
      [QUEUE_NAMES.NOTIFICATIONS, this.notifications],
      [QUEUE_NAMES.PROVISIONING, this.provisioning],
      [QUEUE_NAMES.IMAGES, this.images],
      [QUEUE_NAMES.REPORTS, this.reports],
      [QUEUE_NAMES.MAINTENANCE, this.maintenance],
    ];

    return Promise.all(
      queues.map(async ([name, queue]) => {
        try {
          const counts = await queue.getJobCounts(
            'waiting',
            'active',
            'completed',
            'failed',
            'delayed',
          );
          return {
            name,
            waiting: counts.waiting ?? 0,
            active: counts.active ?? 0,
            completed: counts.completed ?? 0,
            failed: counts.failed ?? 0,
            delayed: counts.delayed ?? 0,
            paused: await queue.isPaused(),
          };
        } catch {
          return {
            name,
            waiting: 0,
            active: 0,
            completed: 0,
            failed: 0,
            delayed: 0,
            paused: false,
          };
        }
      }),
    );
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.notifications.getJobCounts('waiting');
      return true;
    } catch {
      return false;
    }
  }

  private async enqueueSafely(
    queue: Queue,
    name: string,
    data: object,
    options: JobsOptions = {},
  ): Promise<void> {
    try {
      await queue.add(name, data, { ...this.defaultOptions, ...options });
    } catch (err) {
      // Losing a notification is regrettable; failing the customer's order
      // because the mail queue hiccuped is not acceptable.
      this.logger.error('Failed to enqueue job', err as Error, { queue: queue.name, job: name });
    }
  }
}
