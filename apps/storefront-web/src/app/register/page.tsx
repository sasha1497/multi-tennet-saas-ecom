'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { isApiClientError } from '@retailos/api-client';
import { Button, Card, Input } from '@retailos/ui';
import { useStore } from '@/lib/store-context';

function RegisterForm() {
  const { bootstrap, register } = useStore();
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get('next') ?? '/account';

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      await register({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        password: form.password,
      });
      router.replace(next);
    } catch (err) {
      if (isApiClientError(err)) {
        setFieldErrors(err.fieldErrors);
        setError(err.message);
      } else {
        setError('Could not reach the store. Please try again.');
      }
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-sm px-4 py-14">
      <div className="mb-7 text-center">
        <h1 className="text-2xl font-bold tracking-tight text-content">Create your account</h1>
        <p className="mt-1.5 text-sm text-content-muted">
          Track orders and check out faster at {bootstrap.store.storeName}.
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

          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="First name"
              required
              value={form.firstName}
              onChange={set('firstName')}
              error={fieldErrors.firstName}
              autoComplete="given-name"
            />
            <Input
              label="Last name"
              value={form.lastName}
              onChange={set('lastName')}
              error={fieldErrors.lastName}
              autoComplete="family-name"
            />
          </div>

          <Input
            label="Email address"
            type="email"
            required
            value={form.email}
            onChange={set('email')}
            error={fieldErrors.email}
            autoComplete="email"
          />

          <Input
            label="Mobile number"
            type="tel"
            value={form.phone}
            onChange={set('phone')}
            error={fieldErrors.phone}
            placeholder="9876543210"
            hint="For delivery updates."
            autoComplete="tel"
          />

          <Input
            label="Password"
            type="password"
            required
            value={form.password}
            onChange={set('password')}
            error={fieldErrors.password}
            hint="At least 8 characters, with a letter and a number."
            autoComplete="new-password"
          />

          <Button type="submit" size="lg" fullWidth loading={submitting}>
            Create account
          </Button>
        </form>
      </Card>

      <p className="mt-5 text-center text-sm text-content-muted">
        Already have an account?{' '}
        <Link
          href={`/login?next=${encodeURIComponent(next)}`}
          className="font-medium text-primary hover:underline"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div className="py-24" />}>
      <RegisterForm />
    </Suspense>
  );
}
