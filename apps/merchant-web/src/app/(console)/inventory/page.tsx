'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, History, Search } from 'lucide-react';
import type { InventoryRecord } from '@retailos/types';
import { Permission } from '@retailos/types';
import {
  Badge,
  Button,
  Card,
  DataTable,
  Drawer,
  EmptyState,
  Input,
  PageHeader,
  Pagination,
  Select,
  Tabs,
  Textarea,
  useToast,
  type Column,
} from '@retailos/ui';
import { formatDate } from '@retailos/config';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDebounced, useErrorToast, useQueryParams } from '@/lib/hooks';

const TABS = [
  { id: 'all', label: 'All' },
  { id: 'low', label: 'Low stock' },
  { id: 'out', label: 'Out of stock' },
];

function InventoryView() {
  const { can } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [params, setParams] = useQueryParams({ view: 'all', search: '', page: '1' });
  const [searchInput, setSearchInput] = useState(params.search);
  const debouncedSearch = useDebounced(searchInput);
  const [adjusting, setAdjusting] = useState<InventoryRecord | null>(null);
  const [history, setHistory] = useState<InventoryRecord | null>(null);

  const page = Number(params.page) || 1;

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', params.view, debouncedSearch, page],
    queryFn: () =>
      api().merchant.inventory({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        lowStockOnly: params.view === 'low' || undefined,
        outOfStockOnly: params.view === 'out' || undefined,
      }),
  });

  const columns: Column<InventoryRecord>[] = [
    {
      key: 'product',
      header: 'Item',
      cell: (row) => (
        <div className="flex items-center gap-3">
          {row.imageUrl ? (
            <img
              src={row.imageUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-lg border border-line object-cover"
              loading="lazy"
            />
          ) : (
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-content-subtle">
              <Boxes className="h-4 w-4" />
            </span>
          )}
          <div className="min-w-0">
            <Link
              href={`/products/${row.productId}`}
              className="block truncate font-medium text-content hover:text-primary"
            >
              {row.productName}
            </Link>
            <p className="truncate text-xs text-content-subtle">
              {row.variantLabel} · {row.sku}
            </p>
          </div>
        </div>
      ),
    },
    {
      key: 'quantity',
      header: 'On hand',
      align: 'right',
      cell: (row) => <span className="tabular">{row.quantity}</span>,
    },
    {
      key: 'reserved',
      header: 'Reserved',
      align: 'right',
      hideBelowMd: true,
      cell: (row) => (
        <span className="tabular text-content-muted" title="Held for orders awaiting payment">
          {row.reserved}
        </span>
      ),
    },
    {
      key: 'available',
      header: 'Available',
      align: 'right',
      cell: (row) => (
        <Badge tone={row.available === 0 ? 'danger' : row.isLowStock ? 'warning' : 'success'} dot>
          {row.available}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (row) => (
        <div className="flex justify-end gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            aria-label={`Stock history for ${row.sku}`}
            onClick={() => setHistory(row)}
          >
            <History className="h-4 w-4" />
          </Button>
          {can(Permission.INVENTORY_UPDATE) && (
            <Button size="xs" variant="outline" onClick={() => setAdjusting(row)}>
              Adjust
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Inventory"
        description="Stock on hand, what is held for open orders, and what is actually sellable."
      />

      <Card>
        <div className="border-b border-line px-4 py-3">
          <Input
            placeholder="Search by product or SKU…"
            leftIcon={<Search className="h-4 w-4" />}
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setParams({ search: e.target.value });
            }}
          />
        </div>

        <Tabs
          tabs={TABS}
          active={params.view}
          onChange={(id) => setParams({ view: id === 'all' ? undefined : id, page: '1' })}
          className="px-2"
        />

        <DataTable
          columns={columns}
          rows={data?.items ?? []}
          rowKey={(r) => r.variantId}
          loading={isLoading}
          empty={
            <EmptyState
              icon={<Boxes className="h-5 w-5" />}
              title={params.view === 'all' ? 'No stock records yet' : 'Nothing to worry about'}
              description={
                params.view === 'all'
                  ? 'Stock rows appear automatically when you add products.'
                  : 'No items match this filter — your stock levels look healthy.'
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

      <AdjustDrawer
        record={adjusting}
        onClose={() => setAdjusting(null)}
        onDone={() => {
          void queryClient.invalidateQueries({ queryKey: ['inventory'] });
          setAdjusting(null);
        }}
        toast={toast}
        showError={showError}
      />

      <HistoryDrawer record={history} onClose={() => setHistory(null)} />
    </div>
  );
}

function AdjustDrawer({
  record,
  onClose,
  onDone,
  toast,
  showError,
}: {
  record: InventoryRecord | null;
  onClose: () => void;
  onDone: () => void;
  toast: ReturnType<typeof useToast>;
  showError: ReturnType<typeof useErrorToast>;
}) {
  const [mode, setMode] = useState<'delta' | 'absolute'>('delta');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState('PURCHASE');
  const [reason, setReason] = useState('');

  const adjust = useMutation({
    mutationFn: () => {
      if (!record) throw new Error('No record');
      return api().merchant.adjustInventory({
        variantId: record.variantId,
        ...(mode === 'delta'
          ? { quantityChange: Number(amount) }
          : { setQuantity: Number(amount) }),
        type: type as never,
        reason: reason || undefined,
        // Optimistic lock: if someone else adjusted this SKU first, the API
        // returns 409 rather than silently overwriting their count.
        expectedVersion: record.version,
      });
    },
    onSuccess: () => {
      toast.success('Stock updated');
      setAmount('');
      setReason('');
      onDone();
    },
    onError: (err) => showError(err, 'Could not adjust stock'),
  });

  return (
    <Drawer
      open={record !== null}
      onClose={onClose}
      title="Adjust stock"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => adjust.mutate()}
            loading={adjust.isPending}
            disabled={!amount}
          >
            Apply
          </Button>
        </>
      }
    >
      {record && (
        <div className="space-y-4">
          <div className="rounded-lg bg-surface-muted p-3">
            <p className="text-sm font-medium text-content">{record.productName}</p>
            <p className="text-xs text-content-subtle">
              {record.variantLabel} · {record.sku}
            </p>
            <div className="mt-2 flex gap-4 text-xs text-content-muted tabular">
              <span>On hand: <strong className="text-content">{record.quantity}</strong></span>
              <span>Reserved: <strong className="text-content">{record.reserved}</strong></span>
              <span>Available: <strong className="text-content">{record.available}</strong></span>
            </div>
          </div>

          <Select
            label="How would you like to adjust it?"
            value={mode}
            onChange={(e) => setMode(e.target.value as 'delta' | 'absolute')}
            options={[
              { value: 'delta', label: 'Add or remove a quantity' },
              { value: 'absolute', label: 'Set the counted quantity (stock take)' },
            ]}
          />

          <Input
            label={mode === 'delta' ? 'Change (use a negative number to remove)' : 'Counted quantity'}
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={mode === 'delta' ? '+10' : String(record.quantity)}
          />

          <Select
            label="Reason type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            options={[
              { value: 'PURCHASE', label: 'New stock received' },
              { value: 'ADJUSTMENT', label: 'Correction / stock take' },
              { value: 'DAMAGE', label: 'Damaged or lost' },
              { value: 'RETURN', label: 'Customer return' },
            ]}
          />

          <Textarea
            label="Note"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Received from supplier, invoice #4821"
          />

          <p className="text-xs text-content-subtle">
            Every adjustment is recorded in the stock ledger with who made it and when.
          </p>
        </div>
      )}
    </Drawer>
  );
}

function HistoryDrawer({
  record,
  onClose,
}: {
  record: InventoryRecord | null;
  onClose: () => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['inventory-transactions', record?.variantId],
    queryFn: () => api().merchant.inventoryTransactions({ variantId: record!.variantId, limit: 50 }),
    enabled: Boolean(record),
  });

  return (
    <Drawer open={record !== null} onClose={onClose} title="Stock history" width="max-w-lg">
      {record && (
        <>
          <p className="mb-4 text-sm text-content-muted">
            {record.productName} · {record.sku}
          </p>
          {isLoading ? (
            <p className="text-sm text-content-muted">Loading…</p>
          ) : (data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-content-muted">No movements recorded yet.</p>
          ) : (
            <ul className="space-y-3">
              {data!.items.map((tx) => (
                <li key={tx.id} className="flex items-start justify-between gap-3 border-b border-line pb-3 last:border-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-content">
                      {tx.type.charAt(0) + tx.type.slice(1).toLowerCase().replace('_', ' ')}
                    </p>
                    {tx.reason && <p className="text-xs text-content-muted">{tx.reason}</p>}
                    <p className="text-xs text-content-subtle">{formatDate(tx.createdAt, true)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p
                      className={
                        tx.quantityChange > 0
                          ? 'tabular text-sm font-semibold text-success-600'
                          : tx.quantityChange < 0
                            ? 'tabular text-sm font-semibold text-danger-600'
                            : 'tabular text-sm text-content-muted'
                      }
                    >
                      {tx.quantityChange > 0 ? '+' : ''}
                      {tx.quantityChange || '—'}
                    </p>
                    <p className="text-xs text-content-subtle tabular">→ {tx.quantityAfter}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Drawer>
  );
}

export default function InventoryPage() {
  return (
    <Suspense fallback={null}>
      <InventoryView />
    </Suspense>
  );
}
