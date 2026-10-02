'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  Box,
  Check,
  CreditCard,
  Gem,
  Info,
  LayoutTemplate,
  Lock,
  Store,
  Wallet,
} from 'lucide-react';
import { formatMoney } from '@retailos/config';
import type { SubscriptionOverview, SubscriptionPlanOption } from '@retailos/api-client';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  Modal,
  Skeleton,
  cn,
  useToast,
} from '@retailos/ui';
import { ButtonLink, PageHead, Progress } from '@/components/console/primitives';
import { api } from '@/lib/api';
import { useErrorToast } from '@/lib/hooks';

/**
 * The shop owner's own bill.
 *
 * The single most important thing this page does is keep two kinds of money
 * apart. A shop owner pays RetailOS a monthly fee for the platform. Their
 * customers pay *them* for products. Those are different flows with different
 * payees, and a merchant who confuses them will eventually conclude the
 * platform is taking a cut of their sales. So it is said outright.
 *
 * Everything shown here — prices, what each plan includes, what this store is
 * actually allowed today — comes from the API. Nothing about a plan is decided
 * in this file.
 */
export default function SubscriptionPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <SubscriptionView />
    </Suspense>
  );
}

function SubscriptionView() {
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const params = useSearchParams();
  const [paying, setPaying] = useState<SubscriptionPlanOption | null>(null);
  const [simulateFailure, setSimulateFailure] = useState(false);
  const plansRef = useRef<HTMLDivElement>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api().merchant.subscription(),
  });

  // Arriving from an upgrade prompt (`?plan=PRO`) scrolls to that plan.
  const wanted = params.get('plan')?.toUpperCase() ?? null;
  useEffect(() => {
    if (wanted && data) plansRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [wanted, data]);

  const pay = useMutation({
    mutationFn: async ({ plan, fail }: { plan: SubscriptionPlanOption; fail: boolean }) => {
      const checkout = await api().merchant.startSubscriptionCheckout(plan.code);
      return api().merchant.confirmSubscription(plan.code, checkout.reference, fail ? 'failed' : 'paid');
    },
    onSuccess: (result) => {
      if (result.invoiceStatus === 'FAILED') {
        toast.error(
          'The payment did not go through',
          'Your plan stays active during the grace period. Try again with another method.',
        );
      } else {
        toast.success(
          `You're on ${result.planName}`,
          result.currentPeriodEnd
            ? `Paid through ${formatDate(result.currentPeriodEnd, 'long')}. New features are available now.`
            : undefined,
        );
      }
      setPaying(null);
      setSimulateFailure(false);
      void queryClient.invalidateQueries({ queryKey: ['subscription'] });
      void queryClient.invalidateQueries({ queryKey: ['current-tenant'] });
      void queryClient.invalidateQueries({ queryKey: ['store-templates'] });
    },
    onError: (err) => showError(err, 'Could not complete the payment'),
  });

  if (isLoading || !data) return <PageSkeleton />;

  const { subscription, plans, billingAvailable } = data;
  const current = plans.find((p) => p.isCurrent) ?? null;

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHead title="Subscription" description="What you pay RetailOS to run your store." />

      <WhoPaysWhom />

      {/* ── Status banners ─────────────────────────────────────────────── */}
      {subscription?.lapsed && (
        <Banner tone="warning">
          Your subscription has ended, so your store is on the basic allowance. Your storefront,
          products, orders and design are all still there — renew to switch everything back on.
        </Banner>
      )}
      {subscription && !subscription.lapsed && subscription.status === 'PAST_DUE' && (
        <Banner tone="warning">
          Your last payment did not go through. Everything keeps working until{' '}
          <strong>{formatDate(subscription.graceEndsAt ?? subscription.currentPeriodEnd)}</strong>
          ; pay before then to avoid losing plan features.
        </Banner>
      )}

      {/* ── Current plan + usage ───────────────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Your plan" />
          <CardBody>
            {subscription ? (
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-content">{subscription.planName}</h2>
                    <StatusBadge subscription={subscription} />
                  </div>
                  <p className="mt-1 text-sm text-content-muted tabular">
                    {subscription.priceMonthly > 0
                      ? `${formatMoney(subscription.priceMonthly, subscription.currency, { hideDecimals: true })} per month`
                      : 'Free'}
                  </p>
                  <p className="mt-2 text-xs text-content-subtle tabular">
                    {subscription.lapsed
                      ? `Ended ${formatDate(subscription.currentPeriodEnd)}`
                      : subscription.isTrialing
                        ? `Trial · ${Math.max(subscription.daysRemaining, 0)} day${subscription.daysRemaining === 1 ? '' : 's'} left`
                        : `${Math.max(subscription.daysRemaining, 0)} day${subscription.daysRemaining === 1 ? '' : 's'} left · renews ${formatDate(subscription.currentPeriodEnd)}`}
                  </p>
                  <FamiliesIncluded data={data} />
                </div>

                {billingAvailable && current && (
                  <Button
                    onClick={() => setPaying(current)}
                    rightIcon={<ArrowRight className="h-4 w-4" />}
                    className="shrink-0"
                  >
                    {subscription.lapsed
                      ? 'Renew now'
                      : subscription.isTrialing || subscription.status === 'PAST_DUE'
                        ? 'Pay now'
                        : 'Renew early'}
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

        <Card className="lg:col-span-2">
          <CardHeader title="This month's usage" />
          <CardBody className="space-y-4">
            <Meter label="Products" used={data.usage.products.used} limit={data.usage.products.limit} />
            <Meter label="Team members" used={data.usage.staff.used} limit={data.usage.staff.limit} />
            <Meter
              label="AI generations"
              used={data.usage.aiGenerations.used}
              limit={data.usage.aiGenerations.limit}
              note={`Resets ${formatDate(data.usage.aiGenerations.resetsAt)}`}
            />
          </CardBody>
        </Card>
      </div>

      {/* ── Plans ──────────────────────────────────────────────────────── */}
      <div ref={plansRef} className="scroll-mt-20">
        <h2 className="mb-3 text-base font-semibold text-content">Plans</h2>
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan, i) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              previous={i > 0 ? plans[i - 1]! : null}
              highlighted={wanted === plan.code}
              onChoose={() => setPaying(plan)}
              canPay={billingAvailable && plan.priceMonthly > 0}
            />
          ))}
        </div>
      </div>

      {!billingAvailable && (
        <Banner tone="info">
          Subscription payments are not switched on for this deployment yet. Your store keeps
          working on its current plan in the meantime.
        </Banner>
      )}

      {/* ── Billing history ────────────────────────────────────────────── */}
      <Card>
        <CardHeader title="Billing history" description="Charges from RetailOS for your plan." />
        {data.invoices.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<CreditCard className="h-5 w-5" />}
              title="No charges yet"
              description="Your payments to RetailOS will be listed here."
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-content-subtle">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Plan</th>
                  <th className="px-5 py-2.5 font-medium">Period</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.invoices.map((invoice) => (
                  <tr key={invoice.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 tabular text-content">{formatDate(invoice.createdAt)}</td>
                    <td className="px-5 py-3 text-content">{invoice.planName}</td>
                    <td className="px-5 py-3 tabular text-content-muted">
                      {formatDate(invoice.periodStart)} – {formatDate(invoice.periodEnd)}
                    </td>
                    <td className="px-5 py-3 text-right tabular text-content">
                      {formatMoney(invoice.amount, invoice.currency, { hideDecimals: true })}
                    </td>
                    <td className="px-5 py-3">
                      <Badge
                        tone={invoice.status === 'PAID' ? 'success' : invoice.status === 'FAILED' ? 'danger' : 'neutral'}
                        dot
                      >
                        {invoice.status === 'PAID' ? 'Paid' : invoice.status === 'FAILED' ? 'Failed' : invoice.status.toLowerCase()}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── Payment ────────────────────────────────────────────────────── */}
      <Modal
        open={paying !== null}
        onClose={() => setPaying(null)}
        title={
          paying?.direction === 'downgrade'
            ? `Move to ${paying.name}?`
            : paying?.direction === 'current'
              ? 'Renew your plan'
              : 'Confirm your subscription'
        }
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPaying(null)} disabled={pay.isPending}>
              Cancel
            </Button>
            <Button
              onClick={() => paying && pay.mutate({ plan: paying, fail: simulateFailure })}
              loading={pay.isPending}
            >
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

            {paying.direction === 'downgrade' ? (
              <DowngradeNotice from={current} to={paying} />
            ) : (
              <p className="mt-4 text-sm text-content-muted">
                Your storefront, products, orders and customers all continue exactly as they are.
                {paying.direction === 'upgrade'
                  ? ' New features switch on the moment the payment completes.'
                  : ' Paying early adds a month to the end of your current period.'}
              </p>
            )}

            {/* The simulator only exists outside production — the endpoint refuses
                there — so offering the failure path costs nothing and lets the
                past-due state be seen before a real gateway exists. */}
            <div className="mt-4 rounded-lg border border-dashed border-line px-3 py-2.5">
              <Checkbox
                label="Simulate a declined payment (test mode)"
                checked={simulateFailure}
                onChange={(e) => setSimulateFailure(e.target.checked)}
              />
            </div>
          </>
        )}
      </Modal>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────── pieces ──

