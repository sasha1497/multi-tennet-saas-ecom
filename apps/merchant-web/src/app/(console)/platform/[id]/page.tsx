'use client';

import { useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Database, PlayCircle, RefreshCw, ShieldOff, ShieldCheck } from 'lucide-react';
import { formatDate, formatMoney } from '@retailos/config';
import type { TenantStatus } from '@retailos/types';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  ErrorState,
  Input,
  PageHeader,
  Skeleton,
  StatTile,
  Switch,
  useToast,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useErrorToast } from '@/lib/hooks';

export default function TenantDetailPage() {
  const params = useParams<{ id: string }>();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [suspending, setSuspending] = useState(false);
  const [suspendReason, setSuspendReason] = useState('');

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['platform-tenant', params.id],
    queryFn: () => api().platform.tenant(params.id),
    enabled: Boolean(params.id),
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['platform-tenant', params.id] });
    void queryClient.invalidateQueries({ queryKey: ['platform-tenants'] });
  };

  const setStatus = useMutation({
    mutationFn: ({ status, reason }: { status: TenantStatus; reason?: string }) =>
      api().platform.updateTenantStatus(params.id, status, reason),
    onSuccess: (_, vars) => {
      toast.success(`Store ${vars.status.toLowerCase()}`);
      setSuspending(false);
      setSuspendReason('');
      invalidate();
    },
    onError: (err) => showError(err, 'Could not change the store status'),
  });

  const provision = useMutation({
    mutationFn: () => api().platform.provisionTenant(params.id),
    onSuccess: (job) => {
      toast.success('Provisioning run', `Status: ${job.status.toLowerCase()}`);
      invalidate();
    },
    onError: (err) => showError(err, 'Provisioning failed'),
  });

  const migrate = useMutation({
    mutationFn: () => api().platform.migrateTenant(params.id),
    onSuccess: (result) => {
      toast.success(
        result.applied.length ? `Applied ${result.applied.length} migration(s)` : 'Already up to date',
        `Schema version ${result.schemaVersion}`,
      );
      invalidate();
    },
    onError: (err) => showError(err, 'Migration failed'),
  });

  const setEntitlement = useMutation({
    mutationFn: ({ featureKey, enabled }: { featureKey: string; enabled: boolean }) =>
      api().platform.setEntitlement(params.id, { featureKey, enabled }),
    onSuccess: () => {
      toast.success('Feature updated');
      invalidate();
    },
    onError: (err) => showError(err, 'Could not update this feature'),
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl space-y-4">
        <Skeleton className="h-9 w-72" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <ErrorState
        title="Could not load this store"
        message={(error as Error)?.message}
        onRetry={() => void refetch()}
      />
    );
  }

  const active = data.tenant.status === 'ACTIVE';

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={data.tenant.name}
        description={data.tenant.storefrontUrl.replace(/^https?:\/\//, '')}
        breadcrumbs={[{ label: 'Tenants', href: '/platform' }, { label: data.tenant.name }]}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={active ? 'success' : 'warning'} dot size="md">
              {data.tenant.status.toLowerCase()}
            </Badge>
            {active ? (
              <Button
                size="sm"
                variant="outline"
                leftIcon={<ShieldOff className="h-3.5 w-3.5" />}
                onClick={() => setSuspending(true)}
              >
                Suspend
              </Button>
            ) : (
              <Button
                size="sm"
                leftIcon={<ShieldCheck className="h-3.5 w-3.5" />}
                onClick={() => setStatus.mutate({ status: 'ACTIVE' })}
                loading={setStatus.isPending}
              >
                Activate
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Products" value={String(data.stats.products)} comparisonLabel="in catalog" />
        <StatTile label="Orders" value={String(data.stats.orders)} comparisonLabel="all time" />
        <StatTile label="Customers" value={String(data.stats.customers)} comparisonLabel="registered" />
        <StatTile
          label="Revenue"
          value={formatMoney(data.stats.revenue, 'INR', { compact: true })}
          comparisonLabel="all time"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Database"
            description="This tenant's isolated PostgreSQL database."
            action={
              <div className="flex gap-1.5">
                <Button
                  size="xs"
                  variant="outline"
                  leftIcon={<RefreshCw className="h-3 w-3" />}
                  onClick={() => migrate.mutate()}
                  loading={migrate.isPending}
                >
                  Migrate
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  leftIcon={<PlayCircle className="h-3 w-3" />}
                  onClick={() => provision.mutate()}
                  loading={provision.isPending}
                >
                  Re-provision
                </Button>
              </div>
            }
          />
          <CardBody className="space-y-2.5 text-sm">
            <Row label="Database" value={<code className="font-mono text-xs">{data.database.databaseName}</code>} />
            <Row label="Role" value={<code className="font-mono text-xs">{data.database.username}</code>} />
            <Row label="Cluster" value={data.database.clusterId} />
            <Row label="Host" value={`${data.database.host}:${data.database.port}`} />
            <Row
              label="Schema version"
              value={<code className="font-mono text-xs">{data.database.schemaVersion ?? '—'}</code>}
            />
            <Row
              label="Status"
              value={
                <Badge tone={data.database.status === 'READY' ? 'success' : 'warning'} dot>
                  {data.database.status.toLowerCase()}
                </Badge>
              }
            />
            <Row
              label="Last migrated"
              value={data.database.lastMigratedAt ? formatDate(data.database.lastMigratedAt, true) : 'Never'}
            />
            <p className="flex items-start gap-2 pt-1 text-xs text-content-subtle">
              <Database className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              Credentials are stored encrypted and are never returned by the API.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Owner & team" />
          <CardBody className="space-y-3 text-sm">
            <Row label="Owner" value={data.owner.fullName} />
            <Row label="Email" value={data.owner.email} />
            {data.owner.phone && <Row label="Phone" value={data.owner.phone} />}
            <div className="pt-1">
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-subtle">
                Members ({data.members.length})
              </p>
              <ul className="space-y-1.5">
                {data.members.map((m) => (
                  <li key={m.userId} className="flex items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-content">{m.fullName || m.email}</span>
                    <Badge tone={m.role === 'OWNER' ? 'primary' : 'neutral'}>{m.role.toLowerCase()}</Badge>
                  </li>
                ))}
              </ul>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Plan & entitlements"
            description={`${data.entitlements.planName} · ${data.entitlements.subscriptionStatus.toLowerCase()}`}
          />
          <CardBody className="space-y-3">
            {Object.entries(data.entitlements.features).map(([key, enabled]) => (
              <Switch
                key={key}
                checked={enabled}
                onChange={(next) => setEntitlement.mutate({ featureKey: key, enabled: next })}
                label={key.replace(/_/g, ' ')}
              />
            ))}
            <p className="pt-1 text-xs text-content-subtle">
              Overriding a feature here wins over the plan default and survives a plan change.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Provisioning history" />
          <CardBody>
            {data.provisioningJobs.length === 0 ? (
              <p className="text-sm text-content-muted">No provisioning jobs recorded.</p>
            ) : (
              <ul className="space-y-3">
                {data.provisioningJobs.map((job) => (
                  <li key={job.id} className="border-b border-line pb-3 last:border-0 last:pb-0">
                    <div className="flex items-center justify-between gap-2">
                      <Badge
                        tone={
                          job.status === 'COMPLETED'
                            ? 'success'
                            : job.status === 'FAILED'
                              ? 'danger'
                              : 'warning'
                        }
                        dot
                      >
                        {job.status.toLowerCase()}
                      </Badge>
                      <span className="text-xs text-content-subtle">
                        {formatDate(job.createdAt, true)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-content-muted">
                      {job.completedSteps.length}/5 steps · attempt {job.attempts}
                    </p>
                    {job.lastError && (
                      <p className="mt-1 rounded bg-danger-50 px-2 py-1 text-xs text-danger-700 dark:bg-danger-700/15 dark:text-danger-100">
                        {job.lastError}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <ConfirmDialog
        open={suspending}
        onClose={() => setSuspending(false)}
        onConfirm={() => setStatus.mutate({ status: 'SUSPENDED', reason: suspendReason })}
        title="Suspend this store?"
        destructive
        confirmLabel="Suspend"
        loading={setStatus.isPending}
        message={
          <div className="space-y-3">
            <p>
              The storefront stops serving immediately and the merchant loses console access. Their
              data is untouched and the store can be reactivated at any time.
            </p>
            <Input
              label="Reason"
              required
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Non-payment / policy violation"
            />
          </div>
        }
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-content-muted">{label}</span>
      <span className="text-content">{value}</span>
    </div>
  );
}
