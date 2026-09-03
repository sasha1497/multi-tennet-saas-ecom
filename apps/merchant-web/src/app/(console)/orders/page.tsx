'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Search, ShoppingCart } from 'lucide-react';
import { formatDate, formatMoney, ORDER_STATUS_LABELS, ORDER_STATUS_TONES } from '@retailos/config';
import type { OrderStatus } from '@retailos/types';
import {
  Badge,
  Card,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  Tabs,
  type Column,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useDebounced, useQueryParams } from '@/lib/hooks';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'PENDING', label: 'Pending' },
  { id: 'CONFIRMED', label: 'Confirmed' },
  { id: 'PROCESSING', label: 'Packing' },
  { id: 'SHIPPED', label: 'Shipped' },
  { id: 'DELIVERED', label: 'Delivered' },
  { id: 'CANCELLED', label: 'Cancelled' },
];

function OrdersView() {
  const [params, setParams] = useQueryParams({
    status: 'all',
    search: '',
    paymentMethod: '',
    page: '1',
  });
  const [searchInput, setSearchInput] = useState(params.search);
  const debouncedSearch = useDebounced(searchInput);
  const page = Number(params.page) || 1;

  const { data, isLoading } = useQuery({
    queryKey: ['orders', params.status, params.paymentMethod, debouncedSearch, page],
    queryFn: () =>
      api().merchant.orders({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        status: params.status === 'all' ? undefined : (params.status as OrderStatus),
        paymentMethod: (params.paymentMethod || undefined) as never,
      }),
  });

  const columns: Column<NonNullable<typeof data>['items'][number]>[] = [
    {
      key: 'orderNumber',
      header: 'Order',
      cell: (row) => (
        <div className="flex items-center gap-3">
          {row.thumbnailUrl ? (
            <img
              src={row.thumbnailUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-lg border border-line object-cover"
              loading="lazy"
            />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-content-subtle">
              <ShoppingCart className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <Link
              href={`/orders/${row.id}`}
              className="block font-medium text-primary hover:underline"
            >
              {row.orderNumber}
            </Link>
            <p className="truncate text-xs text-content-subtle">
              {row.itemCount} item{row.itemCount === 1 ? '' : 's'}
            </p>
          </div>
        </div>
      ),
    },
    { key: 'customer', header: 'Customer', cell: (row) => row.customerName, hideBelowMd: true },
    {
      key: 'placedAt',
      header: 'Placed',
      hideBelowMd: true,
      cell: (row) => (
        <span className="text-content-muted">{formatDate(row.placedAt, true)}</span>
      ),
    },
    {
      key: 'payment',
      header: 'Payment',
      cell: (row) => (
        <div className="flex flex-col gap-1">
          <span className="text-xs text-content-muted">{row.paymentMethod}</span>
          <Badge tone={row.paymentStatus === 'PAID' ? 'success' : row.paymentStatus === 'FAILED' ? 'danger' : 'warning'} dot>
            {row.paymentStatus.toLowerCase()}
          </Badge>
        </div>
      ),
    },
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
      cell: (row) => (
        <span className="tabular font-semibold">{formatMoney(row.totalAmount, row.currency)}</span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Orders" description="Every order placed in your store." />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Input
            containerClassName="min-w-[220px] flex-1"
            placeholder="Search order number, name or phone…"
            leftIcon={<Search className="h-4 w-4" />}
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setParams({ search: e.target.value });
            }}
          />
          <Select
            className="w-auto min-w-[150px]"
            value={params.paymentMethod}
            onChange={(e) => setParams({ paymentMethod: e.target.value })}
            placeholder="All payment methods"
            options={[
              { value: 'COD', label: 'Cash on delivery' },
              { value: 'UPI', label: 'UPI' },
              { value: 'CARD', label: 'Card' },
              { value: 'NETBANKING', label: 'Net banking' },
            ]}
          />
        </div>

        <Tabs
          tabs={TABS}
          active={params.status}
          onChange={(id) => setParams({ status: id === 'all' ? undefined : id, page: '1' })}
          className="px-2"
        />

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<ShoppingCart className="h-5 w-5" />}
              title="No orders here"
              description={
                params.status === 'all'
                  ? 'Orders will appear as soon as customers start buying.'
                  : 'No orders in this status right now.'
              }
            />
          }
        />

        {data && (
          <Pagination
            page={data.pagination.page}
            totalPages={data.pagination.totalPages}
            total={data.pagination.total}
            limit={data.pagination.limit}
            onPageChange={(p) => setParams({ page: String(p) })}
          />
        )}
      </Card>
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={null}>
      <OrdersView />
    </Suspense>
  );
}
