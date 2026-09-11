'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  ChartNoAxesCombined,
  CreditCard,
  ExternalLink,
  Package,
  Palette,
  Plus,
  ShoppingBag,
  Sparkles,
  Store,
} from 'lucide-react';
import { formatMoney, ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from '@retailos/config';
import { Permission, type OrderStatus, type ReportRange } from '@retailos/types';
import {
  AreaChart,
  Badge,
  BarList,
  DataTable,
  EmptyState,
  ErrorState,
  SegmentedControl,
  Skeleton,
  type Column,
} from '@retailos/ui';
import {
  ButtonLink,
  ListRow,
  MetaChip,
  PageHead,
  PageShell,
  Panel,
  PanelBody,
  PanelHeader,
  PanelLink,
  Progress,
  StatCard,
  StepMarker,
} from '@/components/console/primitives';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const RANGES: { value: ReportRange; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'ytd', label: 'YTD' },
];

/** Maps an order status tone to the reserved status palette. Label always present. */
const STATUS_TONE_TO_VIZ: Record<
  string,
  'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'info'
> = {
  success: 'good',
  warning: 'warning',
  danger: 'critical',
  info: 'info',
  neutral: 'neutral',
};

/**
 * The store overview.
 *
 * Composed around what a shop owner opens it to find out, in order: is anything
 * waiting for me, how are we doing, and what should I do next. A brand-new store
 * gets a different first answer to a trading one — a setup path instead of four
 * zeroes and a flat line, which is the difference between a dashboard that looks
 * broken and one that looks like it is helping.
 *
 * Every figure comes from `/merchant/dashboard` and the three small lookups
 * below. Nothing is invented, and no metric the API does not return is drawn.
 */
