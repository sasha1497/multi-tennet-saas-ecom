'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Lock, Search, ShieldCheck, X } from 'lucide-react';
import { getTemplate, TEMPLATE_GROUPS, type TemplateDefinition } from '@retailos/templates';
import type { TemplateAccess } from '@retailos/types';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  Input,
  Modal,
  Skeleton,
  Tabs,
  cn,
  useToast,
} from '@retailos/ui';
import { ButtonLink, PageHead } from '@/components/console/primitives';
import { DevicePreview, type Device } from '@/components/store-design/device-preview';
import { SwitchTemplateDialog } from '@/components/store-design/switch-template-dialog';
import { FAMILY_COPY, TemplateCard, upgradeHref } from '@/components/store-design/template-card';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useErrorToast } from '@/lib/hooks';

type Family = 'all' | TemplateDefinition['tier'];
/** The secondary rail: who the design is for, not which plan it needs. */
type Group = 'all' | 'recommended' | (typeof TEMPLATE_GROUPS)[number];

const FAMILIES: TemplateDefinition['tier'][] = ['standard', 'premium', '3d'];

/**
 * The template gallery.
 *
 *   Design → Templates → Standard · Premium · 3D
 *
 * Every family is shown, including the ones the store's plan does not include,
 * because seeing what an upgrade unlocks is part of choosing a plan. Whether a
 * template can be *used* comes from the API's `access` record — the console
 * only draws the lock; the server is what refuses the switch.
 *
 * Preview is always allowed, locked or not: it is the merchant's real
 * storefront with their real products, and it writes nothing.
 */
