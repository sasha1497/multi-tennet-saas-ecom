import { Global, Injectable, Module } from '@nestjs/common';
import type { AuditAction } from '@retailos/types';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { RequestContextService } from '@/core/context/request-context';
import { AppLogger } from '@/core/logger/logger.service';

export interface AuditEntry {
  action: AuditAction | string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  /** Overrides the tenant from context — used by platform-level events. */
  tenantId?: string | null;
  tenantSlug?: string | null;
  userId?: string | null;
  userEmail?: string | null;
}

/**
 * Audit logging, split the same way the data is:
 *
 *   • **platform events** (tenant created, suspended, plan changed, admin login)
 *     go to the master DB, where the platform console can query across tenants
 *   • **tenant events** (product updated, order status changed, stock adjusted)
 *     go to the tenant's own database, so a merchant's audit trail moves with
 *     their data and is never visible to another tenant
 *
 * Writes are fire-and-forget: an audit failure logs loudly but never fails the
 * business operation that triggered it.
 */
@Injectable()
export class AuditService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly context: RequestContextService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('Audit');
  }

  /** Records a platform-level event in the master database. */
  async platform(entry: AuditEntry): Promise<void> {
    const ctx = this.context.get();
    try {
      await this.master.platformAuditLog.create({
        data: {
          tenantId: entry.tenantId ?? ctx?.tenant?.tenantId ?? null,
          tenantSlug: entry.tenantSlug ?? ctx?.tenant?.slug ?? null,
          userId: entry.userId ?? ctx?.auth?.userId ?? null,
          userEmail: entry.userEmail ?? ctx?.auth?.email ?? null,
          action: entry.action,
          resourceType: entry.resourceType ?? null,
          resourceId: entry.resourceId ?? null,
          ipAddress: ctx?.ip ?? null,
          userAgent: ctx?.userAgent ?? null,
          requestId: ctx?.requestId ?? null,
          metadata: (entry.metadata ?? null) as never,
        },
      });
    } catch (err) {
      this.logger.error('Failed to write platform audit log', err as Error, {
        action: entry.action,
      });
    }
  }

  /** Records a tenant-scoped event inside that tenant's own database. */
  async tenant(entry: AuditEntry): Promise<void> {
    const ctx = this.context.get();
    const tenantId = entry.tenantId ?? ctx?.tenant?.tenantId;
    if (!tenantId) {
      this.logger.warn('Tenant audit entry dropped: no tenant in context', {
        action: entry.action,
      });
      return;
    }

    const actorType = ctx?.auth?.audience === 'customer' ? 'CUSTOMER' : ctx?.auth ? 'STAFF' : 'SYSTEM';

    try {
      await this.tenantDb.runFor(tenantId, (db) =>
        db.tenantAuditLog.create({
          data: {
            actorId: entry.userId ?? ctx?.auth?.userId ?? null,
            actorType,
            actorEmail: entry.userEmail ?? ctx?.auth?.email ?? null,
            action: entry.action,
            resourceType: entry.resourceType ?? null,
            resourceId: entry.resourceId ?? null,
            requestId: ctx?.requestId ?? null,
            ipAddress: ctx?.ip ?? null,
            metadata: (entry.metadata ?? null) as never,
          },
        }),
      );
    } catch (err) {
      this.logger.error('Failed to write tenant audit log', err as Error, {
        tenantId,
        action: entry.action,
      });
    }
  }

  /**
   * Writes to both ledgers. Used for events a merchant must see in their own
   * trail *and* the platform must see fleet-wide, such as staff changes.
   */
  async both(entry: AuditEntry): Promise<void> {
    await Promise.all([this.platform(entry), this.tenant(entry)]);
  }

  /**
   * Fire-and-forget wrapper.
   *
   * Audit writes should never add latency to the request that caused them, and
   * they must never turn a successful write into a 500.
   */
  record(scope: 'platform' | 'tenant' | 'both', entry: AuditEntry): void {
    const run =
      scope === 'platform' ? this.platform(entry) : scope === 'tenant' ? this.tenant(entry) : this.both(entry);
    void run.catch((err) =>
      this.logger.error('Audit write rejected', err as Error, { action: entry.action }),
    );
  }
}

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
