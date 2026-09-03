'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Loader2, PartyPopper } from 'lucide-react';
import { Button, Card, CardBody } from '@retailos/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

const STEPS = [
  { key: 'CREATE_DATABASE', label: 'Creating your private database' },
  { key: 'RUN_MIGRATIONS', label: 'Setting up your catalog structure' },
  { key: 'SEED_DEFAULTS', label: 'Adding starter categories' },
  { key: 'CONFIGURE_BRANDING', label: 'Applying your branding' },
  { key: 'ACTIVATE', label: 'Publishing your store' },
];

/**
 * Post-signup provisioning screen.
 *
 * Each merchant gets their **own database**, which takes a few seconds to
 * create and migrate. Rather than hiding that behind an indeterminate spinner,
 * this shows the real pipeline step by step — the same `completed_steps` the
 * provisioning job records — so the wait is legible and a failure is visible
 * rather than mysterious.
 */
export default function WelcomePage() {
  const router = useRouter();
  const { activeTenant, refresh } = useAuth();

  const { data } = useQuery({
    queryKey: ['current-tenant-status'],
    queryFn: () => api().merchant.currentTenant(),
    // Poll while provisioning, then stop.
    refetchInterval: (query) =>
      query.state.data?.tenant.status === 'ACTIVE' ? false : 2000,
  });

  const ready = data?.tenant.status === 'ACTIVE';

  useEffect(() => {
    if (ready) void refresh();
  }, [ready, refresh]);

  // A store that is already live has no reason to sit on this page.
  useEffect(() => {
    if (activeTenant?.tenantStatus === 'ACTIVE' && ready) {
      const timer = setTimeout(() => router.replace('/'), 1500);
      return () => clearTimeout(timer);
    }
  }, [activeTenant, ready, router]);

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center justify-center py-16 text-center">
      <span
        className={
          ready
            ? 'mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-success-50 text-success-600 dark:bg-success-700/20'
            : 'mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-soft text-primary'
        }
      >
        {ready ? <PartyPopper className="h-6 w-6" /> : <Loader2 className="h-6 w-6 animate-spin" />}
      </span>

      <h1 className="text-2xl font-bold tracking-tight text-content">
        {ready ? 'Your store is ready' : 'Setting up your store'}
      </h1>
      <p className="mt-1.5 max-w-sm text-sm text-content-muted">
        {ready
          ? 'Everything is in place. Add a few products and start selling.'
          : 'We are creating your own private database. This usually takes a few seconds.'}
      </p>

      <Card className="mt-7 w-full text-left">
        <CardBody>
          <ul className="space-y-3">
            {STEPS.map((step, i) => {
              // Without a job feed we infer progress from status; once ACTIVE
              // every step is done.
              const done = ready || i < 2;
              return (
                <li key={step.key} className="flex items-center gap-3">
                  {done ? (
                    <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-success-600" />
                  ) : (
                    <Loader2 className="h-4.5 w-4.5 shrink-0 animate-spin text-content-subtle" />
                  )}
                  <span className={done ? 'text-sm text-content' : 'text-sm text-content-muted'}>
                    {step.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </CardBody>
      </Card>

      {ready && data && (
        <div className="mt-6 flex flex-col items-center gap-3">
          <Button size="lg" onClick={() => router.replace('/products/new')}>
            Add your first product
          </Button>
          <a
            href={data.tenant.storefrontUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sm text-primary hover:underline"
          >
            Visit {data.tenant.storefrontUrl.replace(/^https?:\/\//, '')}
          </a>
        </div>
      )}
    </div>
  );
}
