'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { isApiClientError } from '@retailos/api-client';
import { Button, Card, Input, Spinner } from '@retailos/ui';
import { useStore } from '@/lib/store-context';

function LoginForm() {
  const { bootstrap, login, customer, authLoading } = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/account';

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!authLoading && customer) router.replace(next);
  }, [authLoading, customer, router, next]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(identifier.trim(), password);
      router.replace(next);
    } catch (err) {
      setError(
        isApiClientError(err)
          ? err.message
          : 'Could not reach the store. Check your connection and try again.',
      );
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6 text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm px-4 py-14">
      <div className="mb-7 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-content">Sign in</h1>
        <p className="mt-1.5 text-sm text-content-muted">
          to continue shopping at {bootstrap.store.storeName}
        </p>
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
            label="Email or mobile number"
            required
            autoComplete="username"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder="you@example.com"
          />

          <Input
            label="Password"
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />

          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Sign in
          </Button>
        </form>
      </Card>

      <p className="mt-5 text-center text-sm text-content-muted">
        New to {bootstrap.store.storeName}?{' '}
        <Link
          href={`/register?next=${encodeURIComponent(next)}`}
          className="font-medium text-primary hover:underline"
        >
          Create an account
        </Link>
      </p>

      {process.env.NODE_ENV !== 'production' && (
        <Card className="mt-6 bg-surface-muted p-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-content-muted">
            Demo shopper
          </p>
          <button
            type="button"
            className="text-xs text-primary hover:underline"
            onClick={() => {
              setIdentifier(
                bootstrap.tenant.slug === 'kickzone'
                  ? 'priya@example.com'
                  : bootstrap.tenant.slug === 'abcstore'
                    ? 'vikram@example.com'
                    : 'karthik@example.com',
              );
              setPassword('Password@123');
            }}
          >
            Fill in a demo account for this store
          </button>
        </Card>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="py-24" />}>
      <LoginForm />
    </Suspense>
  );
}
