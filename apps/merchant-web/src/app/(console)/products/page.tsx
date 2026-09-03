'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Package, Plus, Search } from 'lucide-react';
import { formatMoney } from '@retailos/config';
import { Permission, type ProductStatus } from '@retailos/types';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  Tabs,
  useToast,
  type Column,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDebounced, useErrorToast, useQueryParams } from '@/lib/hooks';

const STATUS_TABS = [
  { id: 'all', label: 'All' },
  { id: 'PUBLISHED', label: 'Published' },
  { id: 'DRAFT', label: 'Drafts' },
  { id: 'ARCHIVED', label: 'Archived' },
];

function ProductsView() {
  const { can } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [params, setParams] = useQueryParams({
    status: 'all',
    search: '',
    page: '1',
    sortBy: 'createdAt',
    sortOrder: 'desc',
  });

  const [searchInput, setSearchInput] = useState(params.search);
  const debouncedSearch = useDebounced(searchInput);
  const [archiveTarget, setArchiveTarget] = useState<{ id: string; name: string } | null>(null);

  const page = Number(params.page) || 1;

  const { data, isLoading } = useQuery({
    queryKey: ['products', params.status, debouncedSearch, page, params.sortBy, params.sortOrder],
    queryFn: () =>
      api().merchant.products({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        status: params.status === 'all' ? undefined : (params.status as ProductStatus),
        sortBy: params.sortBy,
        sortOrder: params.sortOrder as 'asc' | 'desc',
      }),
  });

  const archive = useMutation({
    mutationFn: (id: string) => api().merchant.deleteProduct(id),
    onSuccess: () => {
      toast.success('Product archived', 'It is hidden from your storefront. Past orders are unchanged.');
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      setArchiveTarget(null);
    },
    onError: (err) => showError(err, 'Could not archive this product'),
  });

  const publish = useMutation({
    mutationFn: ({ id, next }: { id: string; next: boolean }) =>
      api().merchant.publishProduct(id, next),
    onSuccess: (_, vars) => {
      toast.success(vars.next ? 'Product published' : 'Product unpublished');
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
    onError: (err) => showError(err, 'Could not change the product status'),
  });

  const columns: Column<NonNullable<typeof data>['items'][number]>[] = [
    {
      key: 'name',
      header: 'Product',
      sortable: true,
      cell: (row) => (
        <div className="flex items-center gap-3">
          {row.primaryImageUrl ? (
            <img
              src={row.primaryImageUrl}
              alt=""
              className="h-10 w-10 shrink-0 rounded-lg border border-line object-cover"
              loading="lazy"
            />
          ) : (
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-content-subtle">
              <Package className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <Link
              href={`/products/${row.id}`}
              className="block truncate font-medium text-content hover:text-primary"
            >
              {row.name}
            </Link>
            <p className="truncate text-xs text-content-subtle">
              {row.brandName ?? 'No brand'} · {row.categoryName ?? 'Uncategorised'}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge
          tone={row.status === 'PUBLISHED' ? 'success' : row.status === 'DRAFT' ? 'neutral' : 'warning'}
          dot
        >
          {row.status === 'PUBLISHED' ? 'Published' : row.status === 'DRAFT' ? 'Draft' : 'Archived'}
        </Badge>
      ),
    },
    {
      key: 'stock',
      header: 'Stock',
      align: 'right',
      hideBelowMd: true,
      cell: (row) => (
        <span
          className={
            (row.totalStock ?? 0) === 0
              ? 'tabular font-medium text-danger-600'
              : (row.totalStock ?? 0) <= 5
                ? 'tabular font-medium text-warning-600'
                : 'tabular'
          }
        >
          {row.totalStock ?? 0}
        </span>
      ),
    },
    {
      key: 'priceFrom',
      header: 'Price',
      align: 'right',
      sortable: true,
      cell: (row) => (
        <div className="tabular">
          <span className="font-medium">{formatMoney(row.priceFrom)}</span>
          {row.discountPercent > 0 && (
            <span className="ml-1.5 text-xs text-content-subtle line-through">
              {formatMoney(row.mrpFrom)}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) =>
        can(Permission.PRODUCTS_UPDATE) ? (
          <div className="flex justify-end gap-1.5">
            <Button
              size="xs"
              variant="outline"
              onClick={() => publish.mutate({ id: row.id, next: row.status !== 'PUBLISHED' })}
              disabled={row.status === 'ARCHIVED' || publish.isPending}
            >
              {row.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
            </Button>
            {can(Permission.PRODUCTS_DELETE) && row.status !== 'ARCHIVED' && (
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Archive ${row.name}`}
                onClick={() => setArchiveTarget({ id: row.id, name: row.name })}
              >
                <Archive className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Products"
        description="Everything you sell, with variants, pricing and stock."
        actions={
          can(Permission.PRODUCTS_CREATE) && (
            <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => (window.location.href = '/products/new')}>
              Add product
            </Button>
          )
        }
      />

      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <Input
            containerClassName="min-w-[220px] flex-1"
            placeholder="Search by name or SKU…"
            leftIcon={<Search className="h-4 w-4" />}
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setParams({ search: e.target.value });
            }}
          />
          <Select
            className="w-auto min-w-[150px]"
            value={params.sortBy}
            onChange={(e) => setParams({ sortBy: e.target.value })}
            options={[
              { value: 'createdAt', label: 'Newest first' },
              { value: 'name', label: 'Name A–Z' },
              { value: 'priceFrom', label: 'Price' },
              { value: 'soldCount', label: 'Best selling' },
            ]}
          />
        </div>

        <Tabs
          tabs={STATUS_TABS}
          active={params.status}
          onChange={(id) => setParams({ status: id === 'all' ? undefined : id, page: '1' })}
          className="px-2"
        />

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.id}
          loading={isLoading}
          sortBy={params.sortBy}
          sortOrder={params.sortOrder as 'asc' | 'desc'}
          onSort={(key) =>
            setParams({
              sortBy: key,
              sortOrder: params.sortBy === key && params.sortOrder === 'desc' ? 'asc' : 'desc',
            })
          }
          empty={
            <EmptyState
              icon={<Package className="h-5 w-5" />}
              title={debouncedSearch ? 'No products match your search' : 'No products yet'}
              description={
                debouncedSearch
                  ? 'Try a different name or SKU.'
                  : 'Add your first product to start selling.'
              }
              action={
                !debouncedSearch &&
                can(Permission.PRODUCTS_CREATE) && (
                  <Link href="/products/new">
                    <Button leftIcon={<Plus className="h-4 w-4" />}>Add product</Button>
                  </Link>
                )
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

      <ConfirmDialog
        open={archiveTarget !== null}
        onClose={() => setArchiveTarget(null)}
        onConfirm={() => {
          if (archiveTarget) archive.mutate(archiveTarget.id);
        }}
        title="Archive this product?"
        message={
          <>
            <strong>{archiveTarget?.name}</strong> will be removed from your storefront and from any
            open carts. Past orders keep their record of it, and you can still see it under the
            Archived tab.
          </>
        }
        confirmLabel="Archive"
        destructive
        loading={archive.isPending}
      />
    </div>
  );
}

export default function ProductsPage() {
  return (
    <Suspense fallback={null}>
      <ProductsView />
    </Suspense>
  );
}
