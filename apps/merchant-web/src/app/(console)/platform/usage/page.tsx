'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Card, CardHeader, Skeleton, cn } from '@retailos/ui';
import { PageHead, StatCard } from '@/components/console/primitives';
import { api } from '@/lib/api';

/**
 * Resource use per store.
 *
 * AI generations are the one metered resource with a direct cost to the
 * platform, so the table leads with them. Product and order counts come from
 * the stats job's denormalised counters (refreshed periodically) rather than a
 * live fan-out across every tenant database. Storage and bandwidth are not yet
 * tracked per store and are left out rather than estimated.
 */
export default function PlatformUsagePage() {
  const { data, isLoading } = useQuery({
    queryKey: ['platform-usage'],
    queryFn: () => api().platform.usage(),
  });

  const month = data
    ? new Date(data.windowStart).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    : '';

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHead
        title="Usage"
        description={`Resource use across every store${month ? ` · AI figures for ${month}` : ''}.`}
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="AI generations" value={fmt(data?.totals.aiGenerations)} loading={isLoading} />
        <StatCard label="AI tokens" value={fmt(data?.totals.aiTokens)} loading={isLoading} />
        <StatCard label="Products" value={fmt(data?.totals.products)} loading={isLoading} />
        <StatCard label="Team members" value={fmt(data?.totals.staff)} loading={isLoading} />
      </div>

      <Card>
        <CardHeader title="By store" description="Sorted by AI use this month." />
        {isLoading || !data ? (
          <div className="p-5">
            <Skeleton className="h-64" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-content-subtle">
                  <th className="px-5 py-2.5 font-medium">Store</th>
                  <th className="px-5 py-2.5 font-medium">Plan</th>
                  <th className="px-5 py-2.5 text-right font-medium">AI this month</th>
                  <th className="px-5 py-2.5 text-right font-medium">Products</th>
                  <th className="px-5 py-2.5 text-right font-medium">Orders</th>
                  <th className="px-5 py-2.5 text-right font-medium">Team</th>
                </tr>
              </thead>
              <tbody>
                {data.tenants.map((row) => (
                  <tr key={row.tenantId} className="border-b border-line last:border-0">
                    <td className="px-5 py-3">
                      <Link href={`/platform/${row.tenantId}`} className="font-medium text-content hover:text-primary">
                        {row.name}
                      </Link>
                      <p className="text-xs text-content-subtle">{row.slug}</p>
                    </td>
                    <td className="px-5 py-3 text-content-muted">{row.planCode}</td>
                    <td className="px-5 py-3 text-right">
                      <Ratio used={row.aiGenerations} limit={row.aiLimit} />
                    </td>
                    <td className="px-5 py-3 text-right">
                      <Ratio used={row.products} limit={row.productLimit} />
                    </td>
                    <td className="px-5 py-3 text-right tabular text-content-muted">{fmt(row.orders)}</td>
                    <td className="px-5 py-3 text-right">
                      <Ratio used={row.staff} limit={row.staffLimit} />
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

function Ratio({ used, limit }: { used: number; limit: number | null }) {
  const bounded = limit !== null && limit >= 0;
  const near = bounded && limit > 0 && used / limit >= 0.8;
  return (
    <span className={cn('tabular', near ? 'font-semibold text-warning-700 dark:text-warning-100' : 'text-content-muted')}>
      {fmt(used)}
      {bounded && <span className="text-content-subtle"> / {fmt(limit)}</span>}
    </span>
  );
}

function fmt(n: number | null | undefined): string {
  return typeof n === 'number' ? n.toLocaleString('en-IN') : '—';
}
