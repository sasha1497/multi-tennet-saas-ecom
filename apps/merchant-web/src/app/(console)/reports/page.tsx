'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatMoney, ORDER_STATUS_LABELS } from '@retailos/config';
import type { OrderStatus, ReportRange } from '@retailos/types';
import {
  AreaChart,
  BarList,
  EmptyState,
  SegmentedControl,
  Skeleton,
  Tabs,
} from '@retailos/ui';
import {
  PageHead,
  Panel,
  PanelBody,
  PanelHeader,
  StatCard,
} from '@/components/console/primitives';
import { api } from '@/lib/api';

const RANGES = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'ytd', label: 'Year' },
];

export default function ReportsPage() {
  const [tab, setTab] = useState<'sales' | 'customers' | 'inventory'>('sales');
  const [range, setRange] = useState<ReportRange>('30d');

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHead
        title="Analytics"
        description="Sales, customers and stock value."
        actions={
          tab !== 'inventory' && (
            <SegmentedControl
              options={RANGES}
              value={range}
              onChange={(v) => setRange(v as ReportRange)}
            />
          )
        }
      />

      <Tabs
        tabs={[
          { id: 'sales', label: 'Sales' },
          { id: 'customers', label: 'Customers' },
          { id: 'inventory', label: 'Inventory' },
        ]}
        active={tab}
        onChange={(id) => setTab(id as typeof tab)}
        className="mb-4"
      />

      {tab === 'sales' && <SalesReport range={range} />}
      {tab === 'customers' && <CustomerReport range={range} />}
      {tab === 'inventory' && <InventoryReport />}
    </div>
  );
}

function SalesReport({ range }: { range: ReportRange }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report-sales', range],
    queryFn: () => api().merchant.salesReport({ range }),
  });

  if (isLoading || !data) return <Skeleton className="h-96 rounded-xl" />;

  const money = (v: number) => formatMoney(v, data.currency);

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Revenue" value={money(data.totals.revenue)} comparisonLabel="in this period" />
        <StatCard label="Orders" value={String(data.totals.orders)} comparisonLabel="in this period" />
        <StatCard
          label="Items sold"
          value={String(data.totals.itemsSold)}
          comparisonLabel="in this period"
        />
        <StatCard
          label="Average order"
          value={money(data.totals.averageOrderValue)}
          comparisonLabel="in this period"
        />
      </div>

      <Panel>
        <PanelHeader title="Revenue by day" />
        <PanelBody className="pt-2">
          {/* All-zero days plot as a flat rule against a ₹1/₹1/₹1 axis, which
              reads as a broken chart rather than an empty one. */}
          {data.byDay.some((d) => d.revenue > 0) ? (
            <AreaChart
              data={data.byDay.map((d) => ({ date: d.date, value: d.revenue }))}
              formatValue={(v) =>
                formatMoney(v, data.currency, { compact: true, hideDecimals: true })
              }
              formatDate={(d) =>
                new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
              }
              secondary={{ label: 'orders', values: data.byDay.map((d) => d.orders) }}
            />
          ) : (
            <EmptyState
              title="No revenue in this period"
              description="Once orders come in, your daily revenue is plotted here."
            />
          )}
        </PanelBody>
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="By payment method" />
          <PanelBody>
            <BarList
              items={data.byPaymentMethod.map((m) => ({
                label: m.method,
                value: m.revenue,
                display: money(m.revenue),
                meta: `${m.orders} order${m.orders === 1 ? '' : 's'}`,
              }))}
            />
          </PanelBody>
        </Panel>

        <Panel>
          <PanelHeader title="By status" />
          <PanelBody>
            <BarList
              items={data.byStatus.map((s) => ({
                label: ORDER_STATUS_LABELS[s.status as OrderStatus],
                value: s.orders,
                display: `${s.orders}`,
                meta: money(s.revenue),
              }))}
            />
          </PanelBody>
        </Panel>
      </div>

      <Panel>
        <PanelHeader title="Breakdown" />
        <PanelBody>
          <dl className="grid gap-3 sm:grid-cols-3">
            <Stat label="Discounts given" value={money(data.totals.discountGiven)} />
            <Stat label="Tax collected" value={money(data.totals.taxCollected)} />
            <Stat label="Delivery collected" value={money(data.totals.shippingCollected)} />
          </dl>
        </PanelBody>
      </Panel>
    </div>
  );
}

function CustomerReport({ range }: { range: ReportRange }) {
  const { data, isLoading } = useQuery({
    queryKey: ['report-customers', range],
    queryFn: () => api().merchant.customerReport({ range }),
  });

  if (isLoading || !data) return <Skeleton className="h-80 rounded-xl" />;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="New customers"
          value={String(data.newCustomers)}
          comparisonLabel="in this period"
        />
        <StatCard
          label="Returning customers"
          value={String(data.returningCustomers)}
          comparisonLabel="ordered more than once"
        />
      </div>

      <Panel>
        <PanelHeader title="Top customers by lifetime value" />
        <PanelBody>
          <BarList
            items={data.topCustomers.map((c) => ({
              label: c.name,
              value: c.totalSpent,
              display: formatMoney(c.totalSpent),
              meta: `${c.orderCount} order${c.orderCount === 1 ? '' : 's'}`,
            }))}
            emptyMessage="No customer orders yet"
          />
        </PanelBody>
      </Panel>
    </div>
  );
}

function InventoryReport() {
  const { data, isLoading } = useQuery({
    queryKey: ['report-inventory'],
    queryFn: () => api().merchant.inventoryReport(),
  });

  if (isLoading || !data) return <Skeleton className="h-80 rounded-xl" />;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Stock value" value={formatMoney(data.stockValue)} comparisonLabel="at cost price" />
        <StatCard label="In stock" value={String(data.inStock)} comparisonLabel="variants" />
        <StatCard
          label="Low stock"
          value={String(data.lowStock)}
          comparisonLabel="need restocking"
          trend={data.lowStock > 0 ? 'up' : 'flat'}
          invertTrend
        />
        <StatCard
          label="Out of stock"
          value={String(data.outOfStock)}
          comparisonLabel="unavailable"
          trend={data.outOfStock > 0 ? 'up' : 'flat'}
          invertTrend
        />
      </div>

      <Panel>
        <PanelHeader title="Items needing attention" />
        <PanelBody>
          <BarList
            items={data.lowStockItems.map((item) => ({
              label: `${item.productName} · ${item.variantLabel}`,
              value: Math.max(item.available, 0),
              display: `${item.available} left`,
              tone: item.available === 0 ? 'critical' : 'warning',
              href: `/products/${item.productId}`,
              meta: item.sku,
            }))}
            limit={20}
            emptyMessage="Everything is well stocked."
          />
        </PanelBody>
      </Panel>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-content-muted">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-content tabular">{value}</dd>
    </div>
  );
}
