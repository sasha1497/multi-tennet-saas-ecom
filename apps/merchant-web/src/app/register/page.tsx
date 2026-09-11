'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Loader2, X } from 'lucide-react';
import { isApiClientError } from '@retailos/api-client';
import { BUSINESS_CATEGORY_GROUPS } from '@retailos/config';
import { slugify } from '@retailos/validation';
import { Button, Input, Select } from '@retailos/ui';
import { AuthShell, FormError } from '@/components/auth/auth-shell';
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

  const set =
    (key: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
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
        // Everyone starts on the ₹499 plan's trial. Setup then walks them
        // through choosing a design and seeing their store before the
        // subscription is ever mentioned.
        planCode: 'STARTER',
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
    <AuthShell
      wide
      title="Create your store"
      description="Your own branded storefront in a couple of minutes. No card needed."
      aside={{
        heading: 'From this form to your first order.',
        points: [
          'Your storefront and its own private database are provisioned in seconds.',
          'Pick from twelve designs built for real trades, and preview your shop in each.',
          'Add products, publish, and start taking orders on your own web address.',
        ],
        note: 'Free plan available. Paid plans include a 14-day trial — nothing is charged today.',
      }}
      footer={
        <>
          Already have a store?{' '}
          <Link href="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="space-y-5" noValidate>
        {error && <FormError>{error}</FormError>}

        {/* ------------------------------------------------------------ you -- */}
        <fieldset className="space-y-4">
          <legend className="eyebrow mb-1">About you</legend>

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
        </fieldset>

        {/* -------------------------------------------------------- the shop -- */}
        <fieldset className="space-y-4 border-t border-line pt-5">
          <legend className="eyebrow mb-1">Your store</legend>

          <Input
            label="Store name"
            required
            value={form.storeName}
            onChange={set('storeName')}
            error={fieldErrors.storeName}
            placeholder="e.g. Mehta Footwear"
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
                <Loader2 className="h-4 w-4 animate-spin" aria-label="Checking availability" />
              ) : slugState.available === true ? (
                <Check className="h-4 w-4 text-success-600" aria-label="Available" />
              ) : slugState.available === false ? (
                <X className="h-4 w-4 text-danger-600" aria-label="Taken" />
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

          {/* Drives which storefront designs we recommend during setup. */}
          <Select
            label="What do you sell?"
            value={form.businessCategory}
            onChange={set('businessCategory')}
            placeholder="Choose a category"
            options={BUSINESS_CATEGORY_GROUPS.flatMap((group) =>
              group.categories.map((c) => ({ value: c, label: `${group.label} · ${c}` })),
            )}
            hint="We use this to suggest storefront designs. You can change it later."
          />
        </fieldset>

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
    </AuthShell>
  );
}
