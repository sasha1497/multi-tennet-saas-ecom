import { Injectable } from '@nestjs/common';
import { storefrontUrl } from '@retailos/config';
import { AuditAction } from '@retailos/types';
import type {
  AuditLogEntry,
  PaginatedResult,
  Plan,
  PlatformOverview,
  PlatformTenantDetail,
  PlatformTenantListItem,
  SystemHealthDetail,
  TenantStatus,
} from '@retailos/types';
import type { CreateTenantInput } from '@retailos/validation';
import { Errors } from '@/common/errors/app.exception';
import { bigIntToNumber } from '@/common/utils/serialization';
import { escapeLike, normaliseSearch, paginate, toPrismaPage } from '@/common/utils/pagination';
import { AppConfigService } from '@/config/config.module';
import { CacheService } from '@/core/cache/cache.service';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantConnectionManager } from '@/core/database/tenant-connection.manager';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { TenantMigrationRunner } from '@/core/database/tenant-migration.runner';
import { AppLogger } from '@/core/logger/logger.service';
import { QueueService } from '@/core/queue/queue.service';
import { PasswordService } from '@/core/security/password.service';
import { EntitlementsService, isLapsed } from '@/modules/entitlements/entitlements.service';
import { aiQuotaWindowStart } from '@/modules/ai/ai-usage';
import { AuditService } from '@/modules/audit/audit.service';
import { TenantProvisioningService } from '@/modules/tenants/tenant-provisioning.service';
import { TenantsService } from '@/modules/tenants/tenants.service';

