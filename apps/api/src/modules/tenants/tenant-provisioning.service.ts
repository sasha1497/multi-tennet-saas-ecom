import { Injectable } from '@nestjs/common';
import { defaultStoreTheme } from '@retailos/config';
import { AuditAction, ProvisioningStep } from '@retailos/types';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantConnectionManager } from '@/core/database/tenant-connection.manager';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { TenantDdlService } from '@/core/database/tenant-ddl.service';
import { TenantMigrationRunner } from '@/core/database/tenant-migration.runner';
import { AppLogger } from '@/core/logger/logger.service';
import { CacheService } from '@/core/cache/cache.service';
import { CredentialCipherService } from '@/core/security/credential-cipher.service';
import { TenantResolverService } from '@/core/tenant/tenant-resolver.service';
import { AuditService } from '@/modules/audit/audit.service';

/** Ordered pipeline. A retry resumes at the first step not yet recorded. */
const STEPS = [
  ProvisioningStep.CREATE_DATABASE,
  ProvisioningStep.RUN_MIGRATIONS,
  ProvisioningStep.SEED_DEFAULTS,
  ProvisioningStep.CONFIGURE_BRANDING,
  ProvisioningStep.ACTIVATE,
] as const;

export interface ProvisionResult {
  tenantId: string;
  jobId: string;
  status: 'COMPLETED' | 'FAILED';
  completedSteps: string[];
  databaseName?: string;
  schemaVersion?: string;
  error?: string;
}

/**
 * Turns a PROVISIONING tenant into an ACTIVE one.
 *
 * The requirement is blunt about this (§6): *"Provisioning MUST be idempotent.
 * Retries must not create duplicate tenants or corrupted databases."* Three
 * mechanisms deliver that:
 *
 *  1. **Recorded steps.** Each finished step is appended to
 *     `tenant_provisioning_jobs.completed_steps`, and a retry skips them.
 *  2. **Idempotent primitives.** `CREATE DATABASE`/`CREATE ROLE` are
 *     existence-checked, migrations consult their own ledger, and seeding uses
 *     upserts. Even a step that runs twice is harmless.
 *  3. **A distributed lock.** Only one worker provisions a given tenant at a
 *     time, so two queued retries cannot interleave.
 *
 * A failed provision is left in place, never rolled back: a half-created
 * database can be resumed, whereas dropping it loses whatever did succeed and
 * risks destroying data if the failure was spurious.
 */
