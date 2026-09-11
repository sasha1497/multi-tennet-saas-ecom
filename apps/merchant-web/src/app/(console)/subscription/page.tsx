'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Check, CreditCard, Info, Store, Wallet } from 'lucide-react';
import { formatMoney } from '@retailos/config';
import type { SubscriptionPlanOption } from '@retailos/api-client';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Modal,
  Skeleton,
  cn,
  useToast,
} from '@retailos/ui';
import { PageHead } from '@/components/console/primitives';
import { api } from '@/lib/api';
import { useErrorToast } from '@/lib/hooks';

/**
 * The shop owner's own bill.
 *
 * The single most important thing this page does is keep two kinds of money
 * apart. A shop owner pays RetailOS ₹499 a month for the platform. Their
 * customers pay *them* for products. Those are different flows with different
 * payees, and a merchant who confuses them will eventually conclude the
 * platform is taking a cut of their sales. So it is said outright.
 */
export default function SubscriptionPage() {
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const [paying, setPaying] = useState<SubscriptionPlanOption | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api().merchant.subscription(),
  });

  const pay = useMutation({
    mutationFn: async (plan: SubscriptionPlanOption) => {
      const checkout = await api().merchant.startSubscriptionCheckout(plan.code);
      return api().merchant.confirmSubscription(plan.code, checkout.reference);
    },
    onSuccess: (result) => {
      toast.success(
        `You're on ${result.planName}`,
        `Paid through ${new Date(result.currentPeriodEnd).toLocaleDateString('en-IN', {
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}.`,
      );
      setPaying(null);
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });
      void queryClient.invalidateQueries({ queryKey: ['current-tenant'] });
    },
    onError: (err) => showError(err, 'Could not complete the payment'),
  });

  if (isLoading || !data) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-72 rounded-xl" />
      </div>
    );
  }

  const { subscription, plans, billingAvailable } = data;
  const lapsed = subscription != null && subscription.daysRemaining < 0;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHead
        title="Subscription"
        description="What you pay RetailOS to run your store."
      />

      {/* ── Who pays whom ──────────────────────────────────────────────── */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <div className="flex items-start gap-3 rounded-xl border border-primary/30 bg-primary-soft p-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-fg">
            <CreditCard className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-content">You pay RetailOS</p>
            <p className="mt-0.5 text-xs leading-relaxed text-content-muted">
              A monthly fee for the platform: your storefront, your admin panel and your own
              database. That is this page.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-raised p-4">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-content-muted">
            <Wallet className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-semibold text-content">Your customers pay you</p>
            <p className="mt-0.5 text-xs leading-relaxed text-content-muted">
              Money from your sales settles into your own gateway account. RetailOS takes no
              share of it and never touches it.
            </p>
          </div>
        </div>
      </div>

      {/* ── Current subscription ───────────────────────────────────────── */}
      <Card className="mb-5">
        <CardHeader title="Your plan" />
        <CardBody>
          {subscription ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-content">{subscription.planName}</h2>
                  <Badge
                    tone={
                      subscription.status === 'ACTIVE'
                        ? 'success'
                        : subscription.isTrialing
                          ? 'info'
                          : 'warning'
                    }
                    dot
                  >
                    {subscription.isTrialing ? 'Trial' : subscription.status.toLowerCase()}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-content-muted tabular">
                  {subscription.priceMonthly > 0
                    ? `${formatMoney(subscription.priceMonthly, subscription.currency, { hideDecimals: true })} per month`
                    : 'Free'}
                </p>
                <p className="mt-2 text-xs text-content-subtle tabular">
                  {lapsed
                    ? `Expired ${Math.abs(subscription.daysRemaining)} day${Math.abs(subscription.daysRemaining) === 1 ? '' : 's'} ago`
                    : `${subscription.daysRemaining} day${subscription.daysRemaining === 1 ? '' : 's'} left · renews ${new Date(
                        subscription.currentPeriodEnd,
                      ).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
                </p>
              </div>

              {(subscription.isTrialing || lapsed) && billingAvailable && (
                <Button
                  onClick={() => {
                    const plan = plans.find((p) => p.code === subscription.planCode) ?? plans[0];
                    setPaying(plan);
                  }}
                  rightIcon={<ArrowRight className="h-4 w-4" />}
                >
                  {lapsed ? 'Renew now' : 'Pay now'}
                </Button>
              )}
            </div>
          ) : (
            <p className="text-sm text-content-muted">
              No subscription on record. Choose a plan below to get started.
            </p>
          )}
        </CardBody>
      </Card>

      {lapsed && (
        <p className="mb-5 flex items-start gap-2 rounded-lg border border-warning-500/40 bg-warning-50 px-4 py-3 text-sm text-warning-700 dark:bg-warning-700/15 dark:text-warning-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Your subscription period has ended. Renew to keep your storefront and store design
          available.
        </p>
      )}

      {/* ── Plans ──────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            onChoose={() => setPaying(plan)}
            canPay={billingAvailable && plan.priceMonthly > 0}
          />
        ))}
      </div>

      {!billingAvailable && (
        <p className="mt-5 flex items-start gap-2 rounded-lg border border-line bg-surface-muted px-4 py-3 text-xs text-content-muted">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Subscription payments are not switched on for this deployment yet. Your store keeps
          working on its current plan in the meantime.
        </p>
      )}

      {/* ── Payment ────────────────────────────────────────────────────── */}
      <Modal
        open={paying !== null}
        onClose={() => setPaying(null)}
        title="Confirm your subscription"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaying(null)} disabled={pay.isPending}>
              Cancel
            </Button>
            <Button onClick={() => paying && pay.mutate(paying)} loading={pay.isPending}>
              Pay {paying && formatMoney(paying.priceMonthly, paying.currency, { hideDecimals: true })}
            </Button>
          </>
        }
      >
        {paying && (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-line bg-surface-muted p-4">
              <Store className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-content">{paying.name}</p>
                <p className="text-xs text-content-muted tabular">
                  {formatMoney(paying.priceMonthly, paying.currency, { hideDecimals: true })} per
                  month · billed to you by RetailOS
                </p>
              </div>
            </div>
            <p className="mt-4 text-sm text-content-muted">
              Your storefront, products, orders and customers all continue exactly as they are.
              Paying renews your access to the platform for another month.
            </p>
          </>
        )}
      </Modal>
    </div>
  );
}

function PlanCard({
  plan,
  onChoose,
  canPay,
}: {
  plan: SubscriptionPlanOption;
  onChoose: () => void;
  canPay: boolean;
}) {
  const included = Object.entries(plan.features)
    .filter(([, enabled]) => enabled)
    .map(([key]) => FEATURE_LABEL[key] ?? key.replace(/_/g, ' '));

  return (
    <article
      className={cn(
        'flex flex-col rounded-xl border bg-surface-raised p-5',
        plan.isCurrent ? 'border-primary ring-1 ring-primary' : 'border-line',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-content">{plan.name}</h3>
        {plan.isCurrent && <Badge tone="info">Current</Badge>}
      </div>

      <p className="mt-2">
        <span className="text-2xl font-bold text-content tabular">
          {plan.priceMonthly > 0
            ? formatMoney(plan.priceMonthly, plan.currency, { hideDecimals: true })
            : 'Free'}
        </span>
        {plan.priceMonthly > 0 && (
          <span className="ml-1 text-sm text-content-muted">/month</span>
        )}
      </p>

      {plan.description && (
        <p className="mt-2 text-sm leading-relaxed text-content-muted">{plan.description}</p>
      )}

      {/* Grows so every card's button sits on the same line, whatever the
          plan's feature count. */}
      <ul className="mt-4 flex-1 space-y-1.5">
        {included.slice(0, 6).map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-content-muted">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" aria-hidden="true" />
            <span className="capitalize">{feature}</span>
          </li>
        ))}
        {typeof plan.limits.max_products === 'number' && (
          <li className="flex items-start gap-2 text-sm text-content-muted">
            <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" aria-hidden="true" />
            <span className="tabular">
              {plan.limits.max_products === -1
                ? 'Unlimited products'
                : `Up to ${plan.limits.max_products} products`}
            </span>
          </li>
        )}
      </ul>

      <div className="mt-5 pt-1">
        {plan.isCurrent ? (
          <Button variant="outline" fullWidth disabled>
            Your plan
          </Button>
        ) : (
          <Button
            fullWidth
            // A free plan is a downgrade, not an upsell — it should not wear
            // the same button as the plan we would like them to buy.
            variant={plan.priceMonthly > 0 ? 'primary' : 'outline'}
            onClick={onChoose}
            disabled={!canPay}
          >
            {plan.priceMonthly > 0 ? 'Choose this plan' : 'Downgrade'}
          </Button>
        )}
      </div>
    </article>
  );
}

const FEATURE_LABEL: Record<string, string> = {
  products: 'Product catalogue',
  orders: 'Order management',
  staff: 'Team members',
  coupons: 'Coupons and discounts',
  reports: 'Sales reports',
  advanced_analytics: 'Advanced analytics',
  custom_domain: 'Your own domain',
  delivery: 'Delivery management',
  loyalty: 'Loyalty programme',
  marketing: 'Marketing tools',
  pos: 'Point of sale',
  multi_branch: 'Multiple branches',
  white_label_app: 'White-label mobile app',
};
