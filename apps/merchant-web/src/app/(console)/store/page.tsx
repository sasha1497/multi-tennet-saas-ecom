'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  ExternalLink,
  LayoutTemplate,
  Palette,
  Settings2,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { getTemplate } from '@retailos/templates';
import { Badge, Button, Card, CardBody, Skeleton, cn } from '@retailos/ui';
import { PageHead } from '@/components/console/primitives';
import { DevicePreview, type Device } from '@/components/store-design/device-preview';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';

/**
 * Store Design — the merchant's front door to their storefront's appearance.
 *
 * Answers three questions in the order a shop owner asks them: what does my
 * store look like right now, can I see it, and how do I change it. The live
 * preview is the page's centre of gravity because "what does my shop look
 * like" is a visual question and deserves a visual answer.
 */
export default function StoreDesignPage() {
  const { activeTenant } = useAuth();
  const [device, setDevice] = useState<Device>('desktop');

  const { data: catalogue, isLoading } = useQuery({
    queryKey: ['store-templates'],
    queryFn: () => api().merchant.storeTemplates(),
  });

  const { data: tenant } = useQuery({
    queryKey: ['current-tenant'],
    queryFn: () => api().merchant.currentTenant(),
  });

  const active = catalogue ? getTemplate(catalogue.active.templateId, catalogue.active.templateVersion) : null;
  const storefrontUrl = activeTenant?.storefrontUrl ?? tenant?.tenant.storefrontUrl ?? '';
  const isLive = tenant?.tenant.status === 'ACTIVE';

  if (isLoading || !catalogue) {
    return (
      <div className="mx-auto max-w-6xl space-y-4">
        <Skeleton className="h-9 w-52" />
        <Skeleton className="h-40 rounded-xl" />
        <Skeleton className="h-96 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHead
        title="Store design"
        description="How your storefront looks to customers. Your products, orders and customers are never affected by anything on this page."
        actions={
          storefrontUrl && (
            <a
              href={storefrontUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-2 text-sm font-medium text-content transition hover:bg-surface-muted"
            >
              <ExternalLink className="h-4 w-4" />
              Visit my store
            </a>
          )
        }
      />

      {/* ── Current design ─────────────────────────────────────────────── */}
      <Card className="mb-5">
        <CardBody className="flex flex-col gap-5 sm:flex-row sm:items-center">
          <span
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl text-white"
            style={{
              background: active
                ? `linear-gradient(135deg, ${active.theme.primaryColor}, ${active.theme.accentColor})`
                : undefined,
            }}
            aria-hidden="true"
          >
            <Palette className="h-6 w-6" />
          </span>

          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-content-subtle">
              Current design
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-content">
                {active?.name ?? catalogue.active.templateId}
              </h2>
              <Badge tone={isLive ? 'success' : 'warning'} dot>
                {isLive ? 'Live' : (tenant?.tenant.status.toLowerCase() ?? 'not live')}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-content-muted">
              {active?.tagline}
              {tenant?.tenant.businessCategory && (
                <span className="text-content-subtle"> · {tenant.tenant.businessCategory}</span>
              )}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap gap-2">
            <Link href="/store/customize">
              <Button variant="outline" leftIcon={<Settings2 className="h-4 w-4" />}>
                Customise
              </Button>
            </Link>
            <Link href="/store/templates">
              <Button leftIcon={<LayoutTemplate className="h-4 w-4" />}>Change template</Button>
            </Link>
          </div>
        </CardBody>
      </Card>

      {/* ── The store itself ───────────────────────────────────────────── */}
      {storefrontUrl ? (
        <Card>
          <CardBody>
            <DevicePreview
              storefrontUrl={storefrontUrl}
              device={device}
              onDeviceChange={setDevice}
              height={640}
            />
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardBody className="py-10 text-center text-sm text-content-muted">
            Your storefront address will appear here once your store finishes setting up.
          </CardBody>
        </Card>
      )}

      {/* ── Where to go next ───────────────────────────────────────────── */}
      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <NextStep
          href="/store/templates"
          icon={<LayoutTemplate className="h-4 w-4" />}
          title="Browse templates"
          description="Try another design on your own products before you commit to it."
        />
        <NextStep
          href="/store/customize"
          icon={<Sparkles className="h-4 w-4" />}
          title="Customise sections"
          description="Show, hide, reorder and retitle the blocks on your home page."
        />
        <NextStep
          href="/store/settings"
          icon={<Settings2 className="h-4 w-4" />}
          title="Store settings"
          description="Branding, delivery charges, tax, payment methods and contact details."
        />
      </div>

      <p className="mt-5 flex items-start gap-2 rounded-lg border border-line bg-surface-muted px-4 py-3 text-xs text-content-muted">
        <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600" aria-hidden="true" />
        Changing your template changes your storefront&apos;s appearance only. Your products,
        orders, customers, payments and stock are stored separately and are never modified.
      </p>
    </div>
  );
}

function NextStep({
  href,
  icon,
  title,
  description,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      href={href}
      className={cn(
        'group rounded-xl border border-line bg-surface-raised p-4 transition',
        'hover:border-primary/40 hover:shadow-sm',
      )}
    >
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-soft text-primary">
        {icon}
      </span>
      <p className="mt-2.5 text-sm font-semibold text-content group-hover:text-primary">{title}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-content-muted">{description}</p>
    </Link>
  );
}