export default function DashboardPage() {
  const [range, setRange] = useState<ReportRange>('30d');
  const { activeTenant, session, can } = useAuth();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', range, activeTenant?.tenantId],
    queryFn: () => api().merchant.dashboard({ range }),
  });

  /**
   * Setup signals.
   *
   * Three cheap reads the console already makes elsewhere, so they are warm in
   * the query cache by the time a merchant clicks through to the page each one
   * points at. Guarded by permission: a MANAGER without store-design rights
   * should not be shown a checklist they cannot complete.
   */
  const canDesign = can(Permission.STORE_DESIGN);
  const { data: settings } = useQuery({
    queryKey: ['store-settings'],
    queryFn: () => api().merchant.storeSettings(),
    enabled: canDesign,
  });
  const { data: productPage } = useQuery({
    queryKey: ['products', { limit: 1 }],
    queryFn: () => api().merchant.products({ limit: 1 }),
    enabled: can(Permission.PRODUCTS_READ),
  });
  const { data: categories } = useQuery({
    queryKey: ['categories'],
    queryFn: () => api().merchant.categories(),
    enabled: can(Permission.CATEGORIES_READ),
  });
  const { data: billing } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api().merchant.subscription(),
  });

  const currency = data?.currency ?? 'INR';
  const money = (v: number) => formatMoney(v, currency);
  const moneyCompact = (v: number) =>
    formatMoney(v, currency, { compact: true, hideDecimals: true });

  const productCount = productPage?.pagination.total ?? 0;
  const orderCount = Number(data?.totalOrders.value ?? 0);

  const steps = useMemo(
    () =>
      buildSetupSteps({
        hasProducts: productCount > 0,
        hasCategories: (categories?.length ?? 0) > 0,
        hasBranding: Boolean(settings?.logoUrl || settings?.description),
        isPublished: Boolean(settings?.isPublished),
        hasOrders: orderCount > 0,
      }),
    [productCount, categories, settings, orderCount],
  );

  const stepsDone = steps.filter((s) => s.done).length;
  // Only worth the space while there is something left to do — and only once we
  // actually know, so it never flashes in and out on a slow connection.
  const showSetup = canDesign && settings !== undefined && stepsDone < steps.length;

  const comparison = `vs previous ${range === 'ytd' ? 'year' : range.replace('d', ' days')}`;
  const hasRevenue = (data?.salesChart ?? []).some((p) => Number(p.revenue) > 0);

  if (isError) {
    return (
      <PageShell>
        <Panel>
          <ErrorState
            title="Could not load your dashboard"
            message={(error as Error)?.message}
            onRetry={() => void refetch()}
          />
        </Panel>
      </PageShell>
    );
  }

  const recentOrderColumns: Column<NonNullable<typeof data>['recentOrders'][number]>[] = [
    {
      key: 'orderNumber',
      header: 'Order',
      cell: (row) => (
        <Link
          href={`/orders/${row.id}`}
          className="nums font-medium text-primary hover:underline"
        >
          {row.orderNumber}
        </Link>
      ),
    },
    { key: 'customer', header: 'Customer', cell: (row) => row.customerName, hideBelowMd: true },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge tone={ORDER_STATUS_TONES[row.status]} dot>
          {ORDER_STATUS_LABELS[row.status]}
        </Badge>
      ),
    },
    {
      key: 'total',
      header: 'Total',
      align: 'right',
      cell: (row) => <span className="nums font-medium">{money(row.totalAmount)}</span>,
    },
  ];

  return (
    <PageShell>
      <PageHead
        title={`${greeting()}, ${session?.user.firstName ?? 'there'}`}
        description={
          activeTenant
            ? `Here is how ${activeTenant.tenantName} has been doing.`
            : 'Revenue, orders and stock at a glance.'
        }
        meta={
          <>
            {activeTenant && (
              <MetaChip
                icon={<ExternalLink className="h-3 w-3" />}
                href={activeTenant.storefrontUrl}
                external
              >
                {activeTenant.storefrontUrl.replace(/^https?:\/\//, '')}
              </MetaChip>
            )}
            {billing?.subscription && (
              <MetaChip
                icon={<CreditCard className="h-3 w-3" />}
                href="/subscription"
                tone={billing.subscription.isTrialing ? 'accent' : 'default'}
              >
                {billing.subscription.planName}
                {billing.subscription.isTrialing &&
                  ` · trial ends in ${billing.subscription.daysRemaining}d`}
              </MetaChip>
            )}
            {settings && (
              <MetaChip
                icon={
                  settings.isPublished ? (
                    <BadgeCheck className="h-3 w-3" />
                  ) : (
                    <Store className="h-3 w-3" />
                  )
                }
                href="/store/settings"
              >
                {settings.isPublished ? 'Storefront live' : 'Not published'}
              </MetaChip>
            )}
          </>
        }
        actions={
          <>
            <SegmentedControl
              options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
              value={range}
              onChange={(v) => setRange(v as ReportRange)}
            />
            {can(Permission.PRODUCTS_CREATE) && (
              <ButtonLink href="/products/new" size="sm" leftIcon={<Plus className="h-4 w-4" />}>
                Add product
              </ButtonLink>
            )}
          </>
        }
      />

      {showSetup && <SetupPanel steps={steps} done={stepsDone} />}

      {/* --------------------------------------------------------- metrics -- */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[124px] rounded-xl" />
          ))
        ) : (
          <>
            <StatCard
              label="Revenue"
              value={money(Number(data.totalRevenue.value))}
              changePercent={data.totalRevenue.changePercent}
              trend={data.totalRevenue.trend}
              comparisonLabel={comparison}
              series={data.salesChart.map((p) => Number(p.revenue))}
              href="/reports"
            />
            <StatCard
              label="Orders"
              value={String(data.totalOrders.value)}
              changePercent={data.totalOrders.changePercent}
              trend={data.totalOrders.trend}
              comparisonLabel={comparison}
              series={data.salesChart.map((p) => p.orders)}
              href="/orders"
            />
            <StatCard
              label="New customers"
              value={String(data.totalCustomers.value)}
              changePercent={data.totalCustomers.changePercent}
              trend={data.totalCustomers.trend}
              comparisonLabel={comparison}
              href="/customers"
            />
            <StatCard
              label="Average order"
              value={money(Number(data.averageOrderValue.value))}
              changePercent={data.averageOrderValue.changePercent}
              trend={data.averageOrderValue.trend}
              comparisonLabel={comparison}
            />
          </>
        )}
      </div>

      {/* Anything waiting on the merchant is surfaced before the analysis. */}
      {data && data.pendingOrders > 0 && (
        <Link
          href="/orders?status=PENDING"
          className="flex items-center gap-3 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-base text-warning-700 transition-colors hover:bg-warning-100 dark:border-warning-700/40 dark:bg-warning-700/15 dark:text-warning-100 dark:hover:bg-warning-700/25"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="flex-1">
            <strong className="nums">{data.pendingOrders}</strong>{' '}
            {data.pendingOrders === 1 ? 'order needs' : 'orders need'} your attention.
          </span>
          <ArrowRight className="h-4 w-4 shrink-0" aria-hidden="true" />
        </Link>
      )}

      {/* ---------------------------------------------------------- trend -- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Revenue"
            description={data ? `${data.range.label} · hover for daily figures` : undefined}
          />
          <PanelBody className="pt-2">
            {isLoading || !data ? (
              <Skeleton className="h-[248px] w-full" />
            ) : hasRevenue ? (
              <AreaChart
                data={data.salesChart.map((p) => ({ date: p.date, value: Number(p.revenue) }))}
                formatValue={moneyCompact}
                formatDate={(d) =>
                  new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
                }
                secondary={{ label: 'orders', values: data.salesChart.map((p) => p.orders) }}
                label="Revenue over time"
              />
            ) : (
              // A flat line at zero looks like a broken chart, not an empty one.
              <EmptyState
                icon={<ChartNoAxesCombined className="h-5 w-5" />}
                title="No revenue in this period"
                description="Your sales trend appears here once orders start coming in."
              />
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="Orders by status" />
          <PanelBody>
            {isLoading || !data ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <BarList
                items={data.ordersByStatus.map((s) => ({
                  label: ORDER_STATUS_LABELS[s.status as OrderStatus],
                  value: s.count,
                  tone: STATUS_TONE_TO_VIZ[ORDER_STATUS_TONES[s.status as OrderStatus]],
                  href: `/orders?status=${s.status}`,
                }))}
                emptyMessage="No orders in this period"
              />
            )}
          </PanelBody>
        </Panel>
      </div>

      {/* ------------------------------------------------------- activity -- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="Recent orders" action={<PanelLink href="/orders">All orders</PanelLink>} />
          <DataTable
            columns={recentOrderColumns}
            rows={data?.recentOrders ?? []}
            rowKey={(r) => r.id}
            loading={isLoading}
            empty={
              <EmptyState
                icon={<ShoppingBag className="h-5 w-5" />}
                title="No orders yet"
                description="Orders appear here the moment a customer checks out."
                action={
                  activeTenant && (
                    <a
                      href={activeTenant.storefrontUrl}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Visit your storefront
                    </a>
                  )
                }
              />
            }
          />
        </Panel>

        <Panel>
          <PanelHeader
            title="Top products"
            action={<PanelLink href="/products">Catalogue</PanelLink>}
          />
          <PanelBody>
            {isLoading || !data ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <BarList
                items={data.topProducts.map((p) => ({
                  label: p.productName,
                  value: p.unitsSold,
                  display: `${p.unitsSold} sold`,
                  meta: money(Number(p.revenue)),
                  href: `/products/${p.productId}`,
                }))}
                emptyMessage="No sales in this period"
              />
            )}
          </PanelBody>
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader title="Revenue by category" />
          <PanelBody>
            {isLoading || !data ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <BarList
                items={data.revenueByCategory.map((c) => ({
                  label: c.categoryName,
                  value: Number(c.revenue),
                  display: money(Number(c.revenue)),
                }))}
                emptyMessage="No category sales yet"
              />
            )}
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader
            title="Low stock"
            action={<PanelLink href="/inventory">Manage</PanelLink>}
          />
          <PanelBody>
            {isLoading || !data ? (
              <Skeleton className="h-40 w-full" />
            ) : data.lowStockItems.length === 0 ? (
              <p className="py-10 text-center text-sm text-content-muted">
                Everything is well stocked.
              </p>
            ) : (
              <ul className="-mx-2 space-y-0.5">
                {data.lowStockItems.map((item) => (
                  <li key={item.variantId}>
                    <ListRow
                      href={`/products/${item.productId}`}
                      title={item.productName}
                      subtitle={`${item.variantLabel} · ${item.sku}`}
                      trailing={
                        <Badge tone={item.available === 0 ? 'danger' : 'warning'} dot>
                          {item.available === 0 ? 'Out of stock' : `${item.available} left`}
                        </Badge>
                      }
                    />
                  </li>
                ))}
              </ul>
            )}
          </PanelBody>
        </Panel>
      </div>
    </PageShell>
  );
}

// ----------------------------------------------------------------- setup --

interface SetupStep {
  id: string;
  label: string;
  description: string;
  href: string;
  cta: string;
  icon: typeof Package;
  done: boolean;
}

/**
 * The path from "store created" to "store trading".
 *
 * Every step is derived from real state the API already returns — a product
 * count, a category count, the store's own `isPublished` flag — so the list
 * cannot congratulate a merchant for something they have not done, and it
 * disappears on its own when they finish.
 */
function buildSetupSteps(state: {
  hasProducts: boolean;
  hasCategories: boolean;
  hasBranding: boolean;
  isPublished: boolean;
  hasOrders: boolean;
}): SetupStep[] {
  return [
    {
      id: 'categories',
      label: 'Organise your catalogue',
      description: 'Create the categories shoppers will browse.',
      href: '/categories',
      cta: 'Manage categories',
      icon: Package,
      done: state.hasCategories,
    },
    {
      id: 'products',
      label: 'Add your first product',
      description: 'Photos, price and stock — you can refine it later.',
      href: '/products/new',
      cta: 'Add a product',
      icon: Plus,
      done: state.hasProducts,
    },
    {
      id: 'branding',
      label: 'Make it yours',
      description: 'Add a logo and tell customers who you are.',
      href: '/store',
      cta: 'Open store design',
      icon: Palette,
      done: state.hasBranding,
    },
    {
      id: 'publish',
      label: 'Publish your storefront',
      description: 'Take the shop out of draft so customers can buy.',
      href: '/store/settings',
      cta: 'Publish',
      icon: Store,
      done: state.isPublished,
    },
    {
      id: 'sale',
      label: 'Make your first sale',
      description: 'Share your store address and watch the orders arrive.',
      href: '/orders',
      cta: 'View orders',
      icon: ShoppingBag,
      done: state.hasOrders,
    },
  ];
}

function SetupPanel({ steps, done }: { steps: SetupStep[]; done: number }) {
  // The next unfinished step gets the emphasis and the only primary button —
  // a checklist where five things shout equally is a list, not guidance.
  const nextIndex = steps.findIndex((s) => !s.done);

  return (
    <Panel className="overflow-hidden">
      {/* The header is tinted so the checklist reads as one deliberate block
          rather than as a table that happens to sit at the top of the page. */}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-4 border-b border-primary/15 bg-primary-soft px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-fg">
            <Sparkles className="h-4.5 w-4.5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 className="text-md font-semibold text-content">Finish setting up your store</h2>
            <p className="mt-0.5 text-sm text-content-muted">
              {done} of {steps.length} done — a few minutes to go.
            </p>
          </div>
        </div>
        <div className="flex w-full max-w-[220px] items-center gap-3">
          <Progress value={done} total={steps.length} label="Store setup progress" />
          <span className="nums shrink-0 text-sm font-semibold text-primary">
            {Math.round((done / steps.length) * 100)}%
          </span>
        </div>
      </div>

      <ol className="divide-y divide-line">
        {steps.map((step, i) => {
          const isNext = i === nextIndex;
          return (
            <li
              key={step.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5"
            >
              <StepMarker index={i + 1} state={step.done ? 'done' : isNext ? 'current' : 'todo'} />
              {/* Claims enough width that the action wraps below on a phone
                  rather than squeezing the copy into a two-word column. */}
              <div className="min-w-[min(100%,16rem)] flex-1">
                <p
                  className={
                    step.done
                      ? 'text-base font-medium text-content-muted line-through decoration-content-subtle/60'
                      : 'text-base font-medium text-content'
                  }
                >
                  {step.label}
                </p>
                {!step.done && (
                  <p className="mt-0.5 text-sm text-content-muted">{step.description}</p>
                )}
              </div>
              {!step.done && (
                <Link
                  href={step.href}
                  className={
                    isNext
                      ? 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-fg transition-[filter] hover:brightness-110'
                      : 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-medium text-content transition-colors hover:bg-surface-muted'
                  }
                >
                  {step.cta}
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/** Local-time greeting. Purely cosmetic, and never the only thing on the line. */
function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}
