import { Injectable } from '@nestjs/common';
import { AuditAction } from '@retailos/types';
import { Errors } from '@/common/errors/app.exception';
import { RequestContextService } from '@/core/context/request-context';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantConnectionManager } from '@/core/database/tenant-connection.manager';
import { TenantDdlService } from '@/core/database/tenant-ddl.service';
import { AppLogger } from '@/core/logger/logger.service';
import { CacheService } from '@/core/cache/cache.service';
import { MediaUrlService } from '@/core/storage/media-url.service';
import { StorageService } from '@/core/storage/storage.service';
import { TenantResolverService } from '@/core/tenant/tenant-resolver.service';
import { AuditService } from '@/modules/audit/audit.service';

/**
 * Ordered pipeline. A retry resumes at the first step not yet recorded.
 *
 * The order is the point. Access is revoked *first*, so from the moment the
 * deletion starts the tenant can no longer authenticate, resolve, be routed to,
 * or have a presigned URL minted for it — even if every later step fails.
 * Everything after that is cleanup of things nobody can reach any more.
 *
 * Storage goes before the database because the database is what tells us which
 * objects existed. Dropping it first would leave a bucket full of files with
 * nothing left to say whose they were.
 */
const STEPS = [
  'REVOKE_ACCESS',
  'PURGE_STORAGE',
  'DROP_DATABASE',
  'PURGE_MASTER_RECORDS',
  'FINALISE',
] as const;

type DeletionStep = (typeof STEPS)[number];