@Injectable()
export class TenantProvisioningService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly ddl: TenantDdlService,
    private readonly migrations: TenantMigrationRunner,
    private readonly connections: TenantConnectionManager,
    private readonly tenantDb: TenantDatabaseService,
    private readonly cipher: CredentialCipherService,
    private readonly cache: CacheService,
    private readonly resolver: TenantResolverService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('TenantProvisioning');
  }

  /**
   * Runs (or resumes) provisioning for one tenant.
   *
   * Safe to call repeatedly: an already-ACTIVE tenant returns immediately.
   */
  async provision(tenantId: string, jobId?: string): Promise<ProvisionResult> {
    const lockToken = await this.cache.acquireLock(`provision:${tenantId}`, 300_000);
    if (!lockToken) {
      throw Errors.conflict('Provisioning for this store is already in progress');
    }

    let job = await this.loadOrCreateJob(tenantId, jobId);

    try {
      const tenant = await this.master.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) throw Errors.notFound('Store', tenantId);

      if (tenant.status === 'ACTIVE' && job.completedSteps.includes(ProvisioningStep.ACTIVATE)) {
        this.logger.debug('Tenant already provisioned', { tenantId });
        return {
          tenantId,
          jobId: job.id,
          status: 'COMPLETED',
          completedSteps: job.completedSteps,
        };
      }

      job = await this.master.tenantProvisioningJob.update({
        where: { id: job.id },
        data: {
          status: 'RUNNING',
          attempts: { increment: 1 },
          startedAt: job.startedAt ?? new Date(),
          lastError: null,
        },
      });

      this.audit.record('platform', {
        action: AuditAction.TENANT_PROVISION_STARTED,
        tenantId,
        tenantSlug: tenant.slug,
        resourceType: 'provisioning_job',
        resourceId: job.id,
        metadata: { attempt: job.attempts },
      });

      const completed = new Set(job.completedSteps);
      let databaseName: string | undefined;
      let schemaVersion: string | undefined;

      for (const step of STEPS) {
        if (completed.has(step)) {
          this.logger.debug('Skipping completed provisioning step', { tenantId, step });
          continue;
        }

        await this.master.tenantProvisioningJob.update({
          where: { id: job.id },
          data: { currentStep: step },
        });

        const outcome = await this.runStep(step, tenant.id, tenant.slug, tenant.name, tenant.contactEmail);
        databaseName = outcome.databaseName ?? databaseName;
        schemaVersion = outcome.schemaVersion ?? schemaVersion;

        completed.add(step);
        await this.master.tenantProvisioningJob.update({
          where: { id: job.id },
          data: { completedSteps: [...completed] },
        });

        this.logger.info('Provisioning step complete', { tenantId, step });
      }

      await this.master.tenantProvisioningJob.update({
        where: { id: job.id },
        data: { status: 'COMPLETED', currentStep: null, finishedAt: new Date() },
      });

      this.audit.record('platform', {
        action: AuditAction.TENANT_PROVISION_COMPLETED,
        tenantId,
        tenantSlug: tenant.slug,
        resourceType: 'provisioning_job',
        resourceId: job.id,
        metadata: { databaseName, schemaVersion },
      });

      this.logger.info('Tenant provisioned', { tenantId, slug: tenant.slug, databaseName });

      return {
        tenantId,
        jobId: job.id,
        status: 'COMPLETED',
        completedSteps: [...completed],
        databaseName,
        schemaVersion,
      };
    } catch (err) {
      const message = (err as Error).message;
      await this.master.tenantProvisioningJob
        .update({
          where: { id: job.id },
          data: { status: 'FAILED', lastError: message.slice(0, 2000), finishedAt: new Date() },
        })
        .catch(() => undefined);

      await this.master.tenantDatabase
        .updateMany({ where: { tenantId }, data: { status: 'FAILED', lastError: message.slice(0, 2000) } })
        .catch(() => undefined);

      this.audit.record('platform', {
        action: AuditAction.TENANT_PROVISION_FAILED,
        tenantId,
        resourceType: 'provisioning_job',
        resourceId: job.id,
        metadata: { error: message },
      });

      this.logger.error('Tenant provisioning failed', err as Error, { tenantId, jobId: job.id });
      throw err;
    } finally {
      await this.cache.releaseLock(`provision:${tenantId}`, lockToken);
    }
  }

  // ------------------------------------------------------------- the steps --

  private async runStep(
    step: (typeof STEPS)[number],
    tenantId: string,
    slug: string,
    name: string,
    contactEmail: string,
  ): Promise<{ databaseName?: string; schemaVersion?: string }> {
    switch (step) {
      case ProvisioningStep.CREATE_DATABASE:
        return { databaseName: await this.createDatabase(tenantId, slug) };
      case ProvisioningStep.RUN_MIGRATIONS:
        return { schemaVersion: await this.runMigrations(tenantId) };
      case ProvisioningStep.SEED_DEFAULTS:
        await this.seedDefaults(tenantId, name, contactEmail);
        return {};
      case ProvisioningStep.CONFIGURE_BRANDING:
        await this.configureBranding(tenantId, slug);
        return {};
      case ProvisioningStep.ACTIVATE:
        await this.activate(tenantId);
        return {};
    }
  }

  /** Idempotent: reuses the existing registry row and rotates the password. */
  private async createDatabase(tenantId: string, slug: string): Promise<string> {
    const password = this.cipher.generateDatabasePassword();
    const created = await this.ddl.createTenantDatabase({ slug, password });

    await this.master.tenantDatabase.upsert({
      where: { tenantId },
      create: {
        tenantId,
        clusterId: created.clusterId,
        host: created.host,
        port: created.port,
        databaseName: created.databaseName,
        username: created.username,
        encryptedPassword: this.cipher.encrypt(created.password),
        status: 'CREATING',
      },
      update: {
        host: created.host,
        port: created.port,
        username: created.username,
        encryptedPassword: this.cipher.encrypt(created.password),
        status: 'CREATING',
        lastError: null,
      },
    });

    // The pooled client (if any) holds the old password.
    await this.connections.evict(tenantId);
    return created.databaseName;
  }

  private async runMigrations(tenantId: string): Promise<string> {
    const record = await this.master.tenantDatabase.findUnique({ where: { tenantId } });
    if (!record) throw Errors.internal('Tenant database record is missing', { tenantId });

    await this.master.tenantDatabase.update({
      where: { tenantId },
      data: { status: 'MIGRATING' },
    });

    const result = await this.migrations.migrate({
      tenantId,
      databaseName: record.databaseName,
    });

    // Migrations run as the admin role, so the tables they create are owned by
    // it. Hand the tenant's own least-privilege role access before the
    // application ever connects as that role.
    await this.ddl.grantTenantPrivileges(record.databaseName, record.username);

    await this.master.tenantDatabase.update({
      where: { tenantId },
      data: {
        status: 'READY',
        schemaVersion: result.schemaVersion,
        lastMigratedAt: new Date(),
        lastError: null,
      },
    });

    return result.schemaVersion;
  }

  /**
   * Writes the tenant's baseline data: the singleton store-settings row and a
   * starter category set so the merchant's first product form is not empty.
   * All upserts, so a re-run changes nothing.
   */
  private async seedDefaults(tenantId: string, name: string, contactEmail: string): Promise<void> {
    await this.tenantDb.runFor(tenantId, async (db) => {
      await db.storeSettings.upsert({
        where: { id: 'singleton' },
        create: {
          id: 'singleton',
          storeName: name,
          contactEmail,
          theme: defaultStoreTheme as never,
          banners: [] as never,
          businessHours: defaultBusinessHours() as never,
          socialLinks: {} as never,
          orderPrefix: orderPrefixFor(name),
          currency: 'INR',
          currencySymbol: '₹',
          codEnabled: true,
          onlinePaymentEnabled: true,
          isPublished: false,
        },
        update: {},
      });

      for (const [index, category] of STARTER_CATEGORIES.entries()) {
        await db.category.upsert({
          where: { slug: category.slug },
          create: { ...category, sortOrder: index, isActive: true },
          update: {},
        });
      }
    });
  }

  private async configureBranding(tenantId: string, slug: string): Promise<void> {
    await this.tenantDb.runFor(tenantId, async (db) => {
      const settings = await db.storeSettings.findUnique({ where: { id: 'singleton' } });
      const theme = (settings?.theme ?? {}) as Record<string, unknown>;
      await db.storeSettings.update({
        where: { id: 'singleton' },
        data: {
          theme: { ...defaultStoreTheme, ...theme } as never,
          tagline: settings?.tagline ?? 'Quality products, delivered locally',
        },
      });
    });

    this.logger.debug('Applied default branding', { tenantId, slug });
  }

  private async activate(tenantId: string): Promise<void> {
    await this.master.tenant.update({
      where: { id: tenantId },
      data: { status: 'ACTIVE', activatedAt: new Date() },
    });
    // The storefront was answering 503 from cache; clear it so it opens at once.
    await this.resolver.invalidateTenantCompletely(tenantId);
  }

  // ------------------------------------------------------------ management --

  private async loadOrCreateJob(tenantId: string, jobId?: string) {
    if (jobId) {
      const existing = await this.master.tenantProvisioningJob.findUnique({ where: { id: jobId } });
      if (existing) return existing;
    }

    const pending = await this.master.tenantProvisioningJob.findFirst({
      where: { tenantId, status: { in: ['PENDING', 'RUNNING', 'FAILED'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (pending) return pending;

    return this.master.tenantProvisioningJob.create({
      data: {
        tenantId,
        idempotencyKey: `provision:${tenantId}:${Date.now()}`,
        status: 'PENDING',
      },
    });
  }

  /**
   * Destroys a tenant's database. Guarded behind an explicit confirmation
   * string and only reachable from the audited platform deletion flow.
   */
  async deprovision(tenantId: string, confirm: string): Promise<void> {
    if (confirm !== 'DELETE_TENANT_DATA') {
      throw Errors.badRequest('Deprovisioning requires an explicit confirmation');
    }

    const record = await this.master.tenantDatabase.findUnique({ where: { tenantId } });
    if (!record) {
      this.logger.warn('Deprovision requested for a tenant with no database', { tenantId });
      return;
    }

    await this.connections.evict(tenantId);
    await this.ddl.dropTenantDatabase(record.databaseName, record.username);

    await this.master.tenantDatabase.update({
      where: { tenantId },
      data: { status: 'ARCHIVED' },
    });
    await this.master.tenant.update({
      where: { id: tenantId },
      data: { status: 'DELETED', deletedAt: new Date() },
    });

    await this.resolver.invalidateTenantCompletely(tenantId);

    this.audit.record('platform', {
      action: AuditAction.TENANT_DELETED,
      tenantId,
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: { databaseName: record.databaseName },
    });
  }

  /** Applies any new tenant migrations to a single tenant, on demand. */
  async migrateTenant(tenantId: string): Promise<{ applied: string[]; schemaVersion: string }> {
    const record = await this.master.tenantDatabase.findUnique({ where: { tenantId } });
    if (!record) throw Errors.notFound('Tenant database', tenantId);

    const result = await this.migrations.migrate({
      tenantId,
      databaseName: record.databaseName,
    });
    await this.ddl.grantTenantPrivileges(record.databaseName, record.username);

    await this.master.tenantDatabase.update({
      where: { tenantId },
      data: { schemaVersion: result.schemaVersion, lastMigratedAt: new Date() },
    });

    // Prisma caches schema knowledge in the client; drop it after DDL.
    await this.connections.evict(tenantId);

    return { applied: result.applied, schemaVersion: result.schemaVersion };
  }

  /**
   * Migrates every ACTIVE tenant. Runs sequentially on purpose: a fleet-wide
   * migration hammering the database in parallel is how you turn a schema change
   * into an outage.
   */
  async migrateAllTenants(): Promise<{ migrated: number; failed: { tenantId: string; error: string }[] }> {
    const tenants = await this.master.tenantDatabase.findMany({
      where: { status: 'READY' },
      select: { tenantId: true, databaseName: true, username: true },
    });

    const failed: { tenantId: string; error: string }[] = [];
    let migrated = 0;

    for (const tenant of tenants) {
      try {
        const result = await this.migrations.migrate(tenant);
        if (result.applied.length > 0) {
          migrated++;
          await this.ddl.grantTenantPrivileges(tenant.databaseName, tenant.username);
        }
        await this.master.tenantDatabase.update({
          where: { tenantId: tenant.tenantId },
          data: { schemaVersion: result.schemaVersion, lastMigratedAt: new Date() },
        });
        await this.connections.evict(tenant.tenantId);
      } catch (err) {
        failed.push({ tenantId: tenant.tenantId, error: (err as Error).message });
        this.logger.error('Fleet migration failed for tenant', err as Error, {
          tenantId: tenant.tenantId,
        });
      }
    }

    this.logger.info('Fleet migration finished', {
      total: tenants.length,
      migrated,
      failed: failed.length,
    });
    return { migrated, failed };
  }
}

const STARTER_CATEGORIES = [
  { name: 'New Arrivals', slug: 'new-arrivals', iconName: 'sparkles' },
  { name: 'Best Sellers', slug: 'best-sellers', iconName: 'flame' },
  { name: 'Offers', slug: 'offers', iconName: 'tag' },
];

function defaultBusinessHours() {
  return Array.from({ length: 7 }, (_, day) => ({
    day,
    open: day === 0 ? null : '10:00',
    close: day === 0 ? null : '21:00',
    closed: day === 0,
  }));
}

/** `KickZone` -> `KZ`; used as the order-number prefix. */
function orderPrefixFor(name: string): string {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '');
  if (initials.length >= 2) return initials.slice(0, 4);
  return (name.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3) || 'ORD').padEnd(2, 'X');
}
