'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ExternalLink } from 'lucide-react';
import { formatDate, formatMoney } from '@retailos/config';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  PageHeader,
  Skeleton,
  useToast,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useErrorToast } from '@/lib/hooks';

export default function SettingsPage() {
  const { session, activeTenant } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();

  const [passwords, setPasswords] = useState({ current: '', next: '', confirm: '' });

  const { data: tenant, isLoading } = useQuery({
    queryKey: ['current-tenant'],
    queryFn: () => api().merchant.currentTenant(),
  });

  const changePassword = useMutation({
    mutationFn: () =>
      api().auth.changePassword({
        currentPassword: passwords.current,
        newPassword: passwords.next,
      }),
    onSuccess: () => {
      toast.success('Password changed', 'You have been signed out of your other devices.');
      setPasswords({ current: '', next: '', confirm: '' });
    },
    onError: (err) => showError(err, 'Could not change your password'),
  });

  const mismatch = passwords.next !== '' && passwords.next !== passwords.confirm;

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <PageHeader title="Settings" description="Your account and this store's subscription." />

      <Card>
        <CardHeader title="Your account" />
        <CardBody className="space-y-3 text-sm">
          <Row label="Name" value={session?.user.fullName ?? '—'} />
          <Row label="Email" value={session?.user.email ?? '—'} />
          <Row label="Phone" value={session?.user.phone ?? 'Not set'} />
          <Row
            label="Role in this store"
            value={
              <Badge tone="primary">
                {(session?.role ?? '').charAt(0) + (session?.role ?? '').slice(1).toLowerCase()}
              </Badge>
            }
          />
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Change password"
          description="Changing it signs you out everywhere else."
        />
        <CardBody className="space-y-4">
          <Input
            label="Current password"
            type="password"
            autoComplete="current-password"
            value={passwords.current}
            onChange={(e) => setPasswords({ ...passwords, current: e.target.value })}
          />
          <Input
            label="New password"
            type="password"
            autoComplete="new-password"
            value={passwords.next}
            onChange={(e) => setPasswords({ ...passwords, next: e.target.value })}
            hint="At least 8 characters, with a letter and a number."
          />
          <Input
            label="Confirm new password"
            type="password"
            autoComplete="new-password"
            value={passwords.confirm}
            onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })}
            error={mismatch ? 'The two passwords do not match' : undefined}
          />
          <div className="flex justify-end">
            <Button
              onClick={() => changePassword.mutate()}
              loading={changePassword.isPending}
              disabled={!passwords.current || !passwords.next || mismatch}
            >
              Change password
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Store & plan" />
        <CardBody className="space-y-3 text-sm">
          {isLoading || !tenant ? (
            <Skeleton className="h-32" />
          ) : (
            <>
              <Row label="Store name" value={tenant.tenant.name} />
              <Row
                label="Storefront"
                value={
                  <a
                    href={tenant.tenant.storefrontUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {tenant.tenant.storefrontUrl.replace(/^https?:\/\//, '')}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                }
              />
              <Row
                label="Status"
                value={
                  <Badge tone={tenant.tenant.status === 'ACTIVE' ? 'success' : 'warning'} dot>
                    {tenant.tenant.status.toLowerCase()}
                  </Badge>
                }
              />
              <Row
                label="Plan"
                value={
                  <span className="flex items-center gap-2">
                    <Badge tone="primary">{tenant.entitlements.planName}</Badge>
                    {tenant.subscription && (
                      <span className="text-xs text-content-subtle">
                        renews {formatDate(tenant.subscription.currentPeriodEnd)}
                      </span>
                    )}
                  </span>
                }
              />
              {tenant.subscription?.plan && (
                <Row
                  label="Price"
                  value={
                    tenant.subscription.plan.priceMonthly === 0
                      ? 'Free'
                      : `${formatMoney(tenant.subscription.plan.priceMonthly)} / month`
                  }
                />
              )}

              <div className="pt-2">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-subtle">
                  Plan limits
                </p>
                <dl className="grid gap-2 sm:grid-cols-2">
                  {Object.entries(tenant.entitlements.limits).map(([key, value]) => (
                    <div key={key} className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2">
                      <dt className="text-xs text-content-muted">
                        {key.replace(/_/g, ' ').replace('max ', '')}
                      </dt>
                      <dd className="text-sm font-medium text-content tabular">
                        {value < 0 ? 'Unlimited' : value.toLocaleString()}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      {activeTenant && (
        <p className="pb-4 text-center text-xs text-content-subtle">
          Store id <code className="font-mono">{activeTenant.tenantId}</code>
        </p>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3 last:border-0 last:pb-0">
      <span className="text-content-muted">{label}</span>
      <span className="text-content">{value}</span>
    </div>
  );
}