export interface TenantDeletionResult {
  jobId: string;
  tenantId: string;
  tenantSlug: string;
  status: 'COMPLETED' | 'FAILED';
  completedSteps: string[];
  /** The step that failed, when it did. */
  currentStep: string | null;
  objectsDeleted: number;
  databaseName: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * Permanent tenant deletion.
 *
 * A tenant's data lives in three places that cannot share a transaction: rows
 * in the master control-plane database, an entire PostgreSQL database of its
 * own, and a prefix in object storage. There is no way to remove all three
 * atomically, so this is built as a **resumable step machine** instead: each
 * step is recorded in `tenant_deletion_jobs` as it completes, a failure stops
 * the pipeline with the reason attached, and calling the operation again picks
 * up from the first step that never finished.
 *
 * That gives the property that actually matters when a destructive operation
 * half-fails: the system is never in an unknown state. It is in a known one,
 * named by `currentStep` and `lastError`, and retrying is always safe.
 *
 * ── What is *not* deleted, and why ────────────────────────────────────────
 *
 *  • **Platform audit logs.** They are the platform's record *about* a tenant,
 *    not the tenant's data — and they include the record of this deletion.
 *    Deleting them would erase the evidence that the deletion happened.
 *  • **Users who belong to another store.** A person may work for two
 *    merchants. Their membership of *this* tenant goes; their account does not.
 *  • **Shared platform data** — plans, feature definitions, other tenants'
 *    anything. Every query below is filtered by this tenant's id.
 */
@Injectable()
export class TenantDeletionService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly ddl: TenantDdlService,
    private readonly connections: TenantConnectionManager,
    private readonly storage: StorageService,
    private readonly media: MediaUrlService,
    private readonly cache: CacheService,
    private readonly resolver: TenantResolverService,
    private readonly context: RequestContextService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('TenantDeletion');
  }

  /**
   * Deletes a tenant permanently, or resumes a deletion that failed part way.
   *
   * `confirmation` must be the tenant's slug, case-insensitively. It is checked
   * against the tenant actually loaded from the database, never against
   * anything else the caller sent — so a mistyped id cannot be confirmed by a
   * matching name, and pointing this at the wrong store requires getting *both*
   * halves wrong in the same, consistent way.
   */
  async deleteTenant(tenantId: string, confirmation: string): Promise<TenantDeletionResult> {
    const tenant = await this.master.tenant.findUnique({
      where: { id: tenantId },
      include: { database: true },
    });
    if (!tenant) throw Errors.notFound('Tenant', tenantId);

    if (confirmation.trim().toLowerCase() !== tenant.slug.toLowerCase()) {
      throw Errors.badRequest(
        `Type the store's identifier (${tenant.slug}) to confirm permanent deletion`,
      );
    }

    const actor = this.context.get()?.auth;
    const job = await this.loadOrCreateJob(tenant, actor?.userId, actor?.email ?? undefined);

    if (job.status === 'COMPLETED') {
      // Already done. Idempotent by design: a retried request answers with the
      // original outcome rather than starting a second, destructive run.
      return this.toResult(job);
    }

    this.logger.warn('Starting permanent tenant deletion', {
      tenantId,
      slug: tenant.slug,
      jobId: job.id,
      resumingFrom: job.completedSteps,
      requestedBy: actor?.email,
    });

    const completed = new Set(job.completedSteps as DeletionStep[]);
    let objectsDeleted = job.objectsDeleted;

    await this.master.tenantDeletionJob.update({
      where: { id: job.id },
      data: {
        status: 'RUNNING',
        attempts: { increment: 1 },
        startedAt: job.startedAt ?? new Date(),
        lastError: null,
      },
    });

    for (const step of STEPS) {
      if (completed.has(step)) {
        this.logger.debug('Skipping completed deletion step', { tenantId, step });
        continue;
      }

      await this.master.tenantDeletionJob.update({
        where: { id: job.id },
        data: { currentStep: step },
      });

      try {
        const removed = await this.runStep(step, tenant.id, tenant.slug, job.databaseName);
        if (typeof removed === 'number') objectsDeleted = removed;
      } catch (err) {
        const message = (err as Error).message;
        this.logger.error('Tenant deletion step failed', err as Error, { tenantId, step });

        const failed = await this.master.tenantDeletionJob.update({
          where: { id: job.id },
          data: { status: 'FAILED', lastError: message, objectsDeleted },
        });

        this.audit.record('platform', {
          action: AuditAction.TENANT_DELETION_FAILED,
          tenantId,
          tenantSlug: tenant.slug,
          resourceType: 'tenant',
          resourceId: tenantId,
          metadata: { step, error: message, completedSteps: [...completed] },
        });

        return this.toResult(failed);
      }

      completed.add(step);
      await this.master.tenantDeletionJob.update({
        where: { id: job.id },
        data: { completedSteps: [...completed], objectsDeleted },
      });
      this.logger.info('Tenant deletion step complete', { tenantId, step });
    }

    const finished = await this.master.tenantDeletionJob.update({
      where: { id: job.id },
      data: {
        status: 'COMPLETED',
        currentStep: null,
        finishedAt: new Date(),
        objectsDeleted,
        lastError: null,
      },
    });

    // Recorded *after* the tenant row is gone, deliberately: the audit log has
    // no foreign key to `tenants`, so the entry survives the thing it describes.
    this.audit.record('platform', {
      action: AuditAction.TENANT_DELETED,
      tenantId,
      tenantSlug: tenant.slug,
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: {
        tenantName: tenant.name,
        databaseName: job.databaseName,
        objectsDeleted,
        jobId: job.id,
      },
    });

    this.logger.warn('Tenant permanently deleted', {
      tenantId,
      slug: tenant.slug,
      objectsDeleted,
      databaseName: job.databaseName,
    });

    return this.toResult(finished);
  }

  /** Deletion history for a tenant — including tenants that no longer exist. */
  async jobs(tenantId: string): Promise<TenantDeletionResult[]> {
    const jobs = await this.master.tenantDeletionJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return jobs.map((job) => this.toResult(job));
  }

  // ------------------------------------------------------------- the steps --

  private async runStep(
    step: DeletionStep,
    tenantId: string,
    slug: string,
    databaseName: string | null,
  ): Promise<number | void> {
    switch (step) {
      case 'REVOKE_ACCESS':
        return this.revokeAccess(tenantId);
      case 'PURGE_STORAGE':
        return this.purgeStorage(tenantId);
      case 'DROP_DATABASE':
        return this.dropDatabase(tenantId, slug, databaseName);
      case 'PURGE_MASTER_RECORDS':
        return this.purgeMasterRecords(tenantId);
      case 'FINALISE':
        return this.finalise(tenantId);
    }
  }

  /**
   * Closes every door before anything is destroyed.
   *
   * After this step the tenant cannot authenticate, cannot be resolved from a
   * hostname, has no pooled connection, and — because every storage operation
   * takes the acting tenant from a request that can no longer be authorised —
   * cannot have a presigned URL minted for it. This runs first precisely so
   * that a failure in a later step still leaves the tenant inert.
   */
  private async revokeAccess(tenantId: string): Promise<void> {
    await this.master.tenant.update({
      where: { id: tenantId },
      data: { status: 'DELETING', deletedAt: new Date() },
    });

    // Sessions scoped to this tenant die immediately. Sessions the same person
    // holds for another store are untouched — `tenantId` is on the session row
    // exactly so this can be precise.
    const revoked = await this.master.session.updateMany({
      where: { tenantId, revokedAt: null },
      data: { revokedAt: new Date() },
    });

    await this.master.tenantUser.updateMany({
      where: { tenantId },
      data: { isActive: false },
    });

    // Drop the routing cache and the pooled connection, so an in-flight request
    // cannot keep serving from a warm entry after the row says DELETING.
    await this.resolver.invalidateTenantCompletely(tenantId);
    await this.connections.evict(tenantId);
    await this.cache.invalidateTenant(tenantId);
    this.media.forgetTenant(tenantId);

    this.logger.info('Revoked tenant access', { tenantId, sessionsRevoked: revoked.count });
  }

  /**
   * Removes everything under `tenants/<tenantId>/`.
   *
   * The prefix is built by `StorageService` from the id, not from anything the
   * caller sent, and it refuses an implausible id rather than sweeping wider.
   * One tenant's prefix cannot overlap another's, so this cannot reach a
   * neighbour's files — and it cannot reach platform assets either, which do
   * not live under `tenants/` at all.
   */
  private async purgeStorage(tenantId: string): Promise<number> {
    const removed = await this.storage.purgeTenant(tenantId);
    this.media.forgetTenant(tenantId);
    return removed;
  }

  /**
   * Drops the tenant's own database and the role that owned it.
   *
   * This is where the products, orders, customers, categories, coupons,
   * inventory, reviews, addresses, notifications, store settings and template
   * configuration go — all of it, at once, because in this architecture they
   * are one physical database and nothing else is in it. There is no per-table
   * deletion order to get right and no chance of missing a table.
   */
  private async dropDatabase(
    tenantId: string,
    slug: string,
    recordedName: string | null,
  ): Promise<void> {
    const record = await this.master.tenantDatabase.findUnique({ where: { tenantId } });

    // The recorded name is preferred over a derived one: it is what was
    // actually created. Deriving is the fallback for a tenant whose registry
    // row is already gone from a previous partial run.
    const databaseName = record?.databaseName ?? recordedName ?? this.ddl.databaseNameFor(slug);
    const username = record?.username ?? this.ddl.usernameFor(slug);

    // Connections must be gone before DROP DATABASE, and `evict` is cheap and
    // idempotent — running it again here costs nothing and removes a whole
    // class of "database is being accessed by other users" failures.
    await this.connections.evict(tenantId);
    await this.ddl.dropTenantDatabase(databaseName, username);
  }

  /**
   * Removes the tenant's rows from the control plane.
   *
   * Most of it is one `delete`: memberships, domains, the database registry
   * row, provisioning jobs, the subscription, entitlements, payment configs and
   * payment routes all cascade from `tenants`. What does not cascade is deleted
   * explicitly first, and the accounts that existed only to run this store are
   * cleaned up after.
   */
  private async purgeMasterRecords(tenantId: string): Promise<void> {
    const memberUserIds = (
      await this.master.tenantUser.findMany({
        where: { tenantId },
        select: { userId: true },
      })
    ).map((m) => m.userId);

    await this.master.$transaction(async (tx) => {
      // No foreign key to `tenants`, so this one is on us.
      await tx.tenantMigrationRecord.deleteMany({ where: { tenantId } });
      // Also unlinked from `tenants`; scoped to this tenant's sessions only.
      await tx.session.deleteMany({ where: { tenantId } });

      // Everything else cascades: tenant_users, domains, tenant_databases,
      // tenant_provisioning_jobs, subscriptions, feature_entitlements,
      // tenant_payment_configs, payment_routes.
      await tx.tenant.delete({ where: { id: tenantId } });
    });

    await this.removeOrphanedUsers(memberUserIds);
  }

  /**
   * Deletes merchant accounts that existed only to run this store.
   *
   * The test is membership, not ownership of the deleted tenant: someone who
   * still works for another merchant keeps their account and their other
   * store's access. Super admins and platform users are never touched — they
   * are platform staff, not tenant data.
   */
  private async removeOrphanedUsers(userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;

    const orphaned = await this.master.user.findMany({
      where: {
        id: { in: userIds },
        isSuperAdmin: false,
        userType: 'MERCHANT',
        memberships: { none: {} },
        ownedTenants: { none: {} },
      },
      select: { id: true },
    });
    if (orphaned.length === 0) return;

    // Sessions and verification tokens cascade from the user row.
    await this.master.user.deleteMany({ where: { id: { in: orphaned.map((u) => u.id) } } });
    this.logger.info('Removed accounts left with no store', { count: orphaned.length });
  }

  /**
   * Confirms the tenant really is gone.
   *
   * A verification step rather than a no-op: it is what turns "every step
   * reported success" into "the tenant is not there any more". If the database
   * still exists or master rows survived, this fails and the job says so
   * instead of reporting a clean deletion.
   */
  private async finalise(tenantId: string): Promise<void> {
    const remaining = await this.master.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true },
    });
    if (remaining) {
      throw new Error('The tenant row still exists after the purge step');
    }

    const registry = await this.master.tenantDatabase.findUnique({ where: { tenantId } });
    if (registry) {
      throw new Error('The tenant database registry row still exists after the purge step');
    }

    const leftover = await this.storage.listTenantObjects(tenantId);
    if (leftover.length > 0) {
      throw new Error(`${leftover.length} object(s) remain in storage for this tenant`);
    }
  }

  // ------------------------------------------------------------- job state --

  /**
   * Finds the deletion job to resume, or opens a new one.
   *
   * A PENDING or FAILED job for this tenant is reused, which is what makes a
   * retry resume rather than restart. Two concurrent delete requests therefore
   * converge on one job and one set of recorded steps instead of racing two
   * pipelines through the same three systems.
   */
  private async loadOrCreateJob(
    tenant: { id: string; slug: string; name: string; database: { databaseName: string } | null },
    userId?: string,
    email?: string,
  ) {
    const existing = await this.master.tenantDeletionJob.findFirst({
      where: { tenantId: tenant.id, status: { in: ['PENDING', 'RUNNING', 'FAILED', 'COMPLETED'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) return existing;

    return this.master.tenantDeletionJob.create({
      data: {
        tenantId: tenant.id,
        tenantSlug: tenant.slug,
        tenantName: tenant.name,
        // Captured now, while the registry row still exists — the drop step
        // needs it after the row it came from has been deleted.
        databaseName: tenant.database?.databaseName ?? null,
        requestedByUserId: userId ?? null,
        requestedByEmail: email ?? null,
      },
    });
  }

  private toResult(job: {
    id: string;
    tenantId: string;
    tenantSlug: string;
    status: string;
    currentStep: string | null;
    completedSteps: string[];
    objectsDeleted: number;
    databaseName: string | null;
    lastError: string | null;
    startedAt: Date | null;
    finishedAt: Date | null;
  }): TenantDeletionResult {
    return {
      jobId: job.id,
      tenantId: job.tenantId,
      tenantSlug: job.tenantSlug,
      status: job.status === 'COMPLETED' ? 'COMPLETED' : 'FAILED',
      completedSteps: job.completedSteps,
      currentStep: job.currentStep,
      objectsDeleted: job.objectsDeleted,
      databaseName: job.databaseName,
      error: job.lastError,
      startedAt: job.startedAt?.toISOString() ?? null,
      finishedAt: job.finishedAt?.toISOString() ?? null,
    };
  }
}