function WhoPaysWhom() {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
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
            Money from your sales settles into your own gateway account. RetailOS takes no share
            of it and never touches it.
          </p>
        </div>
      </div>
    </div>
  );
}

const FAMILY_META = {
  standard: { label: 'Standard', icon: LayoutTemplate },
  premium: { label: 'Premium', icon: Gem },
  '3d': { label: '3D', icon: Box },
} as const;

function FamiliesIncluded({ data }: { data: SubscriptionOverview }) {
  const families = (['standard', 'premium', '3d'] as const).filter((f) => data.templates.counts[f] > 0);
  return (
    <div className="mt-4">
      <p className="eyebrow mb-2">Storefront designs</p>
      <ul className="flex flex-wrap gap-2">
        {families.map((family) => {
          const included = data.templates.families.includes(family);
          const Icon = FAMILY_META[family].icon;
          return (
            <li
              key={family}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium',
                included
                  ? 'border-primary/30 bg-primary-soft text-content'
                  : 'border-line bg-surface-muted text-content-subtle',
              )}
            >
              {included ? <Icon className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
              {FAMILY_META[family].label} · {data.templates.counts[family]}
            </li>
          );
        })}
      </ul>
      <ButtonLink href="/store/templates" variant="ghost" size="sm" className="mt-2 -ml-3">
        Browse designs
      </ButtonLink>
    </div>
  );
}

