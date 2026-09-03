'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Store, X } from 'lucide-react';
import { isApiClientError } from '@retailos/api-client';
import { BUSINESS_CATEGORIES } from '@retailos/config';
import { slugify } from '@retailos/validation';
import { Button, Card, Input, Select } from '@retailos/ui';
import { api, setActiveTenantId, tokenStore } from '@/lib/api';

type SlugState = { checking: boolean; available: boolean | null; suggestion?: string; url?: string };

export default function RegisterPage() {
  const router = useRouter();

  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    storeName: '',
    storeSlug: '',
    businessCategory: '',
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const [slugState, setSlugState] = useState<SlugState>({ checking: false, available: null });
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  // Derive the store address from the name until the merchant edits it.
  const effectiveSlug = slugTouched ? form.storeSlug : slugify(form.storeName);

  useEffect(() => {
    if (effectiveSlug.length < 3) {
      setSlugState({ checking: false, available: null });
      return;
    }
    setSlugState((s) => ({ ...s, checking: true }));
    // Debounced so typing a store name does not fire a request per keystroke.
    const timer = setTimeout(async () => {
      try {
        const result = await api().auth.checkSlug(effectiveSlug);
        setSlugState({
          checking: false,
          available: result.available,
          suggestion: result.suggestion,
          url: result.storefrontUrl,
        });
      } catch {
        setSlugState({ checking: false, available: null });
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [effectiveSlug]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setFieldErrors({});
    setSubmitting(true);
    try {
      const result = await api().auth.registerMerchant({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        password: form.password,
        storeName: form.storeName.trim(),
        storeSlug: effectiveSlug || undefined,
        businessCategory: form.businessCategory || undefined,
      });

      tokenStore.set({
        accessToken: result.tokens.accessToken,
        refreshToken: result.tokens.refreshToken,
      });
      setActiveTenantId(result.tenant.id);
      // The store is still provisioning; the welcome screen polls until ready.
      router.replace('/welcome');
    } catch (err) {
      if (isApiClientError(err)) {
        setFieldErrors(err.fieldErrors);
        setError(err.message);
      } else {
        setError('Could not reach the server. Please try again.');
      }
      setSubmitting(false);
    }
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-7 text-center">
          <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-fg">
            <Store className="h-5.5 w-5.5" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-content">Create your store</h1>
          <p className="mt-1 text-sm text-content-muted">
            Your own branded storefront in a couple of minutes. No card needed.
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
                required
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
              required
              value={form.phone}
              onChange={set('phone')}
              error={fieldErrors.phone}
              placeholder="9876543210"
              autoComplete="tel"
            />

            <Input
              label="Password"
              type="password"
              required
              value={form.password}
              onChange={set('password')}
              error={fieldErrors.password}
              hint="At least 8 characters, including a letter and a number."
              autoComplete="new-password"
            />

            <hr className="border-line" />

            <Input
              label="Store name"
              required
              value={form.storeName}
              onChange={set('storeName')}
              error={fieldErrors.storeName}
              placeholder="KickZone"
            />

            <Input
              label="Store address"
              value={effectiveSlug}
              onChange={(e) => {
                setSlugTouched(true);
                setForm((f) => ({ ...f, storeSlug: slugify(e.target.value) }));
              }}
              error={fieldErrors.storeSlug}
              rightSlot={
                slugState.checking ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : slugState.available === true ? (
                  <Check className="h-4 w-4 text-success-600" />
                ) : slugState.available === false ? (
                  <X className="h-4 w-4 text-danger-600" />
                ) : null
              }
              hint={
                slugState.available === false && slugState.suggestion ? (
                  <span className="text-danger-600">
                    Taken.{' '}
                    <button
                      type="button"
                      className="font-medium underline"
                      onClick={() => {
                        setSlugTouched(true);
                        setForm((f) => ({ ...f, storeSlug: slugState.suggestion! }));
                      }}
                    >
                      Use {slugState.suggestion}
                    </button>
                  </span>
                ) : effectiveSlug.length >= 3 ? (
                  <>
                    Your storefront will be{' '}
                    <span className="font-medium text-content">
                      {slugState.url ?? `${effectiveSlug}.localhost`}
                    </span>
                  </>
                ) : (
                  'This becomes your storefront web address.'
                )
              }
            />

            <Select
              label="What do you sell?"
              value={form.businessCategory}
              onChange={set('businessCategory')}
              placeholder="Choose a category"
              options={BUSINESS_CATEGORIES.map((c) => ({ value: c, label: c }))}
            />

            <Button
              type="submit"
              fullWidth
              size="lg"
              loading={submitting}
              disabled={slugState.available === false}
            >
              Create my store
            </Button>

            <p className="text-center text-xs text-content-subtle">
              By continuing you agree to the platform terms of service.
            </p>
          </form>
        </Card>

        <p className="mt-5 text-center text-sm text-content-muted">
          Already have a store?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