export default function TemplateGalleryPage() {
  const { activeTenant } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [family, setFamily] = useState<Family>('all');
  const [group, setGroup] = useState<Group>('all');
  const [query, setQuery] = useState('');
  const [previewing, setPreviewing] = useState<TemplateDefinition | null>(null);
  const [confirming, setConfirming] = useState<TemplateDefinition | null>(null);
  const [device, setDevice] = useState<Device>('desktop');

  const { data: catalogue, isLoading } = useQuery({
    queryKey: ['store-templates'],
    queryFn: () => api().merchant.storeTemplates(),
  });

  const { data: tenant } = useQuery({
    queryKey: ['current-tenant'],
    queryFn: () => api().merchant.currentTenant(),
  });

  const storefrontUrl = activeTenant?.storefrontUrl ?? tenant?.tenant.storefrontUrl ?? '';
  const activeId = catalogue?.active.templateId;
  const activeTemplate = activeId ? getTemplate(activeId, catalogue?.active.templateVersion) : null;
  const accessOf = (t: TemplateDefinition): TemplateAccess | undefined => catalogue?.access?.[t.id];

  const switchTemplate = useMutation({
    mutationFn: (templateId: string) => api().merchant.updateStoreTemplate({ templateId }),
    onSuccess: (_result, templateId) => {
      const chosen = getTemplate(templateId);
      toast.success(
        `Your store now uses ${chosen?.name ?? 'the new design'}`,
        'It is live for shoppers now. Your products, orders and customers are exactly as they were.',
      );
      setConfirming(null);
      setPreviewing(null);
      void queryClient.invalidateQueries({ queryKey: ['store-templates'] });
      void queryClient.invalidateQueries({ queryKey: ['store-settings'] });
    },
    onError: (err) => {
      setConfirming(null);
      // A 403 here means the plan changed under the page; refresh the locks.
      void queryClient.invalidateQueries({ queryKey: ['store-templates'] });
      showError(err, 'Could not switch your template');
    },
  });

  const recommended = useMemo(() => new Set(catalogue?.recommendedIds ?? []), [catalogue]);

  const visible = useMemo(() => {
    if (!catalogue) return [];
    const needle = query.trim().toLowerCase();

    return catalogue.templates.filter((template) => {
      if (family !== 'all' && template.tier !== family) return false;
      if (group === 'recommended' && !recommended.has(template.id)) return false;
      if (group !== 'all' && group !== 'recommended' && template.group !== group) return false;
      if (!needle) return true;
      return (
        template.name.toLowerCase().includes(needle) ||
        template.tagline.toLowerCase().includes(needle) ||
        template.group.toLowerCase().includes(needle) ||
        template.tier.includes(needle) ||
        template.businessTypes.some((type) => type.toLowerCase().includes(needle))
      );
    });
  }, [catalogue, family, group, query, recommended]);

  if (isLoading || !catalogue) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-9 w-64" />
        <Skeleton className="h-10 w-full max-w-md" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-80 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const familyLocked = (tier: TemplateDefinition['tier']) => {
    const sample = catalogue.templates.find((t) => t.tier === tier);
    return sample ? accessOf(sample)?.allowed === false : false;
  };

  const familyTabs = [
    { id: 'all', label: 'All designs', count: catalogue.templates.length },
    ...FAMILIES.filter((tier) => catalogue.templates.some((t) => t.tier === tier)).map((tier) => ({
      id: tier,
      label: (
        <span className="inline-flex items-center gap-1.5">
          {FAMILY_COPY[tier].label}
          {familyLocked(tier) && <Lock className="h-3 w-3 text-content-subtle" aria-label="locked" />}
        </span>
      ),
      count: catalogue.templates.filter((t) => t.tier === tier).length,
    })),
  ];

  const groups: Group[] = [
    'all',
    ...(recommended.size > 0 ? (['recommended'] as Group[]) : []),
    ...TEMPLATE_GROUPS,
  ];

  const lockedFamilyBanner =
    family !== 'all' && familyLocked(family) ? catalogue.templates.find((t) => t.tier === family) : null;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHead
        breadcrumbs={[{ label: 'Store design', href: '/store' }, { label: 'Templates' }]}
        title="Choose a storefront design"
        description={
          tenant?.tenant.businessCategory
            ? `Designs built for ${tenant.tenant.businessCategory} come first. Preview any of them with your own products before you switch.`
            : 'Preview any design with your own products before you switch.'
        }
      />

      {/* ── Downgrade notice ─────────────────────────────────────────────── */}
      {!catalogue.activeAllowed && activeTemplate && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-xl border border-warning-500/40 bg-warning-50 p-4 sm:flex-row sm:items-center dark:bg-warning-700/15"
        >
          <AlertTriangle className="h-5 w-5 shrink-0 text-warning-600" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-content">
              {activeTemplate.name} is not part of your current plan
            </p>
            <p className="mt-0.5 text-content-muted">
              Your storefront is still live and unchanged. Choose a design your plan includes, or
              upgrade to keep {activeTemplate.name}.
            </p>
          </div>
          <ButtonLink
            href={upgradeHref(accessOf(activeTemplate)?.requiredPlan)}
            size="sm"
            className="shrink-0"
          >
            Upgrade to keep it
          </ButtonLink>
        </div>
      )}

      {/* ── Family tabs ──────────────────────────────────────────────────── */}
      <Tabs tabs={familyTabs} active={family} onChange={(id) => setFamily(id as Family)} />

      {/* ── Search + industry rail ───────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle"
            aria-hidden="true"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search designs…"
            className="pl-9"
            aria-label="Search designs"
          />
        </div>

        <div className="scroll-slim -mx-1 flex min-w-0 max-w-full gap-1.5 overflow-x-auto px-1 pb-1">
          {groups.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setGroup(option)}
              aria-pressed={group === option}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition',
                group === option
                  ? 'border-primary bg-primary text-primary-fg'
                  : 'border-line bg-surface text-content-muted hover:border-content-subtle hover:text-content',
              )}
            >
              {option === 'all'
                ? 'Every industry'
                : option === 'recommended'
                  ? 'Recommended for you'
                  : option}
            </button>
          ))}
        </div>
      </div>

      {lockedFamilyBanner && family !== 'all' && (
        <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-muted p-4 sm:flex-row sm:items-center">
          <Lock className="h-4 w-4 shrink-0 text-content-subtle" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm text-content-muted">
            <span className="font-semibold text-content">{FAMILY_COPY[family].label}</span> designs
            come with the {accessOf(lockedFamilyBanner)?.requiredPlan ?? 'next'} plan — every one
            of them, including designs added later. Preview any of them with your products now.
          </p>
          <ButtonLink
            href={upgradeHref(accessOf(lockedFamilyBanner)?.requiredPlan)}
            size="sm"
            variant="outline"
            className="shrink-0"
          >
            See plans
          </ButtonLink>
        </div>
      )}

      {/* ── Gallery ──────────────────────────────────────────────────────── */}
      {visible.length === 0 ? (
        <EmptyState
          icon={<Search className="h-5 w-5" />}
          title="No designs match that"
          description="Try a different word, or clear the filters to see the full catalogue."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setQuery('');
                setGroup('all');
                setFamily('all');
              }}
              leftIcon={<X className="h-3.5 w-3.5" />}
            >
              Clear filters
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((template) => (
            <TemplateCard
              key={template.id}
              template={template}
              access={accessOf(template)}
              active={template.id === activeId}
              recommended={recommended.has(template.id)}
              onPreview={() => setPreviewing(template)}
              onUse={() => setConfirming(template)}
              busy={switchTemplate.isPending && confirming?.id === template.id}
            />
          ))}
        </div>
      )}

      <p className="flex items-start gap-2 rounded-lg border border-line bg-surface-muted px-4 py-3 text-xs text-content-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" aria-hidden="true" />
        Previewing a design changes nothing. Switching changes your storefront&apos;s appearance
        only — your catalogue, orders, customers, payments and stock are untouched, and you can
        switch back whenever you like.
      </p>

      {/* ── Live preview ─────────────────────────────────────────────────── */}
      <Modal
        open={previewing !== null}
        onClose={() => setPreviewing(null)}
        size="xl"
        title={previewing ? `${previewing.name} · with your products` : ''}
        description={previewing?.tagline}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPreviewing(null)}>
              Close
            </Button>
            {previewing &&
              previewing.id !== activeId &&
              (accessOf(previewing)?.allowed === false ? (
                <ButtonLink
                  href={upgradeHref(accessOf(previewing)?.requiredPlan)}
                  leftIcon={<Lock className="h-4 w-4" />}
                >
                  Upgrade to {planName(accessOf(previewing)?.requiredPlan)}
                </ButtonLink>
              ) : (
                <Button
                  onClick={() => setConfirming(previewing)}
                  leftIcon={<Check className="h-4 w-4" />}
                >
                  Use this template
                </Button>
              ))}
          </>
        }
      >
        {previewing && storefrontUrl ? (
          <DevicePreview
            storefrontUrl={storefrontUrl}
            templateId={previewing.id}
            device={device}
            onDeviceChange={setDevice}
            height={520}
          />
        ) : (
          <Card>
            <CardBody className="py-10 text-center text-sm text-content-muted">
              Your storefront address is not ready yet, so there is nothing to preview.
            </CardBody>
          </Card>
        )}
      </Modal>

      {/* ── Confirmation ─────────────────────────────────────────────────── */}
      <SwitchTemplateDialog
        open={confirming !== null}
        from={activeTemplate}
        to={confirming}
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && switchTemplate.mutate(confirming.id)}
        busy={switchTemplate.isPending}
      />
    </div>
  );
}

function planName(code: string | undefined): string {
  return code ? code.charAt(0) + code.slice(1).toLowerCase() : 'a higher plan';
}
