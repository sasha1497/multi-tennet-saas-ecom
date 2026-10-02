'use client';

import { Box, Check, Eye, Gem, Lock, Sparkles } from 'lucide-react';
import type { TemplateDefinition } from '@retailos/templates';
import type { TemplateAccess } from '@retailos/types';
import { Badge, Button, cn } from '@retailos/ui';
import { ButtonLink } from '@/components/console/primitives';

/** How each family is named and explained, in one place. */
export const FAMILY_COPY: Record<
  TemplateDefinition['tier'],
  { label: string; tone: 'neutral' | 'primary' | 'info'; note: string | null }
> = {
  standard: { label: 'Standard', tone: 'neutral', note: null },
  premium: {
    label: 'Premium',
    tone: 'primary',
    note: 'Animated sections, scroll transitions and a cinematic opening. Motion switches itself off for visitors who ask for less of it.',
  },
  '3d': {
    label: '3D',
    tone: 'info',
    note: 'An interactive 3D opening and a product turntable built from your own photos. Phones and older devices get a polished 2D version automatically.',
  },
};

/** Where an upgrade prompt sends the merchant — the plan picker, with the plan pre-selected. */
export function upgradeHref(planCode: string | undefined): string {
  return planCode ? `/subscription?plan=${encodeURIComponent(planCode)}` : '/subscription';
}

const planLabel = (code: string | undefined) =>
  code ? code.charAt(0) + code.slice(1).toLowerCase() : 'a higher plan';

/**
 * One design in the gallery.
 *
 * The artwork is generated from the template's own theme — its colours, its
 * type, its grid — rather than a screenshot file. A screenshot would show
 * somebody else's products; this shows the shape of the design, and the real
 * preview one click away shows it full of the merchant's own catalogue.
 *
 * `access` comes from the API. When it says the family is not in the plan the
 * card stays fully previewable and its primary action becomes an upgrade.
 */
