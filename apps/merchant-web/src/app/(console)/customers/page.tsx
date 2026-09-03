'use client';

import { Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Users } from 'lucide-react';
import { formatDate, formatMoney } from '@retailos/config';
import type { Customer } from '@retailos/types';
import {
  Avatar,
  Card,
  DataTable,
  Drawer,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  type Column,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useDebounced, useQueryParams } from '@/lib/hooks';

function CustomersView() {
  const [params, setParams] = useQueryParams({ search: '', page: '1', sortBy: 'createdAt' });
  const [searchInput, setSearchInput] = useState(params.search);
  const debouncedSearch = useDebounced(searchInput);
  const [selected, setSelected] = useState<Customer | null>(null);

  const page = Number(params.page) || 1;

  const { data, isLoading } = useQuery({
    queryKey: ['customers', debouncedSearch, page, params.sortBy],
    queryFn: () =>
      api().merchant.customers({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        sortBy: params.sortBy,
        sortOrder: 'desc',
      }),
  });

  const columns: Column<Customer>[] = [
    {
      key: 'name',
      header: 'Customer',
      cell: (row) => (
        <div className="flex items-center gap-3">
          <Avatar name={row.fullName} size="sm" />
          <div className="min-w-0">
            <p className="truncate font-medium text-content">{row.fullName}</p>
            <p className="truncate text-xs text-content-subtle">{row.email ?? row.phone}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'orderCount',
      header: 'Orders',
      align: 'right',
      sortable: true,
      cell: (row) => <span className="tabular">{row.orderCount}</span>,
    },
    {
      key: 'totalSpent',
      header: 'Lifetime value',
      align: 'right',
      sortable: true,
      cell: (row) => <span className="tabular font-medium">{formatMoney(row.totalSpent)}</span>,
    },
    {
      key: 'lastOrderAt',
      header: 'Last order',
      hideBelowMd: true,
      cell: (row) => (
        <span className="text-content-muted">
          {row.lastOrderAt ? formatDate(row.lastOrderAt) : 'Never'}
        </span>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Customers"
        description="Everyone who has an account with your store."
      />

      <Card>
        <div className="border-b border-line px-4 py-3">
          <Input
            placeholder="Search by name, email or phone…"
            leftIcon={<Search className="h-4 w-4" />}
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setParams({ search: e.target.value });
            }}
          />
        </div>

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          onRowClick={setSelected}
          sortBy={params.sortBy}
          sortOrder="desc"
          onSort={(key) => setParams({ sortBy: key })}
          empty={
            <EmptyState
              icon={<Users className="h-5 w-5" />}
              title="No customers yet"
              description="Customer accounts appear here after their first sign-up."
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

      <CustomerDrawer customer={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function CustomerDrawer({ customer, onClose }: { customer: Customer | null; onClose: () => void }) {
  const { data } = useQuery({
    queryKey: ['customer', customer?.id],
    queryFn: () => api().merchant.customer(customer!.id),
    enabled: Boolean(customer),
  });

  return (
    <Drawer open={customer !== null} onClose={onClose} title="Customer" width="max-w-lg">
      {customer && (
        <div className="space-y-5">
          <div className="flex items-center gap-3">
            <Avatar name={customer.fullName} size="lg" />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold text-content">{customer.fullName}</p>
              <p className="truncate text-sm text-content-muted">{customer.email}</p>
              {customer.phone && (
                <p className="text-sm text-content-muted tabular">{customer.phone}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface-muted p-3 text-center">
            <div>
              <p className="text-lg font-semibold text-content tabular">{customer.orderCount}</p>
              <p className="text-xs text-content-muted">Orders</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-content tabular">
                {formatMoney(customer.totalSpent, 'INR', { compact: true, hideDecimals: true })}
              </p>
              <p className="text-xs text-content-muted">Spent</p>
            </div>
            <div>
              <p className="text-lg font-semibold text-content">
                {customer.lastOrderAt ? formatDate(customer.lastOrderAt) : '—'}
              </p>
              <p className="text-xs text-content-muted">Last order</p>
            </div>
          </div>

          <div>
            <h3 className="mb-2 text-sm font-semibold text-content">Recent orders</h3>
            {!data ? (
              <p className="text-sm text-content-muted">Loading…</p>
            ) : data.recentOrders.length === 0 ? (
              <p className="text-sm text-content-muted">No orders yet.</p>
            ) : (
              <ul className="space-y-2">
                {data.recentOrders.map((order) => (
                  <li key={order.id}>
                    <a
                      href={`/orders/${order.id}`}
                      className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2 hover:bg-surface-muted"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-primary">
                          {order.orderNumber}
                        </p>
                        <p className="text-xs text-content-subtle">{formatDate(order.placedAt)}</p>
                      </div>
                      <span className="tabular shrink-0 text-sm font-medium text-content">
                        {formatMoney(order.totalAmount, order.currency)}
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {customer.notes && (
            <div>
              <h3 className="mb-1 text-sm font-semibold text-content">Internal note</h3>
              <p className="text-sm text-content-muted">{customer.notes}</p>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}

export default function CustomersPage() {
  return (
    <Suspense fallback={null}>
      <CustomersView />
    </Suspense>
  );
}
