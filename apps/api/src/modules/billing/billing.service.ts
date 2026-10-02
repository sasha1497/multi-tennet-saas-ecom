import { Injectable } from '@nestjs/common';
import { BILLING_GRACE_DAYS } from '@retailos/config';
import { allowedFamilies, listTemplates } from '@retailos/templates';
import { AuditAction, LimitKey } from '@retailos/types';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { AppLogger } from '@/core/logger/logger.service';
import { EntitlementsService, isLapsed } from '@/modules/entitlements/entitlements.service';
import { AuditService } from '@/modules/audit/audit.service';
import { aiQuotaWindowEnd, countAiUsage } from '@/modules/ai/ai-usage';

/** How a simulated checkout should end. Development only. */
export type SimulatedOutcome = 'paid' | 'failed';

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
 * State lives in three master tables: `plans` (the catalogue and its prices —
 * edited by a super admin, never hard-coded in a client), `subscriptions` (one
 * per tenant) and `subscription_invoices` (one per charge, with the plan name
 * and amount copied so repricing never rewrites history).
 *
 * Lifecycle:
 *
 *   TRIALING ──pay──▶ ACTIVE ──period ends──▶ PAST_DUE ──grace ends──▶ EXPIRED
 *                       ▲  │                     │
 *                       └──┴───────pay──────────┘
 *
 * A lapsed store is never taken offline and never loses data. It drops to the
 * FREE floor's entitlements: premium and 3D templates stop being *selectable*,
 * the store keeps rendering whatever it already had, and paying again restores
 * everything at once.
 */
