'use client';

import { useQuery } from '@tanstack/react-query';
import { Activity, CheckCircle2, XCircle } from 'lucide-react';
import { formatDate } from '@retailos/config';
import { Badge, Card, CardBody, CardHeader, PageHeader, Skeleton } from '@retailos/ui';
import { api } from '@/lib/api';

export default function SystemPage() {
  const { data: health, isLoading } = useQuery({
    queryKey: ['platform-health'],
    queryFn: () => api().platform.systemHealth(),
    refetchInterval: 15_000,
  });

  const { data: queues } = useQuery({
    queryKey: ['platform-queues'],
    queryFn: () => api().platform.queues(),
    refetchInterval: 10_000,
  });

  const { data: audit } = useQuery({
    queryKey: ['platform-audit'],
    queryFn: () => api().platform.auditLogs({ limit: 25 }),
  });

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="System" description="Service health, queues and the platform audit trail." />

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Services" description="Refreshed every 15 seconds." />
          <CardBody>
            {isLoading || !health ? (
              <Skeleton className="h-40" />
            ) : (
              <ul className="space-y-3">
                {health.map((service) => (
                  <li key={service.service} className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-2.5">
                      {service.status === 'ok' ? (
                        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
                      ) : (
                        <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger-600" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-content">
                          {service.service.replace(/-/g, ' ')}
                        </p>
                        {service.message && (
                          <p className="text-xs text-content-muted">{service.message}</p>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <Badge
                        tone={
                          service.status === 'ok'
                            ? 'success'
                            : service.status === 'degraded'
                              ? 'warning'
                              : 'danger'
                        }
                        dot
                      >
                        {service.status}
                      </Badge>
                      {service.latencyMs !== null && (
                        <p className="mt-0.5 text-xs text-content-subtle tabular">
                          {service.latencyMs} ms
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Background queues" description="Refreshed every 10 seconds." />
          <CardBody>
            {!queues ? (
              <Skeleton className="h-40" />
            ) : (
              <div className="scroll-slim overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-content-muted">
                      <th className="pb-2">Queue</th>
                      <th className="pb-2 text-right">Waiting</th>
                      <th className="pb-2 text-right">Active</th>
                      <th className="pb-2 text-right">Failed</th>
                    </tr>
                  </thead>
                  <tbody>
                    {queues.map((q) => (
                      <tr key={q.name} className="border-b border-line last:border-0">
                        <td className="py-2 text-content">{q.name}</td>
                        <td className="py-2 text-right tabular">{q.waiting}</td>
                        <td className="py-2 text-right tabular">{q.active}</td>
                        <td
                          className={
                            q.failed > 0
                              ? 'py-2 text-right tabular font-semibold text-danger-600'
                              : 'py-2 text-right tabular text-content-muted'
                          }
                        >
                          {q.failed}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader
          title="Recent platform activity"
          description="Tenant lifecycle, sign-ins and administrative changes."
        />
        <CardBody>
          {!audit ? (
            <Skeleton className="h-48" />
          ) : audit.items.length === 0 ? (
            <p className="py-6 text-center text-sm text-content-muted">Nothing recorded yet.</p>
          ) : (
            <ul className="space-y-2.5">
              {audit.items.map((entry) => (
                <li
                  key={entry.id}
                  className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5 last:border-0 last:pb-0"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Activity className="h-3.5 w-3.5 shrink-0 text-content-subtle" />
                    <div className="min-w-0">
                      <p className="truncate text-sm text-content">
                        <span className="font-medium">{entry.action.replace(/_/g, ' ').toLowerCase()}</span>
                        {entry.tenantSlug && (
                          <span className="text-content-muted"> · {entry.tenantSlug}</span>
                        )}
                      </p>
                      {entry.userEmail && (
                        <p className="truncate text-xs text-content-subtle">{entry.userEmail}</p>
                      )}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-content-subtle">
                    {formatDate(entry.createdAt, true)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
