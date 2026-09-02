import { Injectable } from '@nestjs/common';
import { cacheKeys } from '@retailos/config';
import type { SubscriptionStatus, TenantEntitlements } from '@retailos/types';
import { Errors } from '@/common/errors/app.exception';
import { CacheService } from '@/core/cache/cache.service';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { AppLogger } from '@/core/logger/logger.service';

/** Applied when a tenant has no subscription at all — the free tier's floor. */
const FALLBACK_ENTITLEMENTS: TenantEntitlements = {
  features: {
    products: true,
    orders: true,
    staff: false,
    coupons: false,
    reports: false,
    advanced_analytics: false,
    custom_domain: false,
    delivery: false,
    loyalty: false,
    marketing: false,
    pos: false,
    multi_branch: false,
    white_label_app: false,
  },
  limits: {
    max_products: 25,
    max_staff: 1,
    max_orders_per_month: 100,
    max_storage_mb: 100,
  },
  planCode: 'FREE',
  planName: 'Free',
  subscriptionStatus: 'ACTIVE' as SubscriptionStatus,
};

/**
 * Effective plan features and quotas for a tenant.
 *
 * Two layers, resolved here so no caller has to know about either:
 *   • PLAN rows — rewritten wholesale whenever the subscription changes
 *   • OVERRIDE rows — set by support for one tenant; they win over the plan and
 *     survive plan changes, so "turn custom domains on for this one merchant"
 *     does not require inventing a bespoke plan
 *
 * Results are cached per tenant and invalidated on any plan/entitlement write.
 */
@Injectable()
export class EntitlementsService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly cache: CacheService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('Entitlements');
  }

  async get(tenantId: string): Promise<TenantEntitlements> {
    return this.cache.remember(cacheKeys.entitlements(tenantId), 300, async () => {
      const [subscription, overrides] = await Promise.all([
        this.master.subscription.findUnique({
          where: { tenantId },
          include: { plan: true },
        }),
        this.master.featureEntitlement.findMany({
          where: {
            tenantId,
            source: 'OVERRIDE',
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        }),
      ]);

      if (!subscription) {
        this.logger.warn('Tenant has no subscription; using fallback entitlements', { tenantId });
        return this.applyOverrides(FALLBACK_ENTITLEMENTS, overrides);
      }

      const planFeatures = (subscription.plan.features ?? {}) as Record<string, boolean>;
      const planLimits = (subscription.plan.limits ?? {}) as Record<string, number>;

      // An expired or cancelled subscription drops the tenant to the free floor
      // rather than locking them out — their storefront keeps serving customers.
      const lapsed =
        subscription.status === 'EXPIRED' ||
        subscription.status === 'CANCELLED' ||
        subscription.currentPeriodEnd < new Date();

      const base: TenantEntitlements = {
        features: lapsed
          ? { ...FALLBACK_ENTITLEMENTS.features }
          : { ...FALLBACK_ENTITLEMENTS.features, ...planFeatures },
        limits: lapsed
          ? { ...FALLBACK_ENTITLEMENTS.limits }
          : { ...FALLBACK_ENTITLEMENTS.limits, ...planLimits },
        planCode: subscription.plan.code,
        planName: subscription.plan.name,
        subscriptionStatus: subscription.status as SubscriptionStatus,
      };

      return this.applyOverrides(base, overrides);
    });
  }

  async isFeatureEnabled(tenantId: string, featureKey: string): Promise<boolean> {
    const entitlements = await this.get(tenantId);
    return entitlements.features[featureKey] === true;
  }

  /** Returns the quota for a key; `-1` means unlimited. */
  async getLimit(tenantId: string, limitKey: string): Promise<number> {
    const entitlements = await this.get(tenantId);
    const value = entitlements.limits[limitKey];
    return typeof value === 'number' ? value : -1;
  }

  /**
   * Throws when adding `adding` more of something would exceed the plan quota.
   * Called by services before creating products, staff, etc.
   */
  async assertWithinLimit(
    tenantId: string,
    limitKey: string,
    currentCount: number,
    adding = 1,
  ): Promise<void> {
    const limit = await this.getLimit(tenantId, limitKey);
    if (limit < 0) return; // unlimited
    if (currentCount + adding > limit) {
      throw Errors.planLimitReached(limitKey, limit, currentCount);
    }
  }

  async assertFeature(tenantId: string, featureKey: string): Promise<void> {
    if (!(await this.isFeatureEnabled(tenantId, featureKey))) {
      throw Errors.featureNotEntitled(featureKey);
    }
  }

  /**
   * Materialises a plan's features into PLAN-sourced rows.
   *
   * Storing them (rather than only reading the plan JSON) means the platform
   * console can show and audit exactly what a tenant is entitled to, and a
   * later plan edit does not silently rewrite history for existing tenants
   * until they are explicitly re-synced.
   */
  async syncPlanEntitlements(tenantId: string, planId: string): Promise<void> {
    const plan = await this.master.plan.findUnique({ where: { id: planId } });
    if (!plan) throw Errors.notFound('Plan', planId);

    const features = (plan.features ?? {}) as Record<string, boolean>;
    const limits = (plan.limits ?? {}) as Record<string, number>;

    await this.master.$transaction(async (tx) => {
      await tx.featureEntitlement.deleteMany({ where: { tenantId, source: 'PLAN' } });

      const rows = Object.entries(features).map(([featureKey, enabled]) => ({
        tenantId,
        featureKey,
        enabled,
        limitValue: limits[featureKey] ?? null,
        source: 'PLAN' as const,
      }));

      // Quota keys are entitlements too, so they show up in the same audit view.
      for (const [limitKey, value] of Object.entries(limits)) {
        if (features[limitKey] === undefined) {
          rows.push({
            tenantId,
            featureKey: limitKey,
            enabled: true,
            limitValue: value,
            source: 'PLAN' as const,
          });
        }
      }

      if (rows.length) {
        await tx.featureEntitlement.createMany({ data: rows, skipDuplicates: true });
      }
    });

    await this.invalidate(tenantId);
    this.logger.info('Synced plan entitlements', { tenantId, planCode: plan.code });
  }

  /** Support-level override for one tenant. */
  async setOverride(
    tenantId: string,
    params: { featureKey: string; enabled: boolean; limitValue?: number | null; expiresAt?: Date | null },
  ): Promise<void> {
    await this.master.featureEntitlement.upsert({
      where: { tenantId_featureKey: { tenantId, featureKey: params.featureKey } },
      create: {
        tenantId,
        featureKey: params.featureKey,
        enabled: params.enabled,
        limitValue: params.limitValue ?? null,
        expiresAt: params.expiresAt ?? null,
        source: 'OVERRIDE',
      },
      update: {
        enabled: params.enabled,
        limitValue: params.limitValue ?? null,
        expiresAt: params.expiresAt ?? null,
        source: 'OVERRIDE',
      },
    });
    await this.invalidate(tenantId);
  }

  async invalidate(tenantId: string): Promise<void> {
    await this.cache.del(cacheKeys.entitlements(tenantId));
  }

  private applyOverrides(
    base: TenantEntitlements,
    overrides: { featureKey: string; enabled: boolean; limitValue: number | null }[],
  ): TenantEntitlements {
    if (overrides.length === 0) return base;

    const features = { ...base.features };
    const limits = { ...base.limits };

    for (const o of overrides) {
      features[o.featureKey] = o.enabled;
      if (o.limitValue !== null) limits[o.featureKey] = o.limitValue;
    }

    return { ...base, features, limits };
  }
}
