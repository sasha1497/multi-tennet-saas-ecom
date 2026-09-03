'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  IndianRupee,
  Package,
  ShoppingCart,
  Users,
} from 'lucide-react';
import { formatMoney, ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from '@retailos/config';
import type { OrderStatus, ReportRange } from '@retailos/types';
import {
  AreaChart,
  Badge,
  BarList,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedControl,
  Skeleton,
  StatTile,
  type Column,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const RANGES: { value: ReportRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'ytd', label: 'Year' },
];

/** Maps an order status to the reserved status palette — label always present. */
const STATUS_TONE_TO_VIZ: Record<string, 'good' | 'warning' | 'serious' | 'critical' | 'neutral' | 'info'> = {
  success: 'good',
  warning: 'warning',
  danger: 'critical',
  info: 'info',
  neutral: 'neutral',
};

export default function DashboardPage() {
  const [range, setRange] = useState<ReportRange>('30d');
  const { activeTenant } = useAuth();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['dashboard', range, activeTenant?.tenantId],
    queryFn: () => api().merchant.dashboard({ range }),
  });

  const currency = data?.currency ?? 'INR';
  const money = (v: number) => formatMoney(v, currency);
  const moneyCompact = (v: number) => formatMoney(v, currency, { compact: true, hideDecimals: true });

  if (isError) {
    return (
      <ErrorState
        title="Could not load your dashboard"
        message={(error as Error)?.message}
        onRetry={() => void refetch()}
      />
    );
  }

  const recentOrderColumns: Column<NonNullable<typeof data>['recentOrders'][number]>[] = [
    {
      key: 'orderNumber',
      header: 'Order',
      cell: (row) => (
        <Link href={`/orders/${row.id}`} className="font-medium text-primary hover:underline">
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
      cell: (row) => <span className="tabular font-medium">{money(row.totalAmount)}</span>,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={activeTenant ? `${activeTenant.tenantName} overview` : 'Dashboard'}
        description="Revenue, orders and stock at a glance."
        actions={
          // Filters sit in one row above the charts they control.
          <SegmentedControl
            options={RANGES.map((r) => ({ value: r.value, label: r.label }))}
            value={range}
            onChange={(v) => setRange(v as ReportRange)}
          />
        }
      />

      {/* KPI row — stat tiles, not one-bar charts. */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {isLoading || !data ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-[132px] rounded-xl" />)
        ) : (
          <>
            <StatTile
              label="Revenue"
              value={money(Number(data.totalRevenue.value))}
              changePercent={data.totalRevenue.changePercent}
              trend={data.totalRevenue.trend}
              comparisonLabel={`vs previous ${range === 'ytd' ? 'year' : range}`}
              icon={<IndianRupee className="h-4 w-4" />}
              sparkline={data.salesChart.map((p) => p.revenue)}
            />
            <StatTile
              label="Orders"
              value={String(data.totalOrders.value)}
              changePercent={data.totalOrders.changePercent}
              trend={data.totalOrders.trend}
              comparisonLabel={`vs previous ${range === 'ytd' ? 'year' : range}`}
              icon={<ShoppingCart className="h-4 w-4" />}
              sparkline={data.salesChart.map((p) => p.orders)}
            />
            <StatTile
              label="New customers"
              value={String(data.totalCustomers.value)}
              changePercent={data.totalCustomers.changePercent}
              trend={data.totalCustomers.trend}
              comparisonLabel={`vs previous ${range === 'ytd' ? 'year' : range}`}
              icon={<Users className="h-4 w-4" />}
            />
            <StatTile
              label="Average order value"
              value={money(Number(data.averageOrderValue.value))}
              changePercent={data.averageOrderValue.changePercent}
              trend={data.averageOrderValue.trend}
              comparisonLabel={`vs previous ${range === 'ytd' ? 'year' : range}`}
              icon={<Package className="h-4 w-4" />}
            />
          </>
        )}
      </div>

      {data && data.pendingOrders > 0 && (
        <Link
          href="/orders?status=PENDING"
          className="mt-4 flex items-center gap-3 rounded-xl border border-warning-200 bg-warning-50 px-4 py-3 text-sm text-warning-700 transition-colors hover:bg-warning-100 dark:border-warning-700/40 dark:bg-warning-700/15 dark:text-warning-100"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            <strong>{data.pendingOrders}</strong>{' '}
            {data.pendingOrders === 1 ? 'order needs' : 'orders need'} your attention.
          </span>
          <ArrowRight className="h-4 w-4 shrink-0" />
        </Link>
      )}

      {/* Revenue trend — single series, so no legend; the title names it. */}
      <Card className="mt-4">
        <CardHeader
          title="Revenue"
          description={data ? `${data.range.label} · hover for daily figures` : undefined}
        />
        <CardBody className="pt-2">
          {isLoading || !data ? (
            <Skeleton className="h-[260px] w-full" />
          ) : (
            <AreaChart
              data={data.salesChart.map((p) => ({ date: p.date, value: p.revenue }))}
              formatValue={moneyCompact}
              formatDate={(d) =>
                new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
              }
              secondary={{ label: 'orders', values: data.salesChart.map((p) => p.orders) }}
              label="Revenue over time"
            />
          )}
        </CardBody>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent orders"
            action={
              <Link href="/orders" className="text-sm font-medium text-primary hover:underline">
                View all
              </Link>
            }
          />
          <DataTable
            columns={recentOrderColumns}
            rows={data?.recentOrders ?? []}
            rowKey={(r) => r.id}
            loading={isLoading}
            empty={
              <EmptyState
                icon={<ShoppingCart className="h-5 w-5" />}
                title="No orders yet"
                description="Orders will appear here as soon as customers start buying."
              />
            }
          />
        </Card>

        <Card>
          <CardHeader title="Orders by status" />
          <CardBody>
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
          </CardBody>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader title="Top selling products" />
          <CardBody>
            {isLoading || !data ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <BarList
                items={data.topProducts.map((p) => ({
                  label: p.productName,
                  value: p.unitsSold,
                  display: `${p.unitsSold} sold`,
                  meta: money(p.revenue),
                  href: `/products/${p.productId}`,
                }))}
                emptyMessage="No sales in this period"
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Revenue by category" />
          <CardBody>
            {isLoading || !data ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <BarList
                items={data.revenueByCategory.map((c) => ({
                  label: c.categoryName,
                  value: c.revenue,
                  display: money(c.revenue),
                }))}
                emptyMessage="No category sales yet"
              />
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Low stock"
            action={
              <Link href="/inventory" className="text-sm font-medium text-primary hover:underline">
                Manage
              </Link>
            }
          />
          <CardBody>
            {isLoading || !data ? (
              <Skeleton className="h-40 w-full" />
            ) : data.lowStockItems.length === 0 ? (
              <p className="py-8 text-center text-sm text-content-muted">
                Everything is well stocked.
              </p>
            ) : (
              <ul className="space-y-3">
                {data.lowStockItems.map((item) => (
                  <li key={item.variantId} className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/products/${item.productId}`}
                        className="block truncate text-sm text-content hover:text-primary"
                      >
                        {item.productName}
                      </Link>
                      <p className="truncate text-xs text-content-subtle">
                        {item.variantLabel} · {item.sku}
                      </p>
                    </div>
                    <Badge tone={item.available === 0 ? 'danger' : 'warning'} dot>
                      {item.available === 0 ? 'Out of stock' : `${item.available} left`}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
