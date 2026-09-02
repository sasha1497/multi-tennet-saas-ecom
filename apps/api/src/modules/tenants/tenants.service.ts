import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { normaliseHostname, storefrontUrl } from '@retailos/config';
import { AuditAction, TenantStatus } from '@retailos/types';
import { slugify } from '@retailos/validation';
import { AppConfigService } from '@/config/config.module';
import { Errors } from '@/common/errors/app.exception';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { AppLogger } from '@/core/logger/logger.service';
import { QueueService } from '@/core/queue/queue.service';
import { MembershipService } from '@/core/tenant/membership.service';
import { TenantResolverService } from '@/core/tenant/tenant-resolver.service';
import { AuditService } from '@/modules/audit/audit.service';
import { EntitlementsService } from '@/modules/entitlements/entitlements.service';

export interface CreateTenantParams {
  name: string;
  slug?: string;
  ownerUserId: string;
  contactEmail: string;
  contactPhone?: string | null;
  businessCategory?: string | null;
  planCode?: string;
}

export interface CreatedTenant {
  tenantId: string;
  slug: string;
  name: string;
  status: TenantStatus;
  storefrontUrl: string;
  provisioningJobId: string;
}

/**
 * Tenant lifecycle in the control plane.
 *
 * Creating a tenant is a *master-database-only* operation: it reserves the slug,
 * registers the subdomain, records ownership and billing, and queues the
 * physical provisioning. The tenant is ACTIVE only once its database exists and
 * is migrated — until then the storefront answers 503, not a half-built shop.
 */