export function TemplateCard({
  template,
  access,
  active,
  recommended,
  onPreview,
  onUse,
  busy,
}: {
  template: TemplateDefinition;
  access?: TemplateAccess;
  active: boolean;
  recommended: boolean;
  onPreview: () => void;
  onUse: () => void;
  busy?: boolean;
}) {
  const locked = access?.allowed === false;
  const family = FAMILY_COPY[template.tier];

  return (
    <article
      className={cn(
        'group flex min-w-0 flex-col overflow-hidden rounded-xl border bg-surface-raised transition',
        active ? 'border-primary ring-1 ring-primary' : 'border-line hover:shadow-md',
      )}
    >
      <button
        type="button"
        onClick={onPreview}
        className="relative block w-full text-left"
        aria-label={`Preview ${template.name}`}
      >
        <TemplateThumbnail template={template} />

        <span className="absolute inset-0 flex items-center justify-center bg-neutral-950/45 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 text-sm font-semibold text-neutral-900">
            <Eye className="h-4 w-4" />
            Preview with my products
          </span>
        </span>

        {active && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-fg">
            <Check className="h-3 w-3" />
            Current design
          </span>
        )}
        {!active && recommended && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-900">
            <Sparkles className="h-3 w-3" />
            Recommended
          </span>
        )}

        {/* Family sits opposite the recommendation so the two never collide,
            and reads as a property of the design rather than a sales badge. */}
        {template.tier !== 'standard' && (
          <span className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-neutral-900/85 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
            {template.tier === '3d' ? <Box className="h-3 w-3" /> : <Gem className="h-3 w-3" />}
            {family.label}
          </span>
        )}
        {locked && (
          <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-white/95 px-2.5 py-1 text-[11px] font-semibold text-neutral-900 shadow-sm">
            <Lock className="h-3 w-3" />
            {planLabel(access?.requiredPlan)} required
          </span>
        )}
      </button>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 truncate text-[15px] font-semibold text-content">{template.name}</h3>
          <span className="flex shrink-0 items-center gap-1" aria-hidden="true">
            {template.swatches.map((colour) => (
              <span
                key={colour}
                className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10"
                style={{ backgroundColor: colour }}
              />
            ))}
          </span>
        </div>

        <p className="mt-1 text-sm text-content-muted">{template.tagline}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge tone={family.tone}>{family.label}</Badge>
          <Badge tone="neutral">{template.group}</Badge>
          {/* The family is already a badge; repeating it reads as two claims. */}
          {template.badges
            ?.filter((badge) => badge !== 'Premium' && badge !== '3D')
            .map((badge) => (
              <Badge key={badge} tone={badge === 'New' ? 'success' : 'info'}>
                {badge}
              </Badge>
            ))}
        </div>

        {family.note && (
          <p className="mt-2.5 text-xs leading-relaxed text-content-subtle">{family.note}</p>
        )}

        <div className="mt-auto flex gap-2 pt-4">
          <Button variant="outline" size="sm" onClick={onPreview} className="flex-1">
            Preview
          </Button>
          {active ? (
            <Button size="sm" disabled className="flex-1">
              In use
            </Button>
          ) : locked ? (
            <ButtonLink
              href={upgradeHref(access?.requiredPlan)}
              size="sm"
              className="flex-1"
              leftIcon={<Lock className="h-3.5 w-3.5" />}
            >
              {/* The badge above already names the plan; keep the button to one line. */}
              Upgrade
            </ButtonLink>
          ) : (
            <Button size="sm" onClick={onUse} loading={busy} className="flex-1">
              Use this template
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * A miniature of the template's layout, drawn from its own theme tokens.
 *
 * Deliberately abstract: enough structure to tell an editorial fashion design
 * from a dense electronics one at a glance, with no fake product photography
 * that would misrepresent what the merchant's own store will look like.
 */
function TemplateThumbnail({ template }: { template: TemplateDefinition }) {
  const { theme, layout } = template;
  const columns = layout.gridColumns.lg;
  const radius =
    layout.productCard === 'soft'
      ? 8
      : layout.productCard === 'editorial' || layout.productCard === 'overlay'
        ? 0
        : 4;

  // A miniature that showed the same hero for every template would undo the
  // point of the gallery, so the three arrangements that actually differ are
  // drawn differently: minimal chrome over white, a dark cinematic block, or
  // the ordinary gradient panel.
  const minimalChrome = layout.header === 'minimal';
  const cinematic = layout.header === 'floating' || layout.header === 'editorial';

  return (
    <div
      className="relative aspect-[4/3] w-full overflow-hidden"
      style={{ backgroundColor: theme.surfaceColor }}
      aria-hidden="true"
    >
      {/* Header bar */}
      <div
        className="flex h-[13%] items-center gap-1.5 px-3"
        style={{ borderBottom: `1px solid ${theme.contentColor}1a` }}
      >
        <span
          className="h-2.5 w-2.5"
          style={{
            backgroundColor: theme.primaryColor,
            borderRadius: layout.header === 'editorial' ? 0 : 999,
          }}
        />
        <span
          className="h-1.5 w-10"
          style={{ backgroundColor: theme.contentColor, opacity: 0.75, borderRadius: 2 }}
        />
        <span className="ml-auto flex gap-1">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: theme.contentColor, opacity: 0.3 }}
            />
          ))}
        </span>
      </div>

      {/* Hero */}
      {template.tier === '3d' ? (
        <OrbitMotif template={template} />
      ) : (
      <div
        className={
          minimalChrome
            ? 'relative flex h-[38%] flex-col items-center justify-center p-3'
            : 'relative flex h-[38%] flex-col justify-end p-3'
        }
        style={{
          background: minimalChrome
            ? theme.surfaceColor
            : cinematic
              ? theme.contentColor
              : `linear-gradient(135deg, ${theme.primaryColor}, ${theme.accentColor})`,
        }}
      >
        <span
          className={minimalChrome ? 'h-2 w-[55%]' : 'h-2 w-[45%]'}
          style={{
            backgroundColor: minimalChrome ? theme.contentColor : '#ffffff',
            opacity: 0.95,
            borderRadius: 2,
          }}
        />
        <span
          className={minimalChrome ? 'mt-1.5 h-1.5 w-[35%]' : 'mt-1.5 h-1.5 w-[30%]'}
          style={{
            backgroundColor: minimalChrome ? theme.contentColor : '#ffffff',
            opacity: 0.45,
            borderRadius: 2,
          }}
        />
        <span
          className="mt-2.5 h-3 w-12"
          style={{
            backgroundColor: minimalChrome ? 'transparent' : '#ffffff',
            border: minimalChrome ? `1px solid ${theme.contentColor}` : undefined,
            borderRadius: radius === 8 ? 999 : radius,
          }}
        />
      </div>
      )}

      {/* Product grid, at the template's own column count */}
      <div className="p-3">
        <span
          className="mb-2 block h-1.5 w-14"
          style={{ backgroundColor: theme.contentColor, opacity: 0.7, borderRadius: 2 }}
        />
        <div
          className="grid gap-1.5"
          style={{ gridTemplateColumns: `repeat(${Math.min(columns, 6)}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: Math.min(columns, 6) }).map((_, i) => (
            <span key={i} className="block">
              <span
                className="block w-full"
                style={{
                  aspectRatio: layout.productAspect,
                  backgroundColor: theme.contentColor,
                  opacity: 0.12,
                  borderRadius: radius,
                }}
              />
              <span
                className="mt-1 block h-1 w-3/4"
                style={{ backgroundColor: theme.contentColor, opacity: 0.35, borderRadius: 1 }}
              />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * The 3D family's miniature: product plates on an elliptical orbit around the
 * headline — the composition the storefront's WebGL opening actually draws.
 */
function OrbitMotif({ template }: { template: TemplateDefinition }) {
  const { theme } = template;
  const plates = [0, 1, 2, 3, 4, 5];
  return (
    <div
      className="relative h-[38%] overflow-hidden"
      style={{
        background: `radial-gradient(ellipse at 50% 60%, ${theme.accentColor}55, ${theme.surfaceColor} 70%)`,
      }}
    >
      <span
        className="absolute left-1/2 top-1/2 h-[46%] w-[78%] -translate-x-1/2 -translate-y-1/2 rounded-[50%]"
        style={{ border: `1px solid ${theme.contentColor}33` }}
      />
      {plates.map((i) => {
        const angle = (i / plates.length) * Math.PI * 2;
        const depth = (Math.sin(angle) + 1) / 2; // 0 = back, 1 = front
        return (
          <span
            key={i}
            className="absolute block"
            style={{
              left: `${50 + Math.cos(angle) * 39}%`,
              top: `${50 + Math.sin(angle) * 23}%`,
              width: `${9 + depth * 7}%`,
              aspectRatio: '3 / 4',
              transform: 'translate(-50%, -50%)',
              backgroundColor: i % 2 ? theme.primaryColor : theme.accentColor,
              opacity: 0.35 + depth * 0.65,
              borderRadius: 3,
              zIndex: Math.round(depth * 10),
            }}
          />
        );
      })}
      <span
        className="absolute left-1/2 top-1/2 h-2 w-[30%] -translate-x-1/2 -translate-y-1/2"
        style={{ backgroundColor: theme.contentColor, borderRadius: 2, zIndex: 6 }}
      />
    </div>
  );
}
