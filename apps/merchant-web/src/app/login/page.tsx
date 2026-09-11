'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { isApiClientError } from '@retailos/api-client';
import { Button, Input } from '@retailos/ui';
import { AuthShell, FormError } from '@/components/auth/auth-shell';
import { useAuth } from '@/lib/auth-context';

/** Where a signed-in merchant lands when nothing more specific was requested. */
const DEFAULT_DESTINATION = '/dashboard';

function LoginForm() {
  const { login, session, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();

  /**
   * Only in-app paths are honoured.
   *
   * `?next=` arrives from the console's own redirect, but it is still
   * attacker-controllable in a link — accepting `//evil.example` or
   * `https://evil.example` would turn sign-in into an open redirect. A single
   * leading slash, and no second one, is the whole rule.
   */
  const requested = params.get('next');
  const next =
    requested && requested.startsWith('/') && !requested.startsWith('//')
      ? requested
      : DEFAULT_DESTINATION;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // Already signed in: skip the form entirely.
  useEffect(() => {
    if (!loading && session) router.replace(next);
  }, [loading, session, router, next]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await login(email.trim(), password);
      router.replace(next);
    } catch (err) {
      if (isApiClientError(err)) {
        setFieldErrors(err.fieldErrors);
        setError(err.message);
      } else {
        setError('Could not reach the server. Check your connection and try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      description="Sign in to manage your store, orders and inventory."
      aside={{
        heading: 'Your shop, your numbers, one place to run it.',
        points: [
          'Orders that need you are surfaced the moment you sign in.',
          'Stock, catalogue and customers stay in step automatically.',
          'Switch between the stores you manage without signing out.',
        ],
      }}
      footer={
        <>
          New here?{' '}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create your store
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <FormError>{error}</FormError>}

        <Input
          label="Email address"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
          placeholder="you@yourstore.com"
        />

        <Input
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          placeholder="••••••••"
        />

        <Button type="submit" fullWidth loading={submitting} size="lg" className="!mt-6">
          Sign in
        </Button>
      </form>

      {process.env.NODE_ENV !== 'production' && <DemoAccounts onPick={setEmail} setPassword={setPassword} />}
    </AuthShell>
  );
}

/**
 * Local-development convenience.
 *
 * Gated on `NODE_ENV` so it is stripped from a production build entirely — these
 * are seeded development accounts and they must never appear on a deployed
 * sign-in page.
 */
function DemoAccounts({
  onPick,
  setPassword,
}: {
  onPick: (email: string) => void;
  setPassword: (password: string) => void;
}) {
  const accounts = [
    { email: 'owner@kickzone.dev', password: 'Password@123', role: 'Store owner' },
    { email: 'staff@kickzone.dev', password: 'Password@123', role: 'Manager' },
    { email: 'admin@retailos.dev', password: 'SuperAdmin@123', role: 'Platform admin' },
  ];

  return (
    <div className="mt-8 rounded-xl border border-dashed border-line p-4">
      <p className="eyebrow mb-3">Development accounts</p>
      <ul className="space-y-1">
        {accounts.map((account) => (
          <li key={account.email}>
            <button
              type="button"
              onClick={() => {
                onPick(account.email);
                setPassword(account.password);
              }}
              className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-muted"
            >
              <span className="truncate text-sm text-content">{account.email}</span>
              <span className="shrink-0 text-2xs text-content-subtle">{account.role}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 px-2 text-2xs text-content-subtle">
        Only shown when running locally.
      </p>
    </div>
  );
}

export default function LoginPage() {
  // `useSearchParams` requires a Suspense boundary in the app router.
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface" />}>
      <LoginForm />
    </Suspense>
  );
}