@Injectable()
export class TenantsService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly config: AppConfigService,
    private readonly queue: QueueService,
    private readonly entitlements: EntitlementsService,
    private readonly memberships: MembershipService,
    private readonly resolver: TenantResolverService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('TenantsService');
  }

  /**
   * Creates the tenant record and everything the control plane needs, then
   * queues provisioning. The whole master-side write is one transaction, so a
   * failure cannot leave a slug reserved with no tenant behind it.
   */
  async createTenant(params: CreateTenantParams): Promise<CreatedTenant> {
    const slug = await this.generateUniqueSlug(params.slug ?? params.name);
    const hostname = `${slug}.${normaliseHostname(this.config.domain.platformDomain)}`;
    const plan = await this.resolvePlan(params.planCode);

    const idempotencyKey = `provision:${slug}:${randomUUID()}`;

    const result = await this.master.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: params.name.trim(),
          slug,
          status: 'PROVISIONING',
          businessCategory: params.businessCategory ?? null,
          contactEmail: params.contactEmail,
          contactPhone: params.contactPhone ?? null,
          ownerUserId: params.ownerUserId,
        },
      });

      // The owner's membership — this row is what every later authorisation
      // check reads.
      await tx.tenantUser.create({
        data: {
          tenantId: tenant.id,
          userId: params.ownerUserId,
          role: 'OWNER',
          isActive: true,
          isDefault: true,
          joinedAt: new Date(),
        },
      });

      await tx.domain.create({
        data: {
          tenantId: tenant.id,
          hostname,
          type: 'SUBDOMAIN',
          isPrimary: true,
          // Platform subdomains need no DNS proof — we control the zone.
          isVerified: true,
        },
      });

      const now = new Date();
      const periodEnd = new Date(now);
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      const trialEnd = plan.trialDays > 0 ? new Date(now.getTime() + plan.trialDays * 86_400_000) : null;

      await tx.subscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: plan.trialDays > 0 ? 'TRIALING' : 'ACTIVE',
          currentPeriodStart: now,
          currentPeriodEnd: periodEnd,
          trialEndsAt: trialEnd,
        },
      });

      const job = await tx.tenantProvisioningJob.create({
        data: {
          tenantId: tenant.id,
          idempotencyKey,
          status: 'PENDING',
        },
      });

      return { tenant, job };
    });

    await this.entitlements.syncPlanEntitlements(result.tenant.id, plan.id);

    await this.queue.provisionTenant({
      tenantId: result.tenant.id,
      jobId: result.job.id,
      idempotencyKey,
    });

    this.audit.record('platform', {
      action: AuditAction.TENANT_CREATED,
      tenantId: result.tenant.id,
      tenantSlug: slug,
      resourceType: 'tenant',
      resourceId: result.tenant.id,
      metadata: { name: params.name, planCode: plan.code, hostname },
    });

    this.logger.info('Tenant created', { tenantId: result.tenant.id, slug, hostname });

    return {
      tenantId: result.tenant.id,
      slug,
      name: result.tenant.name,
      status: 'PROVISIONING',
      storefrontUrl: storefrontUrl(slug, this.config.domain),
      provisioningJobId: result.job.id,
    };
  }

  /**
   * Derives an available slug.
   *
   * A merchant's chosen name may collide or be reserved, so we append a short
   * numeric suffix rather than failing the signup — the store name they see is
   * unaffected, only the subdomain.
   */
  async generateUniqueSlug(input: string): Promise<string> {
    const base = slugify(input) || 'store';
    const reserved = new Set(this.config.domain.reservedSubdomains);

    const candidates = [
      base.length >= 3 ? base : `${base}-store`,
      ...Array.from({ length: 20 }, (_, i) => `${base}-${i + 2}`),
      `${base}-${Math.random().toString(36).slice(2, 6)}`,
    ];

    for (const candidate of candidates) {
      if (candidate.length < 3 || candidate.length > 63) continue;
      if (reserved.has(candidate)) continue;
      const taken = await this.master.tenant.findUnique({
        where: { slug: candidate },
        select: { id: true },
      });
      if (!taken) return candidate;
    }

    throw Errors.conflict('Could not allocate a store address. Please choose a different name.');
  }

  async isSlugAvailable(slug: string): Promise<{ available: boolean; reason?: string }> {
    const clean = slugify(slug);
    if (clean !== slug.toLowerCase().trim()) {
      return { available: false, reason: 'Use lowercase letters, numbers and hyphens only' };
    }
    if (clean.length < 3) return { available: false, reason: 'Too short' };
    if (this.config.domain.reservedSubdomains.includes(clean)) {
      return { available: false, reason: 'This address is reserved' };
    }
    const taken = await this.master.tenant.findUnique({
      where: { slug: clean },
      select: { id: true },
    });
    return taken ? { available: false, reason: 'Already taken' } : { available: true };
  }

  async findById(tenantId: string) {
    const tenant = await this.master.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      include: {
        domains: true,
        database: {
          // Credentials are never selected — they must not travel further than
          // TenantConnectionManager.
          select: {
            id: true,
            tenantId: true,
            clusterId: true,
            host: true,
            port: true,
            databaseName: true,
            username: true,
            status: true,
            schemaVersion: true,
            lastMigratedAt: true,
            createdAt: true,
          },
        },
        subscription: { include: { plan: true } },
        owner: { select: { id: true, email: true, firstName: true, lastName: true, phone: true } },
      },
    });
    if (!tenant) throw Errors.notFound('Store', tenantId);
    return tenant;
  }

  /**
   * Status transitions. Suspending evicts cached routing immediately so an
   * abusive store stops serving within a second, not after a cache TTL.
   */
  async updateStatus(
    tenantId: string,
    status: TenantStatus,
    reason?: string,
  ): Promise<void> {
    const tenant = await this.master.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) throw Errors.notFound('Store', tenantId);

    if (tenant.status === status) return;

    const data: Record<string, unknown> = { status };
    if (status === 'ACTIVE') {
      data.activatedAt = tenant.activatedAt ?? new Date();
      data.suspendedAt = null;
      data.suspensionReason = null;
    }
    if (status === 'SUSPENDED') {
      data.suspendedAt = new Date();
      data.suspensionReason = reason ?? null;
    }
    if (status === 'DELETED') {
      data.deletedAt = new Date();
    }

    await this.master.tenant.update({ where: { id: tenantId }, data });

    await this.resolver.invalidateTenantCompletely(tenantId);
    await this.memberships.invalidateTenant(tenantId);

    const action =
      status === 'ACTIVE'
        ? AuditAction.TENANT_ACTIVATED
        : status === 'SUSPENDED'
          ? AuditAction.TENANT_SUSPENDED
          : status === 'DELETED'
            ? AuditAction.TENANT_DELETED
            : 'TENANT_STATUS_CHANGED';

    this.audit.record('platform', {
      action,
      tenantId,
      tenantSlug: tenant.slug,
      resourceType: 'tenant',
      resourceId: tenantId,
      metadata: { from: tenant.status, to: status, reason },
    });

    this.logger.info('Tenant status changed', { tenantId, from: tenant.status, to: status, reason });
  }

  storefrontUrlFor(slug: string): string {
    return storefrontUrl(slug, this.config.domain);
  }

  private async resolvePlan(planCode?: string) {
    const code = (planCode ?? 'FREE').toUpperCase();
    const plan =
      (await this.master.plan.findUnique({ where: { code } })) ??
      (await this.master.plan.findFirst({ where: { isActive: true }, orderBy: { sortOrder: 'asc' } }));

    if (!plan) {
      throw Errors.internal(
        'No subscription plans are configured. Run the database seed before creating tenants.',
      );
    }
    return plan;
  }
}