function StatusBadge({ subscription }: { subscription: NonNullable<SubscriptionOverview['subscription']> }) {
  if (subscription.lapsed) return <Badge tone="danger" dot>Ended</Badge>;
  if (subscription.isTrialing) return <Badge tone="info" dot>Trial</Badge>;
  if (subscription.status === 'PAST_DUE') return <Badge tone="warning" dot>Payment due</Badge>;
  return <Badge tone="success" dot>Active</Badge>;
}

function Meter({ label, used, limit, note }: { label: string; used: number; limit: number; note?: string }) {
  const unlimited = limit < 0;
  const near = !unlimited && limit > 0 && used / limit >= 0.8;
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
        <span className="text-content">{label}</span>
        <span className={cn('tabular', near ? 'font-semibold text-warning-700 dark:text-warning-100' : 'text-content-muted')}>
          {used}
          {unlimited ? '' : ` / ${limit}`}
          {unlimited && <span className="ml-1 text-content-subtle">· unlimited</span>}
        </span>
      </div>
      {!unlimited && <Progress value={Math.min(used, limit)} total={Math.max(limit, 1)} label={`${label} used`} />}
      {note && <p className="mt-1 text-[11px] text-content-subtle">{note}</p>}
    </div>
  );
}

/**
 * What a downgrade actually does — said before the merchant commits.
 *
 * Computed from the two plans' feature flags, so it is always the real list.
 * The reassurance is the guarantee the API makes: nothing is deleted, and a
 * design that leaves the plan stays live until the merchant picks another.
 */
