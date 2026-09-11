'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CreditCard,
  Eye,
  PartyPopper,
  ShieldCheck,
  Sparkles,
  Store,
} from 'lucide-react';
import { BUSINESS_CATEGORY_GROUPS, formatMoney } from '@retailos/config';
import { getTemplate, type TemplateDefinition } from '@retailos/templates';
import {
  Badge,
  Button,
  Card,
  CardBody,
  Input,
  Skeleton,
  Textarea,
  cn,
  useToast,
} from '@retailos/ui';
import { DevicePreview, type Device } from '@/components/store-design/device-preview';
import { TemplateCard } from '@/components/store-design/template-card';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useErrorToast } from '@/lib/hooks';

type Step = 'category' | 'template' | 'preview' | 'brand' | 'review' | 'plan' | 'done';

const STEPS: { id: Step; label: string }[] = [
  { id: 'category', label: 'What you sell' },
  { id: 'template', label: 'Design' },
  { id: 'preview', label: 'Preview' },
  { id: 'brand', label: 'Branding' },
  { id: 'review', label: 'Review' },
  { id: 'plan', label: 'Subscription' },
];

/**
 * Store setup.
 *
 * The order matters more than anything else on this page: the merchant sees
 * their own store, in the design they picked, *before* they are asked to pay
 * for it. Nobody should be asked for ₹499 for a website they have not looked
 * at — so preview comes at step three and the price at step six.
 *
 * Every step writes as it goes, using the same endpoints the console uses for
 * the rest of the store's life. There is no separate "onboarding" data path
 * and nothing here that a merchant cannot redo later from Store Design.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();
  const { activeTenant, refresh } = useAuth();

  const [step, setStep] = useState<Step>('category');
  const [category, setCategory] = useState<string | null>(null);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [device, setDevice] = useState<Device>('desktop');
  const [brand, setBrand] = useState({ storeName: '', tagline: '', description: '' });
  const [brandSeeded, setBrandSeeded] = useState(false);

  const { data: tenant } = useQuery({
    queryKey: ['current-tenant'],
    queryFn: () => api().merchant.currentTenant(),
  });

  const { data: catalogue } = useQuery({
    queryKey: ['store-templates'],
    queryFn: () => api().merchant.storeTemplates(),
  });

  const { data: settings } = useQuery({
    queryKey: ['store-settings'],
    queryFn: () => api().merchant.storeSettings(),
  });

  const { data: billing } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => api().merchant.subscription(),
  });

  const storefrontUrl = activeTenant?.storefrontUrl ?? tenant?.tenant.storefrontUrl ?? '';

  // Seed from whatever already exists, so re-entering setup is not a reset.
  useEffect(() => {
    if (tenant?.tenant.businessCategory && category === null) {
      setCategory(tenant.tenant.businessCategory);
    }
  }, [tenant, category]);

  useEffect(() => {
    if (catalogue && templateId === null) setTemplateId(catalogue.active.templateId);
  }, [catalogue, templateId]);

  useEffect(() => {
    if (settings && !brandSeeded) {
      setBrand({
        storeName: settings.storeName,
        tagline: settings.tagline ?? '',
        description: settings.description ?? '',
      });
      setBrandSeeded(true);
    }
  }, [settings, brandSeeded]);

  const saveCategory = useMutation({
    mutationFn: (value: string) => api().merchant.updateBusinessCategory(value),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['current-tenant'] });
      void queryClient.invalidateQueries({ queryKey: ['store-templates'] });
    },
    onError: (err) => showError(err, 'Could not save what you sell'),
  });

  const saveTemplate = useMutation({
    mutationFn: (id: string) => api().merchant.updateStoreTemplate({ templateId: id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['store-templates'] });
      void queryClient.invalidateQueries({ queryKey: ['store-settings'] });
    },
    onError: (err) => showError(err, 'Could not apply that design'),
  });

  const saveBrand = useMutation({
    mutationFn: () =>
      api().merchant.updateStoreSettings({
        storeName: brand.storeName.trim(),
        tagline: brand.tagline.trim() || null,
        description: brand.description.trim() || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['store-settings'] });
    },
    onError: (err) => showError(err, 'Could not save your branding'),
  });

  const subscribe = useMutation({
    mutationFn: async (planCode: string) => {
      const checkout = await api().merchant.startSubscriptionCheckout(planCode);
      return api().merchant.confirmSubscription(planCode, checkout.reference);
    },
    onSuccess: async (result) => {
      toast.success(`You're on ${result.planName}`, 'Your store is live.');
      await queryClient.invalidateQueries({ queryKey: ['subscription'] });
      await refresh();
      setStep('done');
    },
    onError: (err) => showError(err, 'Could not complete the payment'),
  });

  const templates = catalogue?.templates ?? [];
  const recommended = useMemo(
    () => new Set(catalogue?.recommendedIds ?? []),
    [catalogue?.recommendedIds],
  );
  const chosen: TemplateDefinition | null = templateId ? getTemplate(templateId) : null;

  // ₹499 is the STARTER plan; fall back to the cheapest paid plan if a
  // deployment has renamed it rather than hard-coding a price in the UI.
  const paidPlan =
    billing?.plans.find((p) => p.code === 'STARTER') ??
    billing?.plans.filter((p) => p.priceMonthly > 0).sort((a, b) => a.priceMonthly - b.priceMonthly)[0] ??
    null;

  if (!tenant || !catalogue || !settings) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <Skeleton className="h-8 w-full max-w-md" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);

  return (
    <div className="mx-auto max-w-5xl pb-10">
      {/* ── Progress ───────────────────────────────────────────────────── */}
      {step !== 'done' && (
        <>
          <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-2" aria-label="Setup steps">
            {STEPS.map((s, i) => {
              const done = i < stepIndex;
              const current = i === stepIndex;
              return (
                <li key={s.id} className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold',
                      done
                        ? 'bg-success-600 text-white'
                        : current
                          ? 'bg-primary text-primary-fg'
                          : 'bg-surface-muted text-content-subtle',
                    )}
                  >
                    {done ? <Check className="h-3 w-3" aria-hidden="true" /> : i + 1}
                  </span>
                  <span
                    className={cn(
                      'text-xs font-medium',
                      current ? 'text-content' : 'text-content-subtle',
                    )}
                  >
                    {s.label}
                  </span>
                  {i < STEPS.length - 1 && (
                    <span aria-hidden="true" className="hidden h-px w-6 bg-line sm:block" />
                  )}
                </li>
              );
            })}
          </ol>

          {stepIndex > 0 && (
            <button
              type="button"
              onClick={() => setStep(STEPS[stepIndex - 1].id)}
              className="mb-3 inline-flex items-center gap-1.5 text-sm text-content-muted hover:text-content"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </button>
          )}
        </>
      )}

      {/* ── 1. What you sell ───────────────────────────────────────────── */}
      {step === 'category' && (
        <section>
          <StepHeading
            title="What does your shop sell?"
            description="This is how we pick the storefront designs to show you. You can change it later."
          />
          <div className="space-y-5">
            {BUSINESS_CATEGORY_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-content-subtle">
                  {group.label}
                </p>
                <div className="flex flex-wrap gap-2">
                  {group.categories.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setCategory(option)}
                      aria-pressed={category === option}
                      className={cn(
                        'rounded-full border px-4 py-2 text-sm font-medium transition',
                        category === option
                          ? 'border-primary bg-primary text-primary-fg'
                          : 'border-line bg-surface text-content-muted hover:border-content-subtle hover:text-content',
                      )}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          <StepFooter>
            <Button
              size="lg"
              disabled={!category}
              loading={saveCategory.isPending}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              onClick={async () => {
                if (!category) return;
                await saveCategory.mutateAsync(category);
                setStep('template');
              }}
            >
              Show me designs
            </Button>
          </StepFooter>
        </section>
      )}

      {/* ── 2. Design ──────────────────────────────────────────────────── */}
      {step === 'template' && (
        <section>
          <StepHeading
            title="Pick a look for your store"
            description={
              category
                ? `These are designed for ${category}. Nothing is final — you can preview any of them next, and change it whenever you like.`
                : 'You can preview any of these next, and change it whenever you like.'
            }
          />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                active={template.id === templateId}
                recommended={recommended.has(template.id)}
                onPreview={() => {
                  setTemplateId(template.id);
                  setStep('preview');
                }}
                onUse={() => setTemplateId(template.id)}
              />
            ))}
          </div>

          <StepFooter>
            <Button
              size="lg"
              disabled={!templateId}
              rightIcon={<Eye className="h-4 w-4" />}
              onClick={() => setStep('preview')}
            >
              Preview my store
            </Button>
          </StepFooter>
        </section>
      )}

      {/* ── 3. Preview ─────────────────────────────────────────────────── */}
      {step === 'preview' && chosen && (
        <section>
          <StepHeading
            title={`This is your store in ${chosen.name}`}
            description="The real thing, on your own web address — click around it. Add products later and they will appear here."
          />
          <Card>
            <CardBody>
              {storefrontUrl ? (
                <DevicePreview
                  storefrontUrl={storefrontUrl}
                  templateId={chosen.id}
                  device={device}
                  onDeviceChange={setDevice}
                  height={560}
                />
              ) : (
                <p className="py-10 text-center text-sm text-content-muted">
                  Your storefront address is still being set up.
                </p>
              )}
            </CardBody>
          </Card>

          <StepFooter>
            <Button variant="outline" size="lg" onClick={() => setStep('template')}>
              Try another design
            </Button>
            <Button
              size="lg"
              loading={saveTemplate.isPending}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              onClick={async () => {
                await saveTemplate.mutateAsync(chosen.id);
                setStep('brand');
              }}
            >
              Use {chosen.name}
            </Button>
          </StepFooter>
        </section>
      )}

      {/* ── 4. Branding ────────────────────────────────────────────────── */}
      {step === 'brand' && (
        <section>
          <StepHeading
            title="Make it yours"
            description="Your shop's name and the line customers read first. You can add a logo and colours in Store settings."
          />
          <Card>
            <CardBody className="space-y-4">
              <Input
                label="Store name"
                value={brand.storeName}
                onChange={(e) => setBrand((b) => ({ ...b, storeName: e.target.value }))}
                required
              />
              <Input
                label="Tagline"
                value={brand.tagline}
                onChange={(e) => setBrand((b) => ({ ...b, tagline: e.target.value }))}
                placeholder="Quality products, delivered locally"
                hint="One line, shown under your name on the home page."
              />
              <Textarea
                label="About your shop"
                rows={3}
                value={brand.description}
                onChange={(e) => setBrand((b) => ({ ...b, description: e.target.value }))}
                hint="A short paragraph. Some designs show this as a section on your home page."
              />
            </CardBody>
          </Card>

          <StepFooter>
            <Button
              size="lg"
              loading={saveBrand.isPending}
              disabled={brand.storeName.trim().length === 0}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              onClick={async () => {
                await saveBrand.mutateAsync();
                setStep('review');
              }}
            >
              Save and continue
            </Button>
          </StepFooter>
        </section>
      )}

      {/* ── 5. Review ──────────────────────────────────────────────────── */}
      {step === 'review' && (
        <section>
          <StepHeading
            title="Here is your store"
            description="Everything is in place. One last look before we talk about the subscription."
          />
          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <Card>
              <CardBody>
                {storefrontUrl && (
                  <DevicePreview
                    storefrontUrl={storefrontUrl}
                    device={device}
                    onDeviceChange={setDevice}
                    height={460}
                  />
                )}
              </CardBody>
            </Card>

            <Card className="self-start">
              <CardBody className="space-y-3.5">
                <SummaryRow label="Store name" value={brand.storeName} />
                <SummaryRow label="Web address" value={storefrontUrl.replace(/^https?:\/\//, '')} />
                <SummaryRow label="What you sell" value={category ?? '—'} />
                <SummaryRow label="Design" value={chosen?.name ?? '—'} />
                <SummaryRow
                  label="Storefront"
                  value={settings.isPublished ? 'Live' : 'Not published yet'}
                />
              </CardBody>
            </Card>
          </div>

          <StepFooter>
            <Button size="lg" rightIcon={<ArrowRight className="h-4 w-4" />} onClick={() => setStep('plan')}>
              Continue to subscription
            </Button>
          </StepFooter>
        </section>
      )}

      {/* ── 6. Subscription ────────────────────────────────────────────── */}
      {step === 'plan' && (
        <section>
          <StepHeading
            title="Your RetailOS subscription"
            description="This is what you pay us for the platform. What your customers pay you for products is separate and settles into your own account."
          />

          <Card>
            <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-fg">
                <Store className="h-5 w-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-content">
                    {paidPlan?.name ?? 'Subscription'}
                  </h2>
                  {billing?.subscription?.isTrialing && <Badge tone="info">On trial</Badge>}
                </div>
                <p className="mt-0.5 text-sm text-content-muted tabular">
                  {paidPlan
                    ? `${formatMoney(paidPlan.priceMonthly, paidPlan.currency, { hideDecimals: true })} per month`
                    : '—'}
                </p>
                {billing?.subscription?.isTrialing && billing.subscription.daysRemaining > 0 && (
                  <p className="mt-1 text-xs text-content-subtle tabular">
                    Your trial runs for another {billing.subscription.daysRemaining} days. Paying
                    now starts a full month from today.
                  </p>
                )}
              </div>
              <div className="shrink-0">
                {billing?.billingAvailable ? (
                  <Button
                    size="lg"
                    loading={subscribe.isPending}
                    disabled={!paidPlan}
                    leftIcon={<CreditCard className="h-4 w-4" />}
                    onClick={() => paidPlan && subscribe.mutate(paidPlan.code)}
                  >
                    Pay{' '}
                    {paidPlan &&
                      formatMoney(paidPlan.priceMonthly, paidPlan.currency, { hideDecimals: true })}
                  </Button>
                ) : (
                  <Button size="lg" variant="outline" onClick={() => setStep('done')}>
                    Continue
                  </Button>
                )}
              </div>
            </CardBody>
          </Card>

          {!billing?.billingAvailable && (
            <p className="mt-3 text-xs text-content-muted">
              Subscription payments are not switched on for this deployment yet — your store works
              regardless.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setStep('done')}
              className="text-sm text-content-muted underline hover:text-content"
            >
              Skip for now
            </button>
          </div>

          <p className="mt-5 flex items-start gap-2 rounded-lg border border-line bg-surface-muted px-4 py-3 text-xs text-content-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" aria-hidden="true" />
            You are paying RetailOS for the platform. Your customers&apos; payments for products go
            to your own payment gateway — we never hold or take a share of your sales.
          </p>
        </section>
      )}

      {/* ── Done ───────────────────────────────────────────────────────── */}
      {step === 'done' && (
        <section className="py-10 text-center">
          <span className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-success-50 text-success-600 dark:bg-success-700/20">
            <PartyPopper className="h-6 w-6" />
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-content">Your store is ready</h1>
          <p className="mx-auto mt-2 max-w-md text-sm text-content-muted">
            {brand.storeName} is set up in {chosen?.name}. Add a few products and you are open for
            business.
          </p>

          <div className="mx-auto mt-8 grid max-w-2xl gap-3 sm:grid-cols-2">
            <Button size="lg" onClick={() => router.push('/products/new')}>
              Add your first product
            </Button>
            <a
              href={storefrontUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-line px-5 text-sm font-semibold text-content transition hover:bg-surface-muted"
            >
              <Sparkles className="h-4 w-4" />
              Visit my store
            </a>
          </div>

          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="mt-6 text-sm text-content-muted underline hover:text-content"
          >
            Go to my dashboard
          </button>
        </section>
      )}
    </div>
  );
}

function StepHeading({ title, description }: { title: string; description: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold tracking-tight text-content">{title}</h1>
      <p className="mt-1.5 max-w-2xl text-sm text-content-muted">{description}</p>
    </div>
  );
}

function StepFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-7 flex flex-wrap items-center gap-3">{children}</div>;
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-content-subtle">
        {label}
      </p>
      <p className="mt-0.5 break-words text-sm font-medium text-content">{value}</p>
    </div>
  );
}
