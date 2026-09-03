'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Store } from 'lucide-react';
import { isApiClientError } from '@retailos/api-client';
import { Button, Card, Input } from '@retailos/ui';
import { useAuth } from '@/lib/auth-context';

function LoginForm() {
  const { login, session, loading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/';

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
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-fg">
            <Store className="h-5.5 w-5.5" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-content">Sign in to RetailOS</h1>
          <p className="mt-1 text-sm text-content-muted">Manage your store, orders and inventory.</p>
        </div>

        <Card className="p-6">
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-danger-200 bg-danger-50 px-3 py-2.5 text-sm text-danger-700 dark:border-danger-700/40 dark:bg-danger-700/15 dark:text-danger-100"
              >
                {error}
              </div>
            )}

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

            <Button type="submit" fullWidth loading={submitting} size="lg">
              Sign in
            </Button>
          </form>
        </Card>

        <p className="mt-5 text-center text-sm text-content-muted">
          New here?{' '}
          <Link href="/register" className="font-medium text-primary hover:underline">
            Create your store
          </Link>
        </p>

        {process.env.NODE_ENV !== 'production' && (
          <Card className="mt-6 bg-surface-muted p-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-muted">
              Demo accounts
            </p>
            <ul className="space-y-1 text-xs text-content-muted">
              <li>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => {
                    setEmail('owner@kickzone.dev');
                    setPassword('Password@123');
                  }}
                >
                  owner@kickzone.dev
                </button>{' '}
                — store owner
              </li>
              <li>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => {
                    setEmail('staff@kickzone.dev');
                    setPassword('Password@123');
                  }}
                >
                  staff@kickzone.dev
                </button>{' '}
                — manager (limited permissions)
              </li>
              <li>
                <button
                  type="button"
                  className="text-primary hover:underline"
                  onClick={() => {
                    setEmail('admin@retailos.dev');
                    setPassword('SuperAdmin@123');
                  }}
                >
                  admin@retailos.dev
                </button>{' '}
                — platform admin
              </li>
            </ul>
            <p className="mt-2 text-[11px] text-content-subtle">
              Passwords: <code>Password@123</code> / <code>SuperAdmin@123</code>
            </p>
          </Card>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  // `useSearchParams` requires a Suspense boundary in the app router.
  return (
    <Suspense fallback={<div className="min-h-screen" />}>
      <LoginForm />
    </Suspense>
  );
}
