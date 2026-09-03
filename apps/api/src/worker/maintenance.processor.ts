import { Injectable } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Cron, CronExpression } from '@nestjs/schedule';
import type { Job } from 'bullmq';
import { QUEUE_NAMES, STOCK_RESERVATION_TTL_MINUTES } from '@retailos/config';
import { RequestContextService, createRequestContext } from '@/core/context/request-context';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { AppLogger } from '@/core/logger/logger.service';
import { OrdersService } from '@/modules/orders/orders.service';

/**
 * Housekeeping that keeps the system honest over time.
 *
 * These are the jobs whose absence you only notice weeks in: abandoned carts
 * holding the last unit of stock, a session table that never shrinks, platform
 * dashboards quoting month-old numbers.
 *
 * Scheduled with `@nestjs/schedule` in the worker process only — running them in
 * every API replica would multiply the work by the replica count.
 */
@Injectable()
@Processor(QUEUE_NAMES.MAINTENANCE, { concurrency: 1 })
export class MaintenanceProcessor extends WorkerHost {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly orders: OrdersService,
    private readonly context: RequestContextService,
    logger: AppLogger,
  ) {
    super();
    this.logger = logger.withContext('MaintenanceWorker');
  }

  async process(job: Job): Promise<void> {
    await this.context.run(
      createRequestContext({ requestId: `job:${job.id}`, method: 'JOB', path: job.name }),
      async () => {
        switch (job.name) {
          case 'release-stale-reservations':
            return this.releaseStaleReservations();
          case 'refresh-tenant-stats':
            return this.refreshTenantStats();
          case 'prune-expired-sessions':
            return this.pruneExpiredSessions();
          case 'prune-expired-carts':
            return this.pruneExpiredCarts();
          default:
            this.logger.warn('Unknown maintenance job', { name: job.name });
        }
      },
    );
  }

  /**
   * Frees stock held by checkouts that were never paid.
   *
   * Without this, one abandoned card payment holds the last pair of shoes
   * forever and the merchant loses a sale they never knew about.
   */
  @Cron(CronExpression.EVERY_5_MINUTES, { name: 'release-stale-reservations' })
  async releaseStaleReservations(): Promise<void> {
    const tenants = await this.activeTenantIds();
    let released = 0;

    for (const tenantId of tenants) {
      try {
        released += await this.orders.releaseStaleReservations(
          tenantId,
          STOCK_RESERVATION_TTL_MINUTES,
        );
      } catch (err) {
        this.logger.error('Failed to release reservations', err as Error, { tenantId });
      }
    }

    if (released > 0) this.logger.info('Released stale reservations', { released });
  }

  /**
   * Refreshes the denormalised per-tenant counters the platform console reads.
   *
   * Sequential across tenants on purpose: opening 200 tenant connections at once
   * to build a dashboard would be a self-inflicted outage.
   */
  @Cron(CronExpression.EVERY_HOUR, { name: 'refresh-tenant-stats' })
  async refreshTenantStats(): Promise<void> {
    const tenants = await this.activeTenantIds();
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    let updated = 0;

    for (const tenantId of tenants) {
      try {
        const stats = await this.tenantDb.runFor(tenantId, async (db) => {
          const [products, orders, customers, revenue] = await Promise.all([
            db.product.count({ where: { deletedAt: null } }),
            db.order.count(),
            db.customer.count({ where: { deletedAt: null } }),
            db.order.aggregate({
              where: {
                placedAt: { gte: monthStart },
                status: {
                  in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'],
                },
              },
              _sum: { totalAmount: true },
            }),
          ]);
          return { products, orders, customers, revenue: revenue._sum.totalAmount ?? 0 };
        });

        await this.master.tenant.update({
          where: { id: tenantId },
          data: {
            statProducts: stats.products,
            statOrders: stats.orders,
            statCustomers: stats.customers,
            statRevenue: BigInt(stats.revenue),
            statsUpdatedAt: new Date(),
          },
        });
        updated++;
      } catch (err) {
        this.logger.warn('Failed to refresh tenant stats', {
          tenantId,
          error: (err as Error).message,
        });
      }
    }

    this.logger.info('Refreshed tenant stats', { updated, total: tenants.length });
  }

  /** Expired and revoked sessions have no value and grow without bound. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'prune-expired-sessions' })
  async pruneExpiredSessions(): Promise<void> {
    const cutoff = new Date(Date.now() - 7 * 86_400_000);

    const master = await this.master.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] },
    });

    await this.master.verificationToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });

    let tenantSessions = 0;
    for (const tenantId of await this.activeTenantIds()) {
      try {
        const result = await this.tenantDb.runFor(tenantId, (db) =>
          db.customerSession.deleteMany({
            where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] },
          }),
        );
        tenantSessions += result.count;
      } catch {
        // A single unreachable tenant must not abort the sweep.
      }
    }

    this.logger.info('Pruned expired sessions', {
      masterSessions: master.count,
      tenantSessions,
    });
  }

  /** Guest carts expire; without pruning they accumulate indefinitely. */
  @Cron(CronExpression.EVERY_DAY_AT_4AM, { name: 'prune-expired-carts' })
  async pruneExpiredCarts(): Promise<void> {
    let removed = 0;
    for (const tenantId of await this.activeTenantIds()) {
      try {
        const result = await this.tenantDb.runFor(tenantId, (db) =>
          db.cart.deleteMany({
            where: { expiresAt: { lt: new Date() }, customerId: null },
          }),
        );
        removed += result.count;
      } catch {
        // Skip unreachable tenants.
      }
    }
    if (removed > 0) this.logger.info('Pruned expired guest carts', { removed });
  }

  private async activeTenantIds(): Promise<string[]> {
    const rows = await this.master.tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null, database: { status: 'READY' } },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }
}
