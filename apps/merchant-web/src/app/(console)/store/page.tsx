'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, ImagePlus } from 'lucide-react';
import type { StoreSettings } from '@retailos/types';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Switch,
  Tabs,
  Textarea,
  useToast,
} from '@retailos/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { paiseToRupees, rupeesToPaise, useErrorToast } from '@/lib/hooks';

export default function StorePage() {
  const [tab, setTab] = useState<'branding' | 'checkout' | 'contact'>('branding');
  const { activeTenant } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['store-settings'],
    queryFn: () => api().merchant.storeSettings(),
  });

  const [form, setForm] = useState<StoreSettings | null>(null);
  const [uploading, setUploading] = useState(false);

  // Seed the editable copy once the server data arrives.
  useEffect(() => {
    if (data && !form) setForm(data);
  }, [data, form]);

  const save = useMutation({
    mutationFn: () => {
      if (!form) throw new Error('Not loaded');
      return api().merchant.updateStoreSettings({
        storeName: form.storeName,
        tagline: form.tagline,
        description: form.description,
        logoUrl: form.logoUrl,
        theme: form.theme,
        contactEmail: form.contactEmail,
        contactPhone: form.contactPhone,
        whatsappNumber: form.whatsappNumber,
        addressLine1: form.addressLine1,
        addressLine2: form.addressLine2,
        city: form.city,
        state: form.state,
        postalCode: form.postalCode,
        defaultTaxRateBps: form.defaultTaxRateBps,
        taxInclusivePricing: form.taxInclusivePricing,
        minOrderAmount: form.minOrderAmount,
        shippingFee: form.shippingFee,
        freeShippingThreshold: form.freeShippingThreshold,
        codEnabled: form.codEnabled,
        onlinePaymentEnabled: form.onlinePaymentEnabled,
        allowBackorder: form.allowBackorder,
        isPublished: form.isPublished,
      });
    },
    onSuccess: () => {
      toast.success('Store settings saved', 'Your storefront updates within a minute.');
      void queryClient.invalidateQueries({ queryKey: ['store-settings'] });
    },
    onError: (err) => showError(err, 'Could not save your settings'),
  });

  const uploadLogo = async (file: File) => {
    setUploading(true);
    try {
      const result = await api().merchant.uploadFile(file, file.name);
      setForm((f) => (f ? { ...f, logoUrl: result.url } : f));
    } catch (err) {
      showError(err, 'Could not upload the logo');
    } finally {
      setUploading(false);
    }
  };

  if (isLoading || !form) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-64 rounded-xl" />
      </div>
    );
  }

  const set = <K extends keyof StoreSettings>(key: K, value: StoreSettings[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Store design"
        description="How your storefront looks and how checkout behaves."
        actions={
          <div className="flex items-center gap-2">
            {activeTenant && (
              <a
                href={activeTenant.storefrontUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm text-content hover:bg-surface-muted"
              >
                <ExternalLink className="h-4 w-4" />
                Preview
              </a>
            )}
            <Button onClick={() => save.mutate()} loading={save.isPending}>
              Save changes
            </Button>
          </div>
        }
      />

      <Tabs
        tabs={[
          { id: 'branding', label: 'Branding' },
          { id: 'checkout', label: 'Checkout & tax' },
          { id: 'contact', label: 'Contact' },
        ]}
        active={tab}
        onChange={(id) => setTab(id as typeof tab)}
        className="mb-4"
      />

      {tab === 'branding' && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Identity" />
            <CardBody className="space-y-4">
              <div className="flex items-center gap-4">
                {form.logoUrl ? (
                  <img
                    src={form.logoUrl}
                    alt="Store logo"
                    className="h-16 w-16 rounded-xl border border-line object-contain p-1"
                  />
                ) : (
                  <span className="flex h-16 w-16 items-center justify-center rounded-xl bg-surface-muted text-content-subtle">
                    <ImagePlus className="h-5 w-5" />
                  </span>
                )}
                <div>
                  <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm text-content hover:bg-surface-muted">
                    {uploading ? 'Uploading…' : 'Upload logo'}
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) void uploadLogo(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <p className="mt-1 text-xs text-content-subtle">PNG or SVG-like artwork works best.</p>
                </div>
              </div>

              <Input
                label="Store name"
                value={form.storeName}
                onChange={(e) => set('storeName', e.target.value)}
              />
              <Input
                label="Tagline"
                value={form.tagline ?? ''}
                onChange={(e) => set('tagline', e.target.value)}
                hint="One line under your store name on the home page."
              />
              <Textarea
                label="About your store"
                rows={3}
                value={form.description ?? ''}
                onChange={(e) => set('description', e.target.value)}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Colours"
              description="Applied live to your storefront — no rebuild needed."
            />
            <CardBody className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <ColourField
                  label="Primary colour"
                  value={form.theme.primaryColor}
                  onChange={(v) => set('theme', { ...form.theme, primaryColor: v })}
                />
                <ColourField
                  label="Accent colour"
                  value={form.theme.accentColor}
                  onChange={(v) => set('theme', { ...form.theme, accentColor: v })}
                />
              </div>
              <Select
                label="Corner style"
                value={form.theme.radius}
                onChange={(e) =>
                  set('theme', { ...form.theme, radius: e.target.value as typeof form.theme.radius })
                }
                options={[
                  { value: 'none', label: 'Square' },
                  { value: 'sm', label: 'Slightly rounded' },
                  { value: 'md', label: 'Rounded' },
                  { value: 'lg', label: 'Very rounded' },
                  { value: 'full', label: 'Pill' },
                ]}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Visibility" />
            <CardBody>
              <Switch
                checked={form.isPublished}
                onChange={(v) => set('isPublished', v)}
                label="Storefront is live"
                description="Turn this off to put your shop behind a temporary maintenance notice."
              />
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'checkout' && (
        <div className="space-y-4">
          <Card>
            <CardHeader title="Payment methods" />
            <CardBody className="space-y-4">
              <Switch
                checked={form.codEnabled}
                onChange={(v) => set('codEnabled', v)}
                label="Cash on delivery"
                description="Customers pay when the order arrives."
              />
              <Switch
                checked={form.onlinePaymentEnabled}
                onChange={(v) => set('onlinePaymentEnabled', v)}
                label="Online payment"
                description="UPI, cards and net banking through the payment gateway."
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Delivery" />
            <CardBody className="space-y-4">
              <Input
                label="Delivery fee (₹)"
                type="number"
                step="0.01"
                value={paiseToRupees(form.shippingFee)}
                onChange={(e) => set('shippingFee', rupeesToPaise(e.target.value))}
              />
              <Input
                label="Free delivery above (₹)"
                type="number"
                step="0.01"
                value={paiseToRupees(form.freeShippingThreshold)}
                onChange={(e) => set('freeShippingThreshold', rupeesToPaise(e.target.value))}
                hint="Set 0 to always charge the delivery fee."
              />
              <Input
                label="Minimum order value (₹)"
                type="number"
                step="0.01"
                value={paiseToRupees(form.minOrderAmount)}
                onChange={(e) => set('minOrderAmount', rupeesToPaise(e.target.value))}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Tax" />
            <CardBody className="space-y-4">
              <Input
                label="Default GST rate (%)"
                type="number"
                step="0.01"
                value={String(form.defaultTaxRateBps / 100)}
                onChange={(e) => set('defaultTaxRateBps', Math.round(Number(e.target.value) * 100))}
                hint="Products can override this individually."
              />
              <Switch
                checked={form.taxInclusivePricing}
                onChange={(v) => set('taxInclusivePricing', v)}
                label="Prices include tax"
                description="The usual convention for Indian retail — the price on the label is what the customer pays."
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Stock" />
            <CardBody>
              <Switch
                checked={form.allowBackorder}
                onChange={(v) => set('allowBackorder', v)}
                label="Allow orders when out of stock"
                description="Off by default. Turn on only if you can reliably fulfil from a supplier."
              />
            </CardBody>
          </Card>
        </div>
      )}

      {tab === 'contact' && (
        <Card>
          <CardHeader title="Contact details" description="Shown in your storefront footer." />
          <CardBody className="space-y-4">
            <Input
              label="Contact email"
              type="email"
              value={form.contactEmail ?? ''}
              onChange={(e) => set('contactEmail', e.target.value)}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <Input
                label="Phone"
                value={form.contactPhone ?? ''}
                onChange={(e) => set('contactPhone', e.target.value)}
              />
              <Input
                label="WhatsApp"
                value={form.whatsappNumber ?? ''}
                onChange={(e) => set('whatsappNumber', e.target.value)}
              />
            </div>
            <Input
              label="Address line 1"
              value={form.addressLine1 ?? ''}
              onChange={(e) => set('addressLine1', e.target.value)}
            />
            <Input
              label="Address line 2"
              value={form.addressLine2 ?? ''}
              onChange={(e) => set('addressLine2', e.target.value)}
            />
            <div className="grid gap-4 sm:grid-cols-3">
              <Input label="City" value={form.city ?? ''} onChange={(e) => set('city', e.target.value)} />
              <Input
                label="State"
                value={form.state ?? ''}
                onChange={(e) => set('state', e.target.value)}
              />
              <Input
                label="PIN code"
                value={form.postalCode ?? ''}
                onChange={(e) => set('postalCode', e.target.value)}
              />
            </div>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

function ColourField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-content">{label}</label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 w-12 cursor-pointer rounded-lg border border-line bg-surface p-1"
          aria-label={label}
        />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-10 flex-1 rounded-lg border border-line bg-surface px-3 font-mono text-sm uppercase text-content"
        />
      </div>
    </div>
  );
}