function DowngradeNotice({ from, to }: { from: SubscriptionPlanOption | null; to: SubscriptionPlanOption }) {
  const losing = from
    ? Object.entries(from.features)
        .filter(([key, on]) => on && !to.features[key])
        .map(([key]) => FEATURE_LABEL[key] ?? key.replace(/_/g, ' '))
    : [];

  return (
    <div className="mt-4 space-y-3 text-sm">
      {losing.length > 0 && (
        <div>
          <p className="flex items-center gap-1.5 font-medium text-content">
            <ArrowDownRight className="h-4 w-4 text-warning-600" aria-hidden="true" />
            These will be locked
          </p>
          <ul className="mt-2 space-y-1">
            {losing.map((item) => (
              <li key={item} className="flex items-start gap-2 text-content-muted">
                <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-content-subtle" aria-hidden="true" />
                <span className="capitalize">{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="rounded-lg bg-surface-muted px-3 py-2.5 text-xs text-content-muted">
        Nothing is deleted. Your products, orders, customers and stock stay exactly as they are,
        and if your current storefront design is not in {to.name}, it stays live until you choose
        another one.
      </p>
    </div>
  );
}

function PlanCard({
  plan,
  previous,
  highlighted,
  onChoose,
  canPay,
}: {
  plan: SubscriptionPlanOption;
  /** The plan below this one; its features are summarised, not repeated. */
  previous: SubscriptionPlanOption | null;
  highlighted: boolean;
  onChoose: () => void;
  canPay: boolean;
}) {
  const included = PLAN_HIGHLIGHTS.filter(
    ([key]) => plan.features[key] && !previous?.features[key],
  ).map(([, label]) => label);
  const limit = (key: string, unit: string) => {
    const value = plan.limits[key];
    if (typeof value !== 'number') return null;
    return value === -1 ? `Unlimited ${unit}` : `${value.toLocaleString('en-IN')} ${unit}`;
  };

  return (
    <article
      className={cn(
        'flex min-w-0 flex-col rounded-xl border bg-surface-raised p-5 transition-shadow',
        plan.isCurrent ? 'border-primary ring-1 ring-primary' : 'border-line',
        highlighted && !plan.isCurrent && 'border-primary shadow-lg ring-2 ring-primary/40',
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
        {plan.priceMonthly > 0 && <span className="ml-1 text-sm text-content-muted">/month</span>}
      </p>

      {plan.description && (
        <p className="mt-2 text-sm leading-relaxed text-content-muted">{plan.description}</p>
      )}

      {/* Grows so every card's button sits on the same line, whatever the
          plan's feature count. */}
      <ul className="mt-4 flex-1 space-y-1.5">
        {previous && (
          <li className="pb-1 text-sm font-medium text-content">Everything in {previous.name}, plus:</li>
        )}
        {[
          ...included,
          limit('max_products', 'products'),
          limit('max_staff', plan.limits.max_staff === 1 ? 'team member' : 'team members'),
          limit('ai_generations_per_month', 'AI generations a month'),
        ]
          .filter((line): line is string => Boolean(line))
          .map((feature) => (
            <li key={feature} className="flex items-start gap-2 text-sm text-content-muted">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" aria-hidden="true" />
              <span>{feature}</span>
            </li>
          ))}
      </ul>

      <div className="mt-5 pt-1">
        {plan.isCurrent ? (
          <Button variant="outline" fullWidth disabled>
            Your plan
          </Button>
        ) : (
          <Button
            fullWidth
            // A downgrade should not wear the same button as an upgrade.
            variant={plan.direction === 'upgrade' ? 'primary' : 'outline'}
            onClick={onChoose}
            disabled={!canPay}
          >
            {plan.direction === 'upgrade' ? `Upgrade to ${plan.name}` : `Downgrade to ${plan.name}`}
          </Button>
        )}
      </div>
    </article>
  );
}

function Banner({ tone, children }: { tone: 'warning' | 'info'; children: React.ReactNode }) {
  return (
    <p
      className={cn(
        'flex items-start gap-2 rounded-lg border px-4 py-3 text-sm',
        tone === 'warning'
          ? 'border-warning-500/40 bg-warning-50 text-warning-700 dark:bg-warning-700/15 dark:text-warning-100'
          : 'border-line bg-surface-muted text-content-muted',
      )}
    >
      {tone === 'warning' ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      ) : (
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      )}
      <span>{children}</span>
    </p>
  );
}

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <Skeleton className="h-9 w-52" />
      <div className="grid gap-4 lg:grid-cols-5">
        <Skeleton className="h-48 rounded-xl lg:col-span-3" />
        <Skeleton className="h-48 rounded-xl lg:col-span-2" />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-80 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

function formatDate(iso: string, month: 'short' | 'long' = 'short'): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month, year: 'numeric' });
}

/** The lines a plan card leads with, in the order a merchant weighs them. */
const PLAN_HIGHLIGHTS: [string, string][] = [
  ['templates_3d', '3D storefront designs'],
  ['templates_premium', 'All premium storefront designs'],
  ['templates_standard', 'Six standard storefront designs'],
  ['ai_assistant', 'AI business assistant'],
  ['pos', 'Point of sale'],
  ['barcode', 'Barcode scanning'],
  ['advanced_reports', 'Advanced reports'],
  ['custom_domain', 'Your own domain'],
  ['crm', 'Customer CRM'],
  ['coupons', 'Coupons and discounts'],
  ['marketing', 'Marketing tools'],
  ['loyalty', 'Loyalty programme'],
  ['advanced_inventory', 'Advanced inventory'],
  ['advanced_analytics', 'Advanced analytics'],
  ['push_notifications', 'Push notifications'],
  ['ai_product_upload', 'AI product upload'],
  ['orders', 'Orders and cash on delivery'],
];

const FEATURE_LABEL: Record<string, string> = {
  ...Object.fromEntries(PLAN_HIGHLIGHTS),
  products: 'Product catalogue',
  staff: 'Team members',
  reports: 'Sales reports',
  delivery: 'Delivery management',
  multi_branch: 'Multiple branches',
  white_label_app: 'White-label mobile app',
};
