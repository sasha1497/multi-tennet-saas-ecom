'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Lock,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react';
import {
  builderSections,
  getTemplate,
  type TemplateCustomization,
  type TemplateSection,
} from '@retailos/templates';
import { Badge, Button, Card, CardBody, Input, Skeleton, cn, useToast } from '@retailos/ui';
import { PageHead } from '@/components/console/primitives';
import { DevicePreview, type Device } from '@/components/store-design/device-preview';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import { useDebounced, useErrorToast } from '@/lib/hooks';

/**
 * The store builder.
 *
 * Sections on the left, the merchant's real storefront in the middle, the
 * selected section's settings on the right. Everything here writes to
 * `template_customization` and nothing else — hiding a section hides a *block
 * on the home page*, never the products inside it.
 *
 * Changes are staged locally and applied on save, so a half-finished
 * rearrangement is never live to customers. The preview, however, shows the
 * *draft*: it is the merchant's real storefront rendered through the layout
 * they are currently building, carried over in the URL and never written (see
 * `@retailos/templates/preview`). Rearranging blocks against a preview that
 * could not show them was the single least useful thing about this page.
 */
export default function CustomizePage() {
  const { activeTenant } = useAuth();
  const toast = useToast();
  const showError = useErrorToast();
  const queryClient = useQueryClient();

  const [device, setDevice] = useState<Device>('desktop');
  const [draft, setDraft] = useState<TemplateCustomization | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [previewNonce, setPreviewNonce] = useState(0);

  const { data: catalogue, isLoading } = useQuery({
    queryKey: ['store-templates'],
    queryFn: () => api().merchant.storeTemplates(),
  });

  const { data: tenant } = useQuery({
    queryKey: ['current-tenant'],
    queryFn: () => api().merchant.currentTenant(),
  });

  const storefrontUrl = activeTenant?.storefrontUrl ?? tenant?.tenant.storefrontUrl ?? '';
  const template = catalogue
    ? getTemplate(catalogue.active.templateId, catalogue.active.templateVersion)
    : null;

  // Seed the draft from what is live, once.
  useEffect(() => {
    if (catalogue && !draft) setDraft(catalogue.active.customization ?? {});
  }, [catalogue, draft]);

  const rows = useMemo(() => {
    if (!catalogue || !draft) return [];
    return builderSections({
      templateId: catalogue.active.templateId,
      templateVersion: catalogue.active.templateVersion,
      customization: draft,
    });
  }, [catalogue, draft]);

  const dirty = useMemo(() => {
    if (!catalogue || !draft) return false;
    return JSON.stringify(normalise(draft)) !== JSON.stringify(normalise(catalogue.active.customization ?? {}));
  }, [catalogue, draft]);

  /**
   * The draft the preview frame is currently showing.
   *
   * Held one step behind the editor so that reordering three sections is one
   * reload rather than three, and typing a heading is one rather than one per
   * character. 500 ms is long enough to swallow a burst of clicks and short
   * enough that it still reads as live.
   */
  const debouncedDraft = useDebounced(draft, 500);

  /**
   * Null while the draft still matches what is published.
   *
   * Sending an override that says exactly what the store already says would
   * reload the frame for no visible change — including once on first paint,
   * which would read as a flicker. So the preview only carries a draft from the
   * moment one actually diverges.
   */
  const previewDraft = useMemo(() => {
    if (!catalogue || !debouncedDraft) return null;
    const saved = normalise(catalogue.active.customization ?? {});
    return JSON.stringify(normalise(debouncedDraft)) === JSON.stringify(saved)
      ? null
      : debouncedDraft;
  }, [catalogue, debouncedDraft]);

  const save = useMutation({
    mutationFn: () => api().merchant.updateStoreTemplate({ customization: draft ?? {} }),
    onSuccess: async () => {
      toast.success('Your home page is updated', 'Customers see the change within a minute.');
      await queryClient.invalidateQueries({ queryKey: ['store-templates'] });
      setPreviewNonce((n) => n + 1);
    },
    onError: (err) => showError(err, 'Could not save your layout'),
  });

  if (isLoading || !catalogue || !draft || !template) {
    return (
      <div className="mx-auto max-w-7xl space-y-4">
        <Skeleton className="h-9 w-56" />
        <div className="grid gap-4 lg:grid-cols-[280px_1fr_300px]">
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    );
  }

  const order = rows.map((r) => r.section.id);
  const selectedRow = rows.find((r) => r.section.id === selected) ?? null;

  const toggle = (section: TemplateSection, visible: boolean) => {
    setDraft((d) => {
      const hidden = new Set(d?.hiddenSections ?? []);
      const shown = new Set(d?.shownSections ?? []);
      if (visible) {
        hidden.delete(section.id);
        shown.add(section.id);
      } else {
        shown.delete(section.id);
        hidden.add(section.id);
      }
      return { ...d, hiddenSections: [...hidden], shownSections: [...shown] };
    });
  };

  const move = (index: number, delta: number) => {
    const next = [...order];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    setDraft((d) => ({ ...d, sectionOrder: next }));
  };

  const setText = (id: string, field: 'title' | 'subtitle', value: string) => {
    setDraft((d) => ({
      ...d,
      sectionText: {
        ...(d?.sectionText ?? {}),
        // An empty box means "use the template's own wording", not "blank".
        [id]: { ...(d?.sectionText?.[id] ?? {}), [field]: value.trim() === '' ? null : value },
      },
    }));
  };

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHead
        breadcrumbs={[{ label: 'Store design', href: '/store' }, { label: 'Home page' }]}
        title="Customise your home page"
        description={`Show, hide, reorder and retitle the blocks in ${template.name}. Your catalogue is not affected.`}
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => setDraft(catalogue.active.customization ?? {})}
              disabled={!dirty || save.isPending}
              leftIcon={<RotateCcw className="h-4 w-4" />}
            >
              Discard
            </Button>
            <Button onClick={() => save.mutate()} loading={save.isPending} disabled={!dirty}>
              {dirty ? 'Save changes' : 'Saved'}
            </Button>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_300px]">
        {/* ── Sections ─────────────────────────────────────────────────── */}
        <Card className="order-1 self-start">
          <CardBody className="p-3">
            <p className="px-1 pb-2 text-[11px] font-semibold uppercase tracking-wider text-content-subtle">
              Home page sections
            </p>
            <ul className="space-y-1">
              {rows.map((row, index) => (
                <li key={row.section.id}>
                  <div
                    className={cn(
                      'group flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition',
                      selected === row.section.id
                        ? 'border-primary bg-primary-soft'
                        : 'border-transparent hover:bg-surface-muted',
                      !row.visible && 'opacity-55',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelected(row.section.id)}
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm font-medium text-content">
                        {row.section.title ?? SECTION_LABEL[row.section.kind] ?? row.section.id}
                      </span>
                      <span className="block truncate text-[11px] text-content-subtle">
                        {SECTION_LABEL[row.section.kind] ?? row.section.kind}
                      </span>
                    </button>

                    <span className="flex shrink-0 items-center">
                      <button
                        type="button"
                        onClick={() => move(index, -1)}
                        disabled={index === 0}
                        className="rounded p-1 text-content-subtle hover:text-content disabled:opacity-30"
                        aria-label={`Move ${row.section.id} up`}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, 1)}
                        disabled={index === rows.length - 1}
                        className="rounded p-1 text-content-subtle hover:text-content disabled:opacity-30"
                        aria-label={`Move ${row.section.id} down`}
                      >
                        <ChevronDown className="h-3.5 w-3.5" />
                      </button>

                      {row.section.removable ? (
                        <button
                          type="button"
                          onClick={() => toggle(row.section, !row.visible)}
                          className="rounded p-1 text-content-subtle hover:text-content"
                          aria-label={row.visible ? 'Hide this section' : 'Show this section'}
                          aria-pressed={row.visible}
                        >
                          {row.visible ? (
                            <Eye className="h-3.5 w-3.5" />
                          ) : (
                            <EyeOff className="h-3.5 w-3.5" />
                          )}
                        </button>
                      ) : (
                        <span
                          className="p-1 text-content-subtle"
                          title="Every storefront needs this section"
                        >
                          <Lock className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="sr-only">Always shown</span>
                        </span>
                      )}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>

        {/* ── Live preview ─────────────────────────────────────────────── */}
        <Card className="order-3 xl:order-2">
          <CardBody>
            {storefrontUrl ? (
              <>
                <DevicePreview
                  key={previewNonce}
                  storefrontUrl={storefrontUrl}
                  customization={previewDraft}
                  device={device}
                  onDeviceChange={setDevice}
                  height={620}
                />
                {dirty && (
                  <p className="mt-3 rounded-lg bg-warning-50 px-3 py-2 text-xs text-warning-700 dark:bg-warning-700/15 dark:text-warning-100">
                    This preview shows your unsaved changes. Your customers still see the saved
                    layout until you press Save.
                  </p>
                )}
              </>
            ) : (
              <p className="py-10 text-center text-sm text-content-muted">
                Your storefront address is not ready yet.
              </p>
            )}
          </CardBody>
        </Card>

        {/* ── Section settings ─────────────────────────────────────────── */}
        <Card className="order-2 self-start xl:order-3">
          <CardBody className="space-y-4">
            {selectedRow ? (
              <>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-content-subtle">
                    Section
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <h2 className="text-sm font-semibold text-content">
                      {SECTION_LABEL[selectedRow.section.kind] ?? selectedRow.section.kind}
                    </h2>
                    <Badge tone={selectedRow.visible ? 'success' : 'neutral'} dot>
                      {selectedRow.visible ? 'Shown' : 'Hidden'}
                    </Badge>
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-content-muted">
                    {SECTION_HELP[selectedRow.section.kind]}
                  </p>
                </div>

                {HAS_HEADING.has(selectedRow.section.kind) && (
                  <>
                    <Input
                      label="Heading"
                      value={draft.sectionText?.[selectedRow.section.id]?.title ?? ''}
                      onChange={(e) => setText(selectedRow.section.id, 'title', e.target.value)}
                      placeholder={selectedRow.section.title ?? ''}
                      hint="Leave empty to use the template's own wording."
                    />
                    <Input
                      label="Sub-heading"
                      value={draft.sectionText?.[selectedRow.section.id]?.subtitle ?? ''}
                      onChange={(e) => setText(selectedRow.section.id, 'subtitle', e.target.value)}
                      placeholder={selectedRow.section.subtitle ?? ''}
                    />
                  </>
                )}

                {selectedRow.section.removable ? (
                  <Button
                    variant="outline"
                    fullWidth
                    onClick={() => toggle(selectedRow.section, !selectedRow.visible)}
                    leftIcon={
                      selectedRow.visible ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )
                    }
                  >
                    {selectedRow.visible ? 'Hide this section' : 'Show this section'}
                  </Button>
                ) : (
                  <p className="rounded-lg bg-surface-muted px-3 py-2 text-xs text-content-muted">
                    This section is part of the template&apos;s structure and cannot be removed.
                  </p>
                )}
              </>
            ) : (
              <div className="py-8 text-center">
                <p className="text-sm font-medium text-content">Pick a section</p>
                <p className="mt-1 text-xs text-content-muted">
                  Choose a section on the left to change its wording or hide it.
                </p>
              </div>
            )}

            <p className="flex items-start gap-2 border-t border-line pt-3 text-[11px] leading-relaxed text-content-muted">
              <ShieldCheck
                className="mt-0.5 h-3 w-3 shrink-0 text-success-600"
                aria-hidden="true"
              />
              Hiding a section hides a block on your home page. The products in it stay in your
              catalogue and are still findable, searchable and buyable.
            </p>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

/** Sorted so two equivalent customisations compare equal. */
function normalise(customization: TemplateCustomization): TemplateCustomization {
  return {
    hiddenSections: [...(customization.hiddenSections ?? [])].sort(),
    shownSections: [...(customization.shownSections ?? [])].sort(),
    sectionOrder: customization.sectionOrder ?? [],
    sectionText: customization.sectionText ?? {},
  };
}

const SECTION_LABEL: Record<string, string> = {
  hero: 'Hero banner',
  trustStrip: 'Delivery & payment strip',
  categories: 'Categories',
  productRow: 'Product row',
  collectionBanner: 'Promotional banner',
  brands: 'Brands',
  editorial: 'Your story',
  offers: 'Offers & coupons',
  testimonials: 'Customer quotes',
  newsletter: 'Email sign-up',
};

const SECTION_HELP: Record<string, string> = {
  hero: 'The big opening banner. Its image and wording come from your store banner in Store settings.',
  trustStrip: 'Delivery, payment and authenticity reassurance, written from your store settings.',
  categories: 'Your active categories, laid out in this template’s style.',
  productRow: 'A row of your products — featured, best sellers or newest, depending on the row.',
  collectionBanner: 'A promotional panel built from your store banner.',
  brands: 'The brands in your catalogue, linking to their products.',
  editorial: 'A block of your own words, taken from “About your store”.',
  offers: 'Your publicly advertised coupons.',
  testimonials: 'Generic customer quotes. Turn this off if you would rather not show them.',
  newsletter: 'A prompt to email your shop. Uses your contact email address.',
};

/** Kinds whose heading a merchant can reword. */
const HAS_HEADING = new Set([
  'hero',
  'categories',
  'productRow',
  'brands',
  'editorial',
  'offers',
  'testimonials',
  'newsletter',
]);