@Injectable()
export class PlatformService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly tenants: TenantsService,
    private readonly provisioning: TenantProvisioningService,
    private readonly entitlements: EntitlementsService,
    private readonly connections: TenantConnectionManager,
    private readonly migrations: TenantMigrationRunner,
    private readonly tenantDb: TenantDatabaseService,
    private readonly passwords: PasswordService,
    private readonly cache: CacheService,
    private readonly queue: QueueService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('PlatformService');
  }

  /** Fleet-wide snapshot for the super-admin landing page. */
  async overview(): Promise<PlatformOverview> {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const dayAgo = new Date(Date.now() - 86_400_000);

    const [statusCounts, newThisMonth, provisioningCounts, failed24h, recent, dbCounts, redisOk, queuesOk] =
      await Promise.all([
        this.master.tenant.groupBy({
          by: ['status'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        this.master.tenant.count({ where: { createdAt: { gte: monthStart }, deletedAt: null } }),
        this.master.tenantProvisioningJob.groupBy({
          by: ['status'],
          where: { status: { in: ['PENDING', 'RUNNING'] } },
          _count: { _all: true },
        }),
        this.master.tenantProvisioningJob.count({
          where: { status: 'FAILED', updatedAt: { gte: dayAgo } },
        }),
        this.listTenants({ page: 1, limit: 5, sortOrder: 'desc' }),
        this.master.tenantDatabase.groupBy({ by: ['status'], _count: { _all: true } }),
        this.cache.ping(),
        this.queue.isHealthy(),
      ]);

    const byStatus = (status: string) =>
      statusCounts.find((s) => s.status === status)?._count._all ?? 0;

    // Aggregate GMV comes from the denormalised per-tenant counters rather than
    // fanning out across every tenant database — one query instead of N.
    const [gmvThisMonth, gmvLastMonth] = await Promise.all([
      this.aggregateGmv(monthStart, now),
      this.aggregateGmv(lastMonthStart, monthStart),
    ]);

    const healthyDbs = dbCounts.find((d) => d.status === 'READY')?._count._all ?? 0;
    const totalDbs = dbCounts.reduce((sum, d) => sum + d._count._all, 0);

    const masterHealth = await this.master.healthCheck();

    return {
      tenants: {
        total: statusCounts.reduce((sum, s) => sum + s._count._all, 0),
        active: byStatus('ACTIVE'),
        provisioning: byStatus('PROVISIONING'),
        suspended: byStatus('SUSPENDED'),
        newThisMonth,
      },
      revenue: {
        gmvThisMonth: gmvThisMonth.revenue,
        gmvLastMonth: gmvLastMonth.revenue,
        ordersThisMonth: gmvThisMonth.orders,
      },
      system: {
        masterDb: masterHealth.ok ? 'ok' : 'error',
        redis: redisOk ? 'ok' : 'error',
        queues: queuesOk ? 'ok' : 'error',
        tenantDbsHealthy: healthyDbs,
        tenantDbsTotal: totalDbs,
      },
      provisioning: {
        pending: provisioningCounts.find((p) => p.status === 'PENDING')?._count._all ?? 0,
        running: provisioningCounts.find((p) => p.status === 'RUNNING')?._count._all ?? 0,
        failed24h,
      },
      recentTenants: recent.items,
    };
  }

  async listTenants(query: {
    page?: number;
    limit?: number;
    search?: string;
    status?: TenantStatus;
    planCode?: string;
    sortOrder?: 'asc' | 'desc';
  }): Promise<PaginatedResult<PlatformTenantListItem>> {
    const { skip, take, page, limit } = toPrismaPage(query);
    const search = normaliseSearch(query.search);

    const where: Record<string, unknown> = { deletedAt: null };
    if (query.status) where.status = query.status;
    if (query.planCode) where.subscription = { plan: { code: query.planCode.toUpperCase() } };
    if (search) {
      const term = escapeLike(search);
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { slug: { contains: term.toLowerCase() } },
        { contactEmail: { contains: term, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      this.master.tenant.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: query.sortOrder ?? 'desc' },
        include: {
          owner: { select: { firstName: true, lastName: true, email: true } },
          subscription: { include: { plan: { select: { code: true } } } },
          database: { select: { status: true } },
          domains: { where: { isPrimary: true }, select: { hostname: true }, take: 1 },
        },
      }),
      this.master.tenant.count({ where }),
    ]);

    const items: PlatformTenantListItem[] = rows.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      status: t.status as TenantStatus,
      ownerName: `${t.owner.firstName} ${t.owner.lastName}`.trim(),
      ownerEmail: t.owner.email,
      planCode: t.subscription?.plan.code ?? 'FREE',
      primaryDomain: t.domains[0]?.hostname ?? null,
      productCount: t.statProducts,
      orderCount: t.statOrders,
      monthlyRevenue: bigIntToNumber(t.statRevenue),
      databaseStatus: t.database?.status ?? 'PENDING',
      createdAt: t.createdAt.toISOString(),
      activatedAt: t.activatedAt?.toISOString() ?? null,
    }));

    return paginate(items, total, page, limit);
  }

  async tenantDetail(tenantId: string): Promise<PlatformTenantDetail> {
    const tenant = await this.tenants.findById(tenantId);
    const [entitlements, jobs, members, stats] = await Promise.all([
      this.entitlements.get(tenantId),
      this.master.tenantProvisioningJob.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 10,
      }),
      this.master.tenantUser.findMany({
        where: { tenantId },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
      this.liveTenantStats(tenantId),
    ]);

    if (!tenant.database) throw Errors.internal('Tenant database record is missing', { tenantId });

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status as TenantStatus,
        businessCategory: tenant.businessCategory,
        contactEmail: tenant.contactEmail,
        contactPhone: tenant.contactPhone,
        ownerUserId: tenant.ownerUserId,
        primaryDomain: tenant.domains.find((d) => d.isPrimary)?.hostname ?? null,
        storefrontUrl: storefrontUrl(tenant.slug, this.config.domain),
        createdAt: tenant.createdAt.toISOString(),
        updatedAt: tenant.updatedAt.toISOString(),
        activatedAt: tenant.activatedAt?.toISOString() ?? null,
        suspendedAt: tenant.suspendedAt?.toISOString() ?? null,
        suspensionReason: tenant.suspensionReason,
      },
      database: {
        id: tenant.database.id,
        tenantId,
        clusterId: tenant.database.clusterId,
        host: tenant.database.host,
        port: tenant.database.port,
        databaseName: tenant.database.databaseName,
        username: tenant.database.username,
        schemaVersion: tenant.database.schemaVersion,
        status: tenant.database.status,
        lastMigratedAt: tenant.database.lastMigratedAt?.toISOString() ?? null,
        createdAt: tenant.database.createdAt.toISOString(),
      },
      owner: {
        id: tenant.owner.id,
        email: tenant.owner.email,
        fullName: `${tenant.owner.firstName} ${tenant.owner.lastName}`.trim(),
        phone: tenant.owner.phone,
      },
      members: members.map((m) => ({
        userId: m.user.id,
        email: m.user.email,
        fullName: `${m.user.firstName} ${m.user.lastName}`.trim(),
        role: m.role,
      })),
      subscription: tenant.subscription
        ? {
            id: tenant.subscription.id,
            tenantId,
            planId: tenant.subscription.planId,
            status: tenant.subscription.status,
            currentPeriodStart: tenant.subscription.currentPeriodStart.toISOString(),
            currentPeriodEnd: tenant.subscription.currentPeriodEnd.toISOString(),
            trialEndsAt: tenant.subscription.trialEndsAt?.toISOString() ?? null,
            cancelledAt: tenant.subscription.cancelledAt?.toISOString() ?? null,
            createdAt: tenant.subscription.createdAt.toISOString(),
          }
        : null,
      entitlements,
      provisioningJobs: jobs.map((j) => ({
        id: j.id,
        tenantId: j.tenantId,
        status: j.status,
        currentStep: j.currentStep,
        completedSteps: j.completedSteps,
        attempts: j.attempts,
        lastError: j.lastError,
        startedAt: j.startedAt?.toISOString() ?? null,
        finishedAt: j.finishedAt?.toISOString() ?? null,
        createdAt: j.createdAt.toISOString(),
      })),
      stats,
    };
  }

  /**
   * Creates a tenant on behalf of a merchant (concierge onboarding).
   *
   * When no password is supplied one is generated and returned once, so the
   * operator can hand it over — it is never stored in the clear or emailed
   * in a form we can read back.
   */
  async createTenant(input: CreateTenantInput) {
    const email = input.ownerEmail.toLowerCase().trim();

    let owner = await this.master.user.findUnique({ where: { email } });
    let temporaryPassword: string | undefined;

    if (!owner) {
      temporaryPassword = input.ownerPassword ?? this.passwords.generateTemporary();
      owner = await this.master.user.create({
        data: {
          email,
          phone: input.ownerPhone ?? null,
          passwordHash: await this.passwords.hash(temporaryPassword),
          firstName: input.ownerFirstName,
          lastName: input.ownerLastName ?? '',
          userType: 'MERCHANT',
        },
      });
    }

    const tenant = await this.tenants.createTenant({
      name: input.name,
      slug: input.slug,
      ownerUserId: owner.id,
      contactEmail: email,
      contactPhone: input.ownerPhone ?? null,
      businessCategory: input.businessCategory ?? null,
      planCode: input.planCode,
    });

    const listed = await this.listTenants({ page: 1, limit: 1, search: tenant.slug });

    return {
      tenant: listed.items[0],
      provisioningJobId: tenant.provisioningJobId,
      temporaryPassword: input.ownerPassword ? undefined : temporaryPassword,
    };
  }

  async updateTenantStatus(tenantId: string, status: TenantStatus, reason?: string) {
    await this.tenants.updateStatus(tenantId, status, reason);
    // A suspended tenant must stop serving immediately, not when its pooled
    // connection happens to age out.
    if (status !== 'ACTIVE') await this.connections.evict(tenantId);

    const listed = await this.listTenants({ page: 1, limit: 1, search: tenantId });
    return listed.items[0] ?? null;
  }

  async provision(tenantId: string) {
    const job = await this.master.tenantProvisioningJob.findFirst({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });

    // Re-runs are safe; the provisioner resumes from the last completed step.
    const result = await this.provisioning.provision(tenantId, job?.id);

    const refreshed = await this.master.tenantProvisioningJob.findUnique({
      where: { id: result.jobId },
    });
    if (!refreshed) throw Errors.notFound('Provisioning job', result.jobId);

    return {
      id: refreshed.id,
      tenantId: refreshed.tenantId,
      status: refreshed.status,
      currentStep: refreshed.currentStep,
      completedSteps: refreshed.completedSteps,
      attempts: refreshed.attempts,
      lastError: refreshed.lastError,
      startedAt: refreshed.startedAt?.toISOString() ?? null,
      finishedAt: refreshed.finishedAt?.toISOString() ?? null,
      createdAt: refreshed.createdAt.toISOString(),
    };
  }

  async provisioningJobs(tenantId: string) {
    const jobs = await this.master.tenantProvisioningJob.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return jobs.map((j) => ({
      id: j.id,
      tenantId: j.tenantId,
      status: j.status,
      currentStep: j.currentStep,
      completedSteps: j.completedSteps,
      attempts: j.attempts,
      lastError: j.lastError,
      startedAt: j.startedAt?.toISOString() ?? null,
      finishedAt: j.finishedAt?.toISOString() ?? null,
      createdAt: j.createdAt.toISOString(),
    }));
  }

  migrateTenant(tenantId: string) {
    return this.provisioning.migrateTenant(tenantId);
  }

  async setEntitlement(
    tenantId: string,
    input: { featureKey: string; enabled: boolean; limitValue?: number | null },
  ): Promise<void> {
    await this.entitlements.setOverride(tenantId, input);
  }

  async changeSubscription(tenantId: string, planCode: string) {
    const plan = await this.master.plan.findUnique({ where: { code: planCode.toUpperCase() } });
    if (!plan) throw Errors.notFound('Plan', planCode);

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

    const previous = await this.master.subscription.findUnique({
      where: { tenantId },
      select: { plan: { select: { code: true } } },
    });

    const subscription = await this.master.subscription.upsert({
      where: { tenantId },
      create: {
        tenantId,
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
      },
      update: {
        planId: plan.id,
        status: 'ACTIVE',
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        cancelledAt: null,
      },
    });

    await this.entitlements.syncPlanEntitlements(tenantId, plan.id);

    this.audit.record('platform', {
      action: AuditAction.SUBSCRIPTION_CHANGED,
      tenantId,
      resourceType: 'subscription',
      resourceId: subscription.id,
      metadata: { from: previous?.plan.code ?? null, to: plan.code, by: 'platform' },
    });

    return {
      id: subscription.id,
      tenantId,
      planId: plan.id,
      status: subscription.status,
      currentPeriodStart: subscription.currentPeriodStart.toISOString(),
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
      trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
      cancelledAt: null,
      createdAt: subscription.createdAt.toISOString(),
    };
  }

  // ============================================================== billing ==

  /**
   * Fleet-wide subscription picture: who is trialing, paying, behind or
   * lapsed, monthly recurring revenue by plan, recent charges and plan moves.
   *
   * MRR counts subscriptions that are currently earning their plan (ACTIVE, or
   * PAST_DUE inside the grace window) at the plan's *current* monthly price —
   * it is a run-rate, not booked revenue. Booked revenue is the invoices.
   */
  async billingOverview() {
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 86_400_000);

    const [subscriptions, tenantCounts, invoices30d, recentInvoices, planMoves, plans] =
      await Promise.all([
        this.master.subscription.findMany({
          where: { tenant: { deletedAt: null } },
          select: {
            status: true,
            currentPeriodEnd: true,
            plan: { select: { code: true, name: true, priceMonthly: true, sortOrder: true } },
          },
        }),
        this.master.tenant.groupBy({
          by: ['status'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        this.master.subscriptionInvoice.groupBy({
          by: ['status'],
          where: { createdAt: { gte: monthAgo } },
          _count: { _all: true },
          _sum: { amount: true },
        }),
        this.master.subscriptionInvoice.findMany({
          where: { status: { not: 'PENDING' } },
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: { tenant: { select: { name: true, slug: true } } },
        }),
        this.master.platformAuditLog.findMany({
          where: { action: 'SUBSCRIPTION_CHANGED', createdAt: { gte: monthAgo } },
          select: { metadata: true },
        }),
        this.master.plan.findMany({ select: { code: true, priceMonthly: true } }),
      ]);

    const price = new Map(plans.map((p) => [p.code, p.priceMonthly]));
    const byPlan = new Map<string, { code: string; name: string; sortOrder: number; stores: number; paying: number; mrr: number }>();
    let trialing = 0;
    let paying = 0;
    let pastDue = 0;
    let lapsed = 0;
    let mrr = 0;

    for (const sub of subscriptions) {
      const entry = byPlan.get(sub.plan.code) ?? {
        code: sub.plan.code,
        name: sub.plan.name,
        sortOrder: sub.plan.sortOrder,
        stores: 0,
        paying: 0,
        mrr: 0,
      };
      entry.stores += 1;

      if (isLapsed(sub, now)) {
        lapsed += 1;
      } else if (sub.status === 'TRIALING') {
        trialing += 1;
      } else {
        if (sub.status === 'PAST_DUE') pastDue += 1;
        if (sub.plan.priceMonthly > 0) {
          paying += 1;
          entry.paying += 1;
          entry.mrr += sub.plan.priceMonthly;
          mrr += sub.plan.priceMonthly;
        }
      }
      byPlan.set(sub.plan.code, entry);
    }

    let upgrades = 0;
    let downgrades = 0;
    for (const move of planMoves) {
      const meta = (move.metadata ?? {}) as { from?: string | null; to?: string };
      if (!meta.from || !meta.to || meta.from === meta.to) continue;
      const delta = (price.get(meta.to) ?? 0) - (price.get(meta.from) ?? 0);
      if (delta > 0) upgrades += 1;
      else if (delta < 0) downgrades += 1;
    }

    const invoiceStat = (status: string) => {
      const row = invoices30d.find((i) => i.status === status);
      return { count: row?._count._all ?? 0, amount: row?._sum.amount ?? 0 };
    };
    const tenantStatus = (status: string) =>
      tenantCounts.find((t) => t.status === status)?._count._all ?? 0;

    return {
      merchants: {
        total: tenantCounts.reduce((sum, t) => sum + t._count._all, 0),
        active: tenantStatus('ACTIVE'),
        suspended: tenantStatus('SUSPENDED'),
        trialing,
        paying,
        pastDue,
        lapsed,
      },
      mrr,
      currency: 'INR',
      byPlan: [...byPlan.values()].sort((a, b) => a.sortOrder - b.sortOrder),
      last30Days: {
        paid: invoiceStat('PAID'),
        failed: invoiceStat('FAILED'),
        upgrades,
        downgrades,
      },
      recentInvoices: recentInvoices.map((i) => ({
        id: i.id,
        tenantName: i.tenant.name,
        tenantSlug: i.tenant.slug,
        status: i.status,
        planCode: i.planCode,
        amount: i.amount,
        currency: i.currency,
        failureReason: i.failureReason,
        createdAt: i.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Resource use per store: catalogue size, orders, team and this month's AI
   * generations against the plan allowance. Sorted by AI use, the one metered
   * resource with a direct cost to the platform.
   *
   * Products and orders come from the denormalised counters the stats job
   * refreshes — one master query instead of opening every tenant database.
   * Storage and bandwidth are not tracked per tenant yet and are omitted
   * rather than estimated.
   */
  async usageReport() {
    const windowStart = aiQuotaWindowStart();

    const [tenants, staff, ai] = await Promise.all([
      this.master.tenant.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          statProducts: true,
          statOrders: true,
          statsUpdatedAt: true,
          subscription: { select: { plan: { select: { code: true, limits: true } } } },
        },
      }),
      this.master.tenantUser.groupBy({
        by: ['tenantId'],
        where: { isActive: true },
        _count: { _all: true },
      }),
      this.master.aiGeneration.groupBy({
        by: ['tenantId'],
        where: { createdAt: { gte: windowStart }, status: { in: ['PENDING', 'COMPLETED'] } },
        _count: { _all: true },
        _sum: { inputTokens: true, outputTokens: true },
      }),
    ]);

    const staffBy = new Map(staff.map((s) => [s.tenantId, s._count._all]));
    const aiBy = new Map(ai.map((a) => [a.tenantId, a]));

    const rows = tenants
      .map((t) => {
        const limits = (t.subscription?.plan.limits ?? {}) as Record<string, number>;
        const usage = aiBy.get(t.id);
        return {
          tenantId: t.id,
          name: t.name,
          slug: t.slug,
          status: t.status,
          planCode: t.subscription?.plan.code ?? 'FREE',
          products: t.statProducts,
          productLimit: limits.max_products ?? null,
          orders: t.statOrders,
          staff: staffBy.get(t.id) ?? 0,
          staffLimit: limits.max_staff ?? null,
          aiGenerations: usage?._count._all ?? 0,
          aiLimit: limits.ai_generations_per_month ?? 0,
          aiTokens: (usage?._sum.inputTokens ?? 0) + (usage?._sum.outputTokens ?? 0),
          statsUpdatedAt: t.statsUpdatedAt?.toISOString() ?? null,
        };
      })
      .sort((a, b) => b.aiGenerations - a.aiGenerations || b.products - a.products);

    return {
      windowStart: windowStart.toISOString(),
      totals: {
        aiGenerations: rows.reduce((s, r) => s + r.aiGenerations, 0),
        aiTokens: rows.reduce((s, r) => s + r.aiTokens, 0),
        products: rows.reduce((s, r) => s + r.products, 0),
        orders: rows.reduce((s, r) => s + r.orders, 0),
        staff: rows.reduce((s, r) => s + r.staff, 0),
      },
      tenants: rows,
    };
  }

  // ================================================================ plans ==

  async listPlans(): Promise<Plan[]> {
    const rows = await this.master.plan.findMany({ orderBy: { sortOrder: 'asc' } });
    return rows.map(toPlan);
  }

  async upsertPlan(input: Partial<Plan> & { code: string; name: string }): Promise<Plan> {
    const row = await this.master.plan.upsert({
      where: { code: input.code.toUpperCase() },
      create: {
        code: input.code.toUpperCase(),
        name: input.name,
        description: input.description ?? null,
        priceMonthly: input.priceMonthly ?? 0,
        priceYearly: input.priceYearly ?? 0,
        currency: input.currency ?? 'INR',
        trialDays: input.trialDays ?? 0,
        isActive: input.isActive ?? true,
        isPublic: input.isPublic ?? true,
        sortOrder: input.sortOrder ?? 0,
        features: (input.features ?? {}) as never,
        limits: (input.limits ?? {}) as never,
      },
      update: {
        name: input.name,
        description: input.description ?? null,
        ...(input.priceMonthly !== undefined ? { priceMonthly: input.priceMonthly } : {}),
        ...(input.priceYearly !== undefined ? { priceYearly: input.priceYearly } : {}),
        ...(input.trialDays !== undefined ? { trialDays: input.trialDays } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.features ? { features: input.features as never } : {}),
        ...(input.limits ? { limits: input.limits as never } : {}),
      },
    });
    return toPlan(row);
  }

  async updatePlan(id: string, input: Partial<Plan>): Promise<Plan> {
    const row = await this.master.plan.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.priceMonthly !== undefined ? { priceMonthly: input.priceMonthly } : {}),
        ...(input.priceYearly !== undefined ? { priceYearly: input.priceYearly } : {}),
        ...(input.trialDays !== undefined ? { trialDays: input.trialDays } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.isPublic !== undefined ? { isPublic: input.isPublic } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.features ? { features: input.features as never } : {}),
        ...(input.limits ? { limits: input.limits as never } : {}),
      },
    });
    return toPlan(row);
  }

  /** Refuses to delete a plan any tenant still depends on. */
  async deletePlan(id: string): Promise<void> {
    const inUse = await this.master.subscription.count({ where: { planId: id } });
    if (inUse > 0) {
      throw Errors.conflict(
        `This plan is in use by ${inUse} store(s). Move them to another plan first.`,
      );
    }
    await this.master.plan.delete({ where: { id } });
  }

  // ================================================================= ops ==

  async auditLogs(query: {
    page?: number;
    limit?: number;
    tenantId?: string;
    userId?: string;
    action?: string;
    resourceType?: string;
    dateFrom?: string;
    dateTo?: string;
  }): Promise<PaginatedResult<AuditLogEntry>> {
    const { skip, take, page, limit } = toPrismaPage(query);

    const where: Record<string, unknown> = {};
    if (query.tenantId) where.tenantId = query.tenantId;
    if (query.userId) where.userId = query.userId;
    if (query.action) where.action = query.action;
    if (query.resourceType) where.resourceType = query.resourceType;
    if (query.dateFrom || query.dateTo) {
      where.createdAt = {
        ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
        ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
      };
    }

    const [rows, total] = await Promise.all([
      this.master.platformAuditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.master.platformAuditLog.count({ where }),
    ]);

    const items: AuditLogEntry[] = rows.map((r) => ({
      id: r.id,
      tenantId: r.tenantId,
      tenantSlug: r.tenantSlug,
      userId: r.userId,
      userEmail: r.userEmail,
      action: r.action,
      resourceType: r.resourceType,
      resourceId: r.resourceId,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      requestId: r.requestId,
      metadata: r.metadata as Record<string, unknown> | null,
      createdAt: r.createdAt.toISOString(),
    }));

    return paginate(items, total, page, limit);
  }

  /** Per-service health, including a schema-drift check across the tenant fleet. */
  async systemHealth(): Promise<SystemHealthDetail[]> {
    const now = new Date().toISOString();
    const results: SystemHealthDetail[] = [];

    const masterStart = Date.now();
    const master = await this.master.healthCheck();
    results.push({
      service: 'master-database',
      status: master.ok ? 'ok' : 'error',
      latencyMs: Date.now() - masterStart,
      message: master.error ?? null,
      checkedAt: now,
    });

    const redisStart = Date.now();
    const redisOk = await this.cache.ping();
    results.push({
      service: 'redis',
      status: redisOk ? 'ok' : 'error',
      latencyMs: Date.now() - redisStart,
      message: null,
      checkedAt: now,
    });

    const queuesOk = await this.queue.isHealthy();
    results.push({
      service: 'queues',
      status: queuesOk ? 'ok' : 'error',
      latencyMs: null,
      message: null,
      checkedAt: now,
    });

    const pool = this.connections.stats();
    results.push({
      service: 'tenant-connection-pool',
      status: pool.openConnections < pool.maxConnections ? 'ok' : 'degraded',
      latencyMs: null,
      message: `${pool.openConnections}/${pool.maxConnections} open, ${pool.busy} busy`,
      checkedAt: now,
    });

    const outdated = await this.countOutdatedTenants();
    results.push({
      service: 'tenant-schema',
      status: outdated === 0 ? 'ok' : 'degraded',
      latencyMs: null,
      message:
        outdated === 0
          ? `All tenants at ${this.migrations.latestVersion}`
          : `${outdated} tenant database(s) behind ${this.migrations.latestVersion}`,
      checkedAt: now,
    });

    return results;
  }

  queueStats() {
    return this.queue.stats();
  }

  // =========================================================== internals ==

  private async countOutdatedTenants(): Promise<number> {
    return this.master.tenantDatabase.count({
      where: { status: 'READY', NOT: { schemaVersion: this.migrations.latestVersion } },
    });
  }

  /** Reads live counts from one tenant's own database. */
  private async liveTenantStats(tenantId: string) {
    try {
      return await this.tenantDb.runFor(tenantId, async (db) => {
        const [products, orders, customers, revenue] = await Promise.all([
          db.product.count({ where: { deletedAt: null } }),
          db.order.count(),
          db.customer.count({ where: { deletedAt: null } }),
          db.order.aggregate({
            where: { status: { in: ['CONFIRMED', 'PROCESSING', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED'] } },
            _sum: { totalAmount: true },
          }),
        ]);
        return { products, orders, customers, revenue: revenue._sum.totalAmount ?? 0 };
      });
    } catch (err) {
      // A tenant whose database is still provisioning should not 500 the page.
      this.logger.warn('Could not read live tenant stats', {
        tenantId,
        error: (err as Error).message,
      });
      return { products: 0, orders: 0, customers: 0, revenue: 0 };
    }
  }

  private async aggregateGmv(from: Date, to: Date): Promise<{ revenue: number; orders: number }> {
    // Uses the mirrored counters; `refresh-tenant-stats` keeps them current.
    const tenants = await this.master.tenant.findMany({
      where: { status: 'ACTIVE', deletedAt: null, statsUpdatedAt: { gte: from, lte: to } },
      select: { statRevenue: true, statOrders: true },
    });
    return {
      revenue: tenants.reduce((sum, t) => sum + bigIntToNumber(t.statRevenue), 0),
      orders: tenants.reduce((sum, t) => sum + t.statOrders, 0),
    };
  }
}

function toPlan(row: {
  id: string;
  code: string;
  name: string;
  description: string | null;
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  trialDays: number;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  features: unknown;
  limits: unknown;
}): Plan {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    priceMonthly: row.priceMonthly,
    priceYearly: row.priceYearly,
    currency: row.currency,
    trialDays: row.trialDays,
    isActive: row.isActive,
    isPublic: row.isPublic,
    sortOrder: row.sortOrder,
    features: (row.features ?? {}) as Record<string, boolean>,
    limits: (row.limits ?? {}) as Record<string, number>,
  };
}
