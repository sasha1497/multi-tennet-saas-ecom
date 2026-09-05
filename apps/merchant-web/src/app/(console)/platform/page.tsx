'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Database, Plus, Search } from 'lucide-react';
import { formatMoney } from '@retailos/config';
import type { PlatformTenantListItem, TenantStatus } from '@retailos/types';
import {
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Pagination,
  Select,
  StatTile,
  Tabs,
  useToast,
  type Column,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useDebounced, useErrorToast, useQueryParams } from '@/lib/hooks';

const STATUS_TONES: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'info'> = {
  ACTIVE: 'success',
  PROVISIONING: 'info',
  SUSPENDED: 'warning',
  DELETING: 'danger',
  DELETED: 'neutral',
};

function PlatformView() {
  const [params, setParams] = useQueryParams({ status: 'all', search: '', page: '1' });
  const [searchInput, setSearchInput] = useState(params.search);
  const debouncedSearch = useDebounced(searchInput);
  const [creating, setCreating] = useState(false);
  const page = Number(params.page) || 1;

  const { data: overview } = useQuery({
    queryKey: ['platform-overview'],
    queryFn: () => api().platform.overview(),
  });

  const { data, isLoading } = useQuery({
    queryKey: ['platform-tenants', params.status, debouncedSearch, page],
    queryFn: () =>
      api().platform.tenants({
        page,
        limit: 20,
        search: debouncedSearch || undefined,
        status: params.status === 'all' ? undefined : (params.status as TenantStatus),
      }),
  });

  const columns: Column<PlatformTenantListItem>[] = [
    {
      key: 'name',
      header: 'Store',
      cell: (row) => (
        <div className="min-w-0">
          <Link
            href={`/platform/${row.id}`}
            className="block truncate font-medium text-content hover:text-primary"
          >
            {row.name}
          </Link>
          <p className="truncate text-xs text-content-subtle">{row.primaryDomain ?? row.slug}</p>
        </div>
      ),
    },
    {
      key: 'owner',
      header: 'Owner',
      hideBelowMd: true,
      cell: (row) => (
        <div className="min-w-0">
          <p className="truncate text-sm text-content">{row.ownerName}</p>
          <p className="truncate text-xs text-content-subtle">{row.ownerEmail}</p>
        </div>
      ),
    },
    {
      key: 'plan',
      header: 'Plan',
      cell: (row) => <Badge tone="primary">{row.planCode}</Badge>,
    },
    {
      key: 'db',
      header: 'Database',
      hideBelowMd: true,
      cell: (row) => (
        <Badge tone={row.databaseStatus === 'READY' ? 'success' : 'warning'} dot>
          {row.databaseStatus.toLowerCase()}
        </Badge>
      ),
    },
    {
      key: 'usage',
      header: 'Usage',
      align: 'right',
      hideBelowMd: true,
      cell: (row) => (
        <span className="tabular text-xs text-content-muted">
          {row.productCount} products · {row.orderCount} orders
        </span>
      ),
    },
    {
      key: 'revenue',
      header: 'GMV (month)',
      align: 'right',
      cell: (row) => <span className="tabular font-medium">{formatMoney(row.monthlyRevenue)}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      cell: (row) => (
        <Badge tone={STATUS_TONES[row.status] ?? 'neutral'} dot>
          {row.status.toLowerCase()}
        </Badge>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Tenants"
        description="Every store on the platform, with its own isolated database."
        actions={
          <Button leftIcon={<Plus className="h-4 w-4" />} onClick={() => setCreating(true)}>
            Create store
          </Button>
        }
      />

      {overview && (
        <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatTile
            label="Active stores"
            value={String(overview.tenants.active)}
            comparisonLabel={`${overview.tenants.total} total`}
          />
          <StatTile
            label="New this month"
            value={String(overview.tenants.newThisMonth)}
            comparisonLabel="signups"
          />
          <StatTile
            label="Platform GMV"
            value={formatMoney(overview.revenue.gmvThisMonth, 'INR', { compact: true })}
            comparisonLabel="this month"
          />
          <StatTile
            label="Tenant databases"
            value={`${overview.system.tenantDbsHealthy}/${overview.system.tenantDbsTotal}`}
            comparisonLabel="healthy"
            icon={<Database className="h-4 w-4" />}
            trend={
              overview.system.tenantDbsHealthy === overview.system.tenantDbsTotal ? 'flat' : 'down'
            }
          />
        </div>
      )}

      <Card>
        <div className="border-b border-line px-4 py-3">
          <Input
            placeholder="Search by store name, slug or owner email…"
            leftIcon={<Search className="h-4 w-4" />}
            value={searchInput}
            onChange={(e) => {
              setSearchInput(e.target.value);
              setParams({ search: e.target.value });
            }}
          />
        </div>

        <Tabs
          tabs={[
            { id: 'all', label: 'All' },
            { id: 'ACTIVE', label: 'Active' },
            { id: 'PROVISIONING', label: 'Provisioning' },
            { id: 'SUSPENDED', label: 'Suspended' },
          ]}
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
              icon={<Building2 className="h-5 w-5" />}
              title="No stores yet"
              description="Create the first merchant to get started."
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

      <CreateTenantModal open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}

function CreateTenantModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    slug: '',
    ownerEmail: '',
    ownerFirstName: '',
    ownerLastName: '',
    planCode: 'FREE',
  });
  const [tempPassword, setTempPassword] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api().platform.createTenant({
        name: form.name.trim(),
        slug: form.slug.trim() || undefined,
        ownerEmail: form.ownerEmail.trim(),
        ownerFirstName: form.ownerFirstName.trim(),
        ownerLastName: form.ownerLastName.trim(),
        planCode: form.planCode,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
      void queryClient.invalidateQueries({ queryKey: ['platform-overview'] });
      if (result.temporaryPassword) setTempPassword(result.temporaryPassword);
      else {
        toast.success('Store created', 'Provisioning has been queued.');
        onClose();
      }
    },
    onError: (err) => showError(err, 'Could not create this store'),
  });

  const close = () => {
    setTempPassword(null);
    setForm({ name: '', slug: '', ownerEmail: '', ownerFirstName: '', ownerLastName: '', planCode: 'FREE' });
    onClose();
  };

  if (tempPassword) {
    return (
      <Modal open={open} onClose={close} title="Store created" footer={<Button onClick={close}>Done</Button>}>
        <div className="space-y-3">
          <p className="text-sm text-content-muted">
            Provisioning is running in the background. Share this one-time password with the owner —
            it is shown only now.
          </p>
          <div className="rounded-lg border border-line bg-surface-muted p-3 text-center">
            <code className="font-mono text-lg font-semibold tracking-wider text-content">
              {tempPassword}
            </code>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Create a store"
      footer={
        <>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            onClick={() => create.mutate()}
            loading={create.isPending}
            disabled={!form.name.trim() || !form.ownerEmail.trim() || !form.ownerFirstName.trim()}
          >
            Create & provision
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Input
          label="Store name"
          required
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
        <Input
          label="Subdomain"
          value={form.slug}
          onChange={(e) => setForm({ ...form, slug: e.target.value })}
          hint="Leave blank to derive it from the store name."
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            label="Owner first name"
            required
            value={form.ownerFirstName}
            onChange={(e) => setForm({ ...form, ownerFirstName: e.target.value })}
          />
          <Input
            label="Owner last name"
            value={form.ownerLastName}
            onChange={(e) => setForm({ ...form, ownerLastName: e.target.value })}
          />
        </div>
        <Input
          label="Owner email"
          type="email"
          required
          value={form.ownerEmail}
          onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })}
          hint="An existing RetailOS account with this email is reused."
        />
        <Select
          label="Plan"
          value={form.planCode}
          onChange={(e) => setForm({ ...form, planCode: e.target.value })}
          options={[
            { value: 'FREE', label: 'Free' },
            { value: 'STARTER', label: 'Starter' },
            { value: 'PRO', label: 'Pro' },
            { value: 'ENTERPRISE', label: 'Enterprise' },
          ]}
        />
        <p className="text-xs text-content-subtle">
          Creating a store provisions a dedicated PostgreSQL database, runs the tenant migrations and
          seeds default settings. It usually completes within a few seconds.
        </p>
      </div>
    </Modal>
  );
}

export default function PlatformPage() {
  return (
    <Suspense fallback={null}>
      <PlatformView />
    </Suspense>
  );
}
