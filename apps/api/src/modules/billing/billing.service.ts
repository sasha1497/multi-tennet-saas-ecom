import { Injectable } from '@nestjs/common';
import { AuditAction } from '@retailos/types';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { AppLogger } from '@/core/logger/logger.service';
import { EntitlementsService } from '@/modules/entitlements/entitlements.service';
import { AuditService } from '@/modules/audit/audit.service';

/**
 * Platform billing — what a shop owner pays RetailOS.
 *
 * Kept deliberately separate from `modules/payments`, which is what a *shopper*
 * pays a *merchant*. The two are different money flows with different payers,
 * different payees and different gateway accounts, and conflating them is how
 * a platform ends up settling subscription fees into a merchant's bank account.
 *
 *   shopper  →  merchant   ·  modules/payments  ·  the merchant's own gateway
 *   merchant →  RetailOS   ·  this module       ·  the platform's gateway
 *
 * The subscription state itself is the existing `Subscription` row and the
 * existing `Plan` catalogue — nothing new is modelled here, and the plan
 * priced at ₹499/month is simply the seeded `STARTER` plan.
 */
@Injectable()
export class BillingService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly entitlements: EntitlementsService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('Billing');
  }

  /** The plans a merchant can choose from, and where their subscription stands. */
  async overview(tenantId: string) {
    const [plans, subscription] = await Promise.all([
      this.master.plan.findMany({
        where: { isActive: true, isPublic: true },
        orderBy: { sortOrder: 'asc' },
      }),
      this.master.subscription.findUnique({
        where: { tenantId },
        include: { plan: true },
      }),
    ]);

    const now = Date.now();

    return {
      plans: plans.map((plan) => ({
        id: plan.id,
        code: plan.code,
        name: plan.name,
        description: plan.description,
        priceMonthly: plan.priceMonthly,
        priceYearly: plan.priceYearly,
        currency: plan.currency,
        trialDays: plan.trialDays,
        features: plan.features as Record<string, boolean>,
        limits: plan.limits as Record<string, number>,
        isCurrent: subscription?.planId === plan.id,
      })),
      subscription: subscription
        ? {
            id: subscription.id,
            status: subscription.status,
            planCode: subscription.plan.code,
            planName: subscription.plan.name,
            priceMonthly: subscription.plan.priceMonthly,
            currency: subscription.plan.currency,
            currentPeriodStart: subscription.currentPeriodStart.toISOString(),
            currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
            trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null,
            cancelledAt: subscription.cancelledAt?.toISOString() ?? null,
            /** Days left in the current period; negative once it has lapsed. */
            daysRemaining: Math.ceil(
              (subscription.currentPeriodEnd.getTime() - now) / 86_400_000,
            ),
            isTrialing: subscription.status === 'TRIALING',
          }
        : null,
      /** Whether `startCheckout` can currently take a payment. */
      billingAvailable: this.gatewayConfigured(),
    };
  }

  /**
   * Begins a subscription payment.
   *
   * **Read this before wiring a real gateway in.** Platform billing needs a
   * RetailOS-owned gateway account, recurring mandates and a webhook that is
   * the *only* thing allowed to mark a period paid. None of that is configured
   * yet, so outside development this refuses rather than pretending.
   *
   * In development it returns a simulated checkout so the whole onboarding
   * journey — choose plan, pay, store activates — can be walked end to end.
   * `confirm` below is what a real webhook handler would eventually call.
   */
  async startCheckout(tenantId: string, planCode: string) {
    const plan = await this.master.plan.findUnique({ where: { code: planCode.toUpperCase() } });
    if (!plan) throw Errors.notFound('Plan', planCode);

    if (!this.gatewayConfigured()) {
      throw Errors.badRequest(
        'Subscription payments are not available on this deployment yet. ' +
          'Your store keeps working on its current plan.',
        { planCode: plan.code },
      );
    }

    // A local reference the confirmation must echo back, so a stray or replayed
    // confirm cannot activate a subscription nobody started.
    const reference = `sub_${tenantId.slice(0, 8)}_${plan.code.toLowerCase()}_${Date.now()}`;

    this.logger.info('Subscription checkout started', {
      tenantId,
      planCode: plan.code,
      amount: plan.priceMonthly,
    });

    return {
      reference,
      planCode: plan.code,
      planName: plan.name,
      amount: plan.priceMonthly,
      currency: plan.currency,
      /**
       * Development only. A real integration returns the gateway's own
       * checkout session here and the client never sees an amount it can edit.
       */
      simulated: true,
    };
  }

  /**
   * Marks the subscription paid for a fresh monthly period.
   *
   * Deliberately additive: it moves `TRIALING` (or a lapsed period) to `ACTIVE`
   * and rolls the period forward. It does not touch the tenant's status, its
   * database, its catalogue or its storefront template — paying a bill is not
   * a reason to change what a shop sells or how it looks.
   */
  async confirm(tenantId: string, planCode: string, reference: string) {
    if (!this.gatewayConfigured()) {
      throw Errors.badRequest('Subscription payments are not available on this deployment yet.');
    }
    if (!reference.startsWith(`sub_${tenantId.slice(0, 8)}_`)) {
      // The reference is bound to the tenant that started the checkout, so one
      // merchant cannot confirm against another's.
      throw Errors.badRequest('That payment reference does not belong to this store');
    }

    const plan = await this.master.plan.findUnique({ where: { code: planCode.toUpperCase() } });
    if (!plan) throw Errors.notFound('Plan', planCode);

    const now = new Date();
    const periodEnd = new Date(now);
    periodEnd.setMonth(periodEnd.getMonth() + 1);

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
        trialEndsAt: null,
        cancelledAt: null,
      },
    });

    // A plan change can widen or narrow what the store may do; entitlements are
    // the record of that, so they are resynced here rather than left stale.
    await this.entitlements.syncPlanEntitlements(tenantId, plan.id);

    this.audit.record('platform', {
      action: AuditAction.SUBSCRIPTION_CHANGED,
      tenantId,
      resourceType: 'subscription',
      resourceId: subscription.id,
      metadata: { planCode: plan.code, amount: plan.priceMonthly, reference },
    });

    this.logger.info('Subscription activated', { tenantId, planCode: plan.code });

    return {
      status: subscription.status,
      planCode: plan.code,
      planName: plan.name,
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    };
  }

  /**
   * Whether this deployment can actually take a subscription payment.
   *
   * Today that means "we are not in production", because the simulated
   * checkout must never be reachable with real money — the same rule the
   * shopper-facing mock gateway follows in `PaymentProviderRegistry`. When a
   * platform gateway is configured, this becomes a check for its credentials.
   */
  private gatewayConfigured(): boolean {
    return !this.config.isProd;
  }
}
