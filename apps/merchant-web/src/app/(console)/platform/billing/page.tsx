'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { formatMoney } from '@retailos/config';
import { Badge, Card, CardBody, CardHeader, EmptyState, Skeleton } from '@retailos/ui';
import { Receipt } from 'lucide-react';
import { PageHead, StatCard } from '@/components/console/primitives';
import { api } from '@/lib/api';

/**
 * Platform billing.
 *
 * MRR here is a run-rate: stores currently earning their plan, at today's plan
 * prices. What was actually collected is the invoice list below it. The two
 * are shown apart on purpose — a repricing changes one and not the other.
 */
export default function PlatformBillingPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['platform-billing'],
    queryFn: () => api().platform.billingOverview(),
  });

  const money = (minor: number) =>
    formatMoney(minor, data?.currency ?? 'INR', { hideDecimals: true });

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHead
        title="Billing"
        description="What merchants pay RetailOS — subscriptions, revenue run-rate and charges."
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Monthly recurring revenue" value={data ? money(data.mrr) : '—'} loading={isLoading} />
        <StatCard label="Paying stores" value={String(data?.merchants.paying ?? '—')} loading={isLoading} />
        <StatCard label="On trial" value={String(data?.merchants.trialing ?? '—')} loading={isLoading} />
        <StatCard
          label="Payment due / lapsed"
          value={data ? `${data.merchants.pastDue} / ${data.merchants.lapsed}` : '—'}
          loading={isLoading}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="By plan" description="Stores on each plan and what they contribute to MRR." />
          {isLoading || !data ? (
            <CardBody>
              <Skeleton className="h-40" />
            </CardBody>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-content-subtle">
                    <th className="px-5 py-2.5 font-medium">Plan</th>
                    <th className="px-5 py-2.5 text-right font-medium">Stores</th>
                    <th className="px-5 py-2.5 text-right font-medium">Paying</th>
                    <th className="px-5 py-2.5 text-right font-medium">MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byPlan.map((plan) => (
                    <tr key={plan.code} className="border-b border-line last:border-0">
                      <td className="px-5 py-3 font-medium text-content">{plan.name}</td>
                      <td className="px-5 py-3 text-right tabular text-content-muted">{plan.stores}</td>
                      <td className="px-5 py-3 text-right tabular text-content-muted">{plan.paying}</td>
                      <td className="px-5 py-3 text-right tabular text-content">{money(plan.mrr)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Last 30 days" />
          <CardBody>
            {isLoading || !data ? (
              <Skeleton className="h-40" />
            ) : (
              <dl className="grid grid-cols-2 gap-4 text-sm">
                <Figure label="Collected" value={money(data.last30Days.paid.amount)} sub={`${data.last30Days.paid.count} payments`} />
                <Figure
                  label="Failed payments"
                  value={String(data.last30Days.failed.count)}
                  sub={money(data.last30Days.failed.amount)}
                  warn={data.last30Days.failed.count > 0}
                />
                <Figure label="Upgrades" value={String(data.last30Days.upgrades)} />
                <Figure label="Downgrades" value={String(data.last30Days.downgrades)} />
                <Figure label="Active stores" value={String(data.merchants.active)} sub={`${data.merchants.total} in total`} />
                <Figure label="Suspended" value={String(data.merchants.suspended)} warn={data.merchants.suspended > 0} />
              </dl>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Recent charges" />
        {data && data.recentInvoices.length === 0 ? (
          <CardBody>
            <EmptyState
              icon={<Receipt className="h-5 w-5" />}
              title="No charges yet"
              description="Subscription payments will appear here as stores pay."
            />
          </CardBody>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-content-subtle">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Store</th>
                  <th className="px-5 py-2.5 font-medium">Plan</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(data?.recentInvoices ?? []).map((invoice) => (
                  <tr key={invoice.id} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 tabular text-content-muted">
                      {new Date(invoice.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                    </td>
                    <td className="px-5 py-3">
                      <Link href={`/platform?search=${encodeURIComponent(invoice.tenantSlug)}`} className="font-medium text-content hover:text-primary">
                        {invoice.tenantName}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-content-muted">{invoice.planCode}</td>
                    <td className="px-5 py-3 text-right tabular text-content">{money(invoice.amount)}</td>
                    <td className="px-5 py-3">
                      <Badge tone={invoice.status === 'PAID' ? 'success' : invoice.status === 'FAILED' ? 'danger' : 'neutral'} dot>
                        {invoice.status.toLowerCase()}
                      </Badge>
                      {invoice.failureReason && (
                        <p className="mt-0.5 text-[11px] text-content-subtle">{invoice.failureReason}</p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Figure({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-content-subtle">{label}</dt>
      <dd className={warn ? 'nums mt-0.5 text-lg font-semibold text-danger-600' : 'nums mt-0.5 text-lg font-semibold text-content'}>
        {value}
      </dd>
      {sub && <dd className="text-[11px] text-content-subtle tabular">{sub}</dd>}
    </div>
  );
}