@Injectable()
export class BillingService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly entitlements: EntitlementsService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('Billing');
  }

  /**
   * Everything the Subscription page shows: the plans on offer, where this
   * store's subscription stands, what it is using against its limits, which
   * template families it has, and its billing history.
   */
  async overview(tenantId: string) {
    const [plans, subscription, entitlements, invoices, products, staff, aiUsed] =
      await Promise.all([
        this.master.plan.findMany({
          where: { isActive: true, isPublic: true },
          orderBy: { sortOrder: 'asc' },
        }),
        this.master.subscription.findUnique({ where: { tenantId }, include: { plan: true } }),
        this.entitlements.get(tenantId),
        this.master.subscriptionInvoice.findMany({
          where: { tenantId, status: { not: 'PENDING' } },
          orderBy: { createdAt: 'desc' },
          take: 24,
        }),
        this.tenantDb.run((db) => db.product.count({ where: { deletedAt: null } })),
        this.master.tenantUser.count({ where: { tenantId, isActive: true } }),
        countAiUsage(this.master, tenantId),
      ]);

    const now = new Date();
    const catalogue = listTemplates();
    const families = allowedFamilies(entitlements.features);
    const limit = (key: string) => entitlements.limits[key] ?? -1;

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
        sortOrder: plan.sortOrder,
        features: plan.features as Record<string, boolean>,
        limits: plan.limits as Record<string, number>,
        isCurrent: subscription?.planId === plan.id,
        /** Relative to the current plan, so the page can say Upgrade or Downgrade. */
        direction: !subscription
          ? ('upgrade' as const)
          : plan.id === subscription.planId
            ? ('current' as const)
            : plan.priceMonthly > subscription.plan.priceMonthly
              ? ('upgrade' as const)
              : ('downgrade' as const),
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
              (subscription.currentPeriodEnd.getTime() - now.getTime()) / 86_400_000,
            ),
            isTrialing: subscription.status === 'TRIALING',
            /** True once the store has dropped to the free floor. */
            lapsed: isLapsed(subscription, now),
            /** When a failed renewal stops being covered, for PAST_DUE only. */
            graceEndsAt:
              subscription.status === 'PAST_DUE'
                ? new Date(
                    subscription.currentPeriodEnd.getTime() + BILLING_GRACE_DAYS * 86_400_000,
                  ).toISOString()
                : null,
          }
        : null,
      /** The plan this store is actually being served, after lapse and overrides. */
      effective: {
        planCode: entitlements.planCode,
        features: entitlements.features,
        limits: entitlements.limits,
      },
      usage: {
        products: { used: products, limit: limit(LimitKey.MAX_PRODUCTS) },
        staff: { used: staff, limit: limit(LimitKey.MAX_STAFF) },
        aiGenerations: {
          used: aiUsed,
          limit: limit(LimitKey.AI_GENERATIONS_PER_MONTH),
          resetsAt: aiQuotaWindowEnd(now).toISOString(),
        },
      },
      templates: {
        families,
        counts: {
          standard: catalogue.filter((t) => t.tier === 'standard').length,
          premium: catalogue.filter((t) => t.tier === 'premium').length,
          '3d': catalogue.filter((t) => t.tier === '3d').length,
        },
      },
      invoices: invoices.map(toInvoice),
      /** Whether `startCheckout` can currently take a payment. */
      billingAvailable: this.gatewayConfigured(),
    };
  }

  /**
   * Begins a subscription payment: an upgrade, a downgrade or a renewal.
   *
   * **Read this before wiring a real gateway in.** Platform billing needs a
   * RetailOS-owned gateway account, recurring mandates and a webhook that is
   * the *only* thing allowed to mark a period paid. None of that is configured
   * yet, so outside development this refuses rather than pretending.
   *
   * The PENDING invoice written here is what `confirm` must match: amount and
   * plan are fixed server-side at this moment, so nothing the client sends
   * later can change what is being paid for.
   */
  async startCheckout(tenantId: string, planCode: string) {
    const plan = await this.master.plan.findUnique({ where: { code: planCode.toUpperCase() } });
    // A merchant can only buy what is on sale. FREE and contract plans are
    // assigned by the platform, never self-served.
    if (!plan || !plan.isActive || !plan.isPublic) throw Errors.notFound('Plan', planCode);

    if (!this.gatewayConfigured()) {
      throw Errors.badRequest(
        'Subscription payments are not available on this deployment yet. ' +
          'Your store keeps working on its current plan.',
        { planCode: plan.code },
      );
    }

    const subscription = await this.master.subscription.findUnique({ where: { tenantId } });
    const { start, end } = this.nextPeriod(subscription, plan.id);

    const reference = `sub_${tenantId.slice(0, 8)}_${plan.code.toLowerCase()}_${Date.now()}`;

    await this.master.subscriptionInvoice.create({
      data: {
        tenantId,
        reference,
        status: 'PENDING',
        planCode: plan.code,
        planName: plan.name,
        amount: plan.priceMonthly,
        currency: plan.currency,
        periodStart: start,
        periodEnd: end,
      },
    });

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
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
      /**
       * Development only. A real integration returns the gateway's own
       * checkout session here and the client never sees an amount it can edit.
       */
      simulated: true,
    };
  }

  /**
   * Settles a checkout — what a gateway webhook will eventually call.
   *
   * Paid: the invoice is marked PAID, the subscription moves to the invoiced
   * plan and period, and entitlements are resynced at once — an upgrade
   * unlocks premium or 3D templates on the very next request, and a downgrade
   * locks them, without touching the store's catalogue, orders, customers or
   * active template.
   *
   * Failed: the invoice is marked FAILED and an active subscription becomes
   * PAST_DUE. The plan does not change; the grace window applies.
   *
   * Idempotent on `reference`: confirming an already-settled invoice returns
   * its result again rather than charging or extending twice.
   */
  async confirm(
    tenantId: string,
    planCode: string,
    reference: string,
    outcome: SimulatedOutcome = 'paid',
  ) {
    if (!this.gatewayConfigured()) {
      throw Errors.badRequest('Subscription payments are not available on this deployment yet.');
    }

    // Matching on tenant as well as reference is what stops one merchant
    // confirming another's checkout.
    const invoice = await this.master.subscriptionInvoice.findFirst({
      where: { reference, tenantId },
    });
    if (!invoice || invoice.planCode !== planCode.toUpperCase()) {
      throw Errors.badRequest('That payment reference does not belong to this store');
    }

    if (invoice.status !== 'PENDING') {
      const current = await this.master.subscription.findUnique({ where: { tenantId } });
      return {
        status: current?.status ?? 'EXPIRED',
        invoiceStatus: invoice.status,
        planCode: invoice.planCode,
        planName: invoice.planName,
        currentPeriodEnd: current?.currentPeriodEnd.toISOString() ?? null,
      };
    }

    if (outcome === 'failed') return this.recordFailure(tenantId, invoice.id);

    const plan = await this.master.plan.findUnique({ where: { code: invoice.planCode } });
    if (!plan) throw Errors.notFound('Plan', invoice.planCode);

    const previous = await this.master.subscription.findUnique({
      where: { tenantId },
      include: { plan: { select: { code: true } } },
    });

    const subscription = await this.master.$transaction(async (tx) => {
      await tx.subscriptionInvoice.update({
        where: { id: invoice.id },
        data: { status: 'PAID', paidAt: new Date() },
      });
      return tx.subscription.upsert({
        where: { tenantId },
        create: {
          tenantId,
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart: invoice.periodStart,
          currentPeriodEnd: invoice.periodEnd,
        },
        update: {
          planId: plan.id,
          status: 'ACTIVE',
          currentPeriodStart: invoice.periodStart,
          currentPeriodEnd: invoice.periodEnd,
          trialEndsAt: null,
          cancelledAt: null,
        },
      });
    });

    // A plan change can widen or narrow what the store may do; entitlements are
    // the record of that, so they are resynced here rather than left stale.
    await this.entitlements.syncPlanEntitlements(tenantId, plan.id);

    this.audit.record('platform', {
      action: AuditAction.SUBSCRIPTION_CHANGED,
      tenantId,
      resourceType: 'subscription',
      resourceId: subscription.id,
      metadata: {
        from: previous?.plan.code ?? null,
        to: plan.code,
        amount: invoice.amount,
        reference,
      },
    });

    this.logger.info('Subscription paid', { tenantId, planCode: plan.code });

    return {
      status: subscription.status,
      invoiceStatus: 'PAID' as const,
      planCode: plan.code,
      planName: plan.name,
      currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    };
  }

  /**
   * Moves subscriptions along the lifecycle as time passes. Run daily by the
   * worker. Entitlements already compute lapse from dates on read, so this is
   * about making `status` tell the truth to people, not about access.
   */
  async advanceLifecycle(now: Date = new Date()): Promise<{ pastDue: number; expired: number }> {
    const graceCutoff = new Date(now.getTime() - BILLING_GRACE_DAYS * 86_400_000);

    const [toPastDue, toExpired] = await Promise.all([
      this.master.subscription.findMany({
        where: { status: 'ACTIVE', currentPeriodEnd: { lt: now } },
        select: { tenantId: true },
      }),
      this.master.subscription.findMany({
        where: {
          OR: [
            { status: 'TRIALING', currentPeriodEnd: { lt: now } },
            { status: 'PAST_DUE', currentPeriodEnd: { lt: graceCutoff } },
          ],
        },
        select: { tenantId: true },
      }),
    ]);

    if (toPastDue.length) {
      await this.master.subscription.updateMany({
        where: { tenantId: { in: toPastDue.map((s) => s.tenantId) } },
        data: { status: 'PAST_DUE' },
      });
    }
    if (toExpired.length) {
      await this.master.subscription.updateMany({
        where: { tenantId: { in: toExpired.map((s) => s.tenantId) } },
        data: { status: 'EXPIRED' },
      });
    }

    for (const { tenantId } of [...toPastDue, ...toExpired]) {
      await this.entitlements.invalidate(tenantId);
    }

    return { pastDue: toPastDue.length, expired: toExpired.length };
  }

  private async recordFailure(tenantId: string, invoiceId: string) {
    const invoice = await this.master.subscriptionInvoice.update({
      where: { id: invoiceId },
      data: { status: 'FAILED', failureReason: 'Payment was declined (simulated)' },
    });

    const subscription = await this.master.subscription.findUnique({ where: { tenantId } });
    if (subscription && subscription.status === 'ACTIVE') {
      await this.master.subscription.update({
        where: { tenantId },
        data: { status: 'PAST_DUE' },
      });
      await this.entitlements.invalidate(tenantId);
    }

    this.logger.warn('Subscription payment failed', { tenantId, planCode: invoice.planCode });

    return {
      status: subscription?.status === 'ACTIVE' ? 'PAST_DUE' : (subscription?.status ?? 'EXPIRED'),
      invoiceStatus: 'FAILED' as const,
      planCode: invoice.planCode,
      planName: invoice.planName,
      currentPeriodEnd: subscription?.currentPeriodEnd.toISOString() ?? null,
    };
  }

  /**
   * The period a payment buys.
   *
   * Renewing the *same* plan before it lapses extends from the current period
   * end, so paying early never forfeits days. A plan change — up or down —
   * takes effect now, for a fresh month.
   */
  private nextPeriod(
    subscription: { planId: string; status: string; currentPeriodEnd: Date } | null,
    planId: string,
  ): { start: Date; end: Date } {
    const now = new Date();
    const renewing =
      subscription !== null &&
      subscription.planId === planId &&
      subscription.status === 'ACTIVE' &&
      subscription.currentPeriodEnd > now;

    const start = renewing ? subscription.currentPeriodEnd : now;
    const end = new Date(start);
    end.setMonth(end.getMonth() + 1);
    return { start, end };
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

function toInvoice(row: {
  id: string;
  reference: string;
  status: string;
  planCode: string;
  planName: string;
  amount: number;
  currency: string;
  periodStart: Date;
  periodEnd: Date;
  paidAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
}) {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    planCode: row.planCode,
    planName: row.planName,
    amount: row.amount,
    currency: row.currency,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    paidAt: row.paidAt?.toISOString() ?? null,
    failureReason: row.failureReason,
    createdAt: row.createdAt.toISOString(),
  };
}
