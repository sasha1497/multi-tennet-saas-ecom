'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Check, Search, ShieldCheck, X } from 'lucide-react';
import { getTemplate, TEMPLATE_GROUPS, type TemplateDefinition } from '@retailos/templates';
import {
  Button,
  Card,
  CardBody,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Skeleton,
  cn,
  useToast,
} from '@retailos/ui';
import { DevicePreview, type Device } from '@/components/store-design/device-preview';
import { SwitchTemplateDialog } from '@/components/store-design/switch-template-dialog';
import { TemplateCard } from '@/components/store-design/template-card';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useErrorToast } from '@/lib/hooks';

/**
 * Gallery filters.
 *
 * Tier sits in the same rail as industry rather than in a separate control:
 * a merchant filtering the catalogue is answering one question — "show me the
 * ones like this" — and splitting it across two widgets makes them answer it
 * twice.
 */
type Filter = 'all' | 'recommended' | 'standard' | 'premium' | (typeof TEMPLATE_GROUPS)[number];

/**
 * The template gallery.
 *
 * Two things make this trustworthy rather than a gamble. First, preview is the
 * merchant's real storefront with their real products — not a stock mockup, so
 * "what will *my* shop look like" has an honest answer before they commit.
 * Second, switching is explicit and reversible, and the confirmation says
 * exactly what is preserved.
 */
export default function TemplateGalleryPage() {
  const { activeTenant } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState<Filter>('all');
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

  const switchTemplate = useMutation({
    mutationFn: (templateId: string) => api().merchant.updateStoreTemplate({ templateId }),
    onSuccess: (_result, templateId) => {
      const chosen = getTemplate(templateId);
      toast.success(
        `Your store now uses ${chosen?.name ?? 'the new design'}`,
        'Your products, orders and customers are exactly as they were.',
      );
      setConfirming(null);
      setPreviewing(null);
      void queryClient.invalidateQueries({ queryKey: ['store-templates'] });
      void queryClient.invalidateQueries({ queryKey: ['store-settings'] });
    },
    onError: (err) => showError(err, 'Could not switch your template'),
  });

  const visible = useMemo(() => {
    if (!catalogue) return [];
    const recommended = new Set(catalogue.recommendedIds);
    const needle = query.trim().toLowerCase();

    return catalogue.templates.filter((template) => {
      if (filter === 'recommended' && !recommended.has(template.id)) return false;
      if (filter === 'standard' && template.tier !== 'standard') return false;
      if (filter === 'premium' && template.tier !== 'premium') return false;
      if (
        filter !== 'all' &&
        filter !== 'recommended' &&
        filter !== 'standard' &&
        filter !== 'premium' &&
        template.group !== filter
      ) {
        return false;
      }
      if (!needle) return true;
      return (
        template.name.toLowerCase().includes(needle) ||
        template.tagline.toLowerCase().includes(needle) ||
        template.group.toLowerCase().includes(needle) ||
        template.tier.includes(needle) ||
        template.businessTypes.some((type) => type.toLowerCase().includes(needle))
      );
    });
  }, [catalogue, filter, query]);

  if (isLoading || !catalogue) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-9 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-80 rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  const recommended = new Set(catalogue.recommendedIds);
  const filters: Filter[] = [
    'all',
    ...(recommended.size > 0 ? (['recommended'] as Filter[]) : []),
    'standard',
    'premium',
    ...TEMPLATE_GROUPS,
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/store"
        className="mb-3 inline-flex items-center gap-1.5 text-sm text-content-muted hover:text-content"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Store design
      </Link>

      <PageHeader
        title="Choose a storefront design"
        description={
          tenant?.tenant.businessCategory
            ? `Designs built for ${tenant.tenant.businessCategory} come first. Preview any of them with your own products before you switch.`
            : 'Preview any design with your own products before you switch.'
        }
      />

      {/* ── Filters ────────────────────────────────────────────────────── */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
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

        <div className="scroll-slim -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
          {filters.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setFilter(option)}
              aria-pressed={filter === option}
              className={cn(
                'shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition',
                filter === option
                  ? 'border-primary bg-primary text-primary-fg'
                  : 'border-line bg-surface text-content-muted hover:border-content-subtle hover:text-content',
              )}
            >
              {option === 'all'
                ? 'All designs'
                : option === 'recommended'
                  ? 'Recommended for you'
                  : option === 'standard'
                    ? 'Standard'
                    : option === 'premium'
                      ? 'Premium'
                      : option}
            </button>
          ))}
        </div>
      </div>

      {/* ── Gallery ────────────────────────────────────────────────────── */}
      {visible.length === 0 ? (
        <EmptyState
          icon={<Search className="h-5 w-5" />}
          title="No designs match that"
          description="Try a different word, or clear the filter to see the full catalogue."
          action={
            <Button
              variant="outline"
              onClick={() => {
                setQuery('');
                setFilter('all');
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
              active={template.id === activeId}
              recommended={recommended.has(template.id)}
              onPreview={() => setPreviewing(template)}
              onUse={() => setConfirming(template)}
              busy={switchTemplate.isPending && confirming?.id === template.id}
            />
          ))}
        </div>
      )}

      <p className="mt-6 flex items-start gap-2 rounded-lg border border-line bg-surface-muted px-4 py-3 text-xs text-content-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" aria-hidden="true" />
        Previewing a design changes nothing. Switching changes your storefront&apos;s appearance
        only — your catalogue, orders, customers, payments and stock are untouched, and you can
        switch back whenever you like.
      </p>

      {/* ── Live preview ───────────────────────────────────────────────── */}
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
            {previewing && previewing.id !== activeId && (
              <Button
                onClick={() => setConfirming(previewing)}
                leftIcon={<Check className="h-4 w-4" />}
              >
                Use this template
              </Button>
            )}
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

      {/* ── Confirmation ───────────────────────────────────────────────── */}
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
