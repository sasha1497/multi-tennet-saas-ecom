import { defaultStoreTheme } from '@retailos/config';
import type { TemplateTheme } from '@retailos/templates';
import type { StoreSettings, StoreTheme } from '@retailos/types';

/**
 * Turning a template plus a merchant's branding into CSS custom properties.
 *
 * The storefront's entire design system already reads from custom properties
 * (`--color-primary`, `--color-text`, `--radius`, …), so a template change is a
 * change of *values*, not of components. That is what makes switching designs
 * cost one server render rather than a rebuild.
 *
 * ── Who wins ──────────────────────────────────────────────────────────────
 * The template supplies the whole palette; the merchant's stored branding
 * overrides it, but only where they actually set something. A merchant who
 * never opened the colour picker still has `defaultStoreTheme` on their
 * settings row — honouring that would repaint all six templates the same blue
 * and erase the design language they just chose. So a branding value counts as
 * an override only when it differs from the platform default.
 */

/** `#1f47e0` -> `31 71 224`, the space-separated form Tailwind's alpha syntax needs. */
export function toRgbChannels(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return '31 71 224';
  return `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
}

function parseHex(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '').trim();
  const full =
    clean.length === 3
      ? clean
          .split('')
          .map((c) => c + c)
          .join('')
      : clean;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return null;
  const value = Number.parseInt(full, 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Linear blend between two colours. `amount` is how much of `b` to take. */
function mix(a: string, b: string, amount: number): string {
  const from = parseHex(a);
  const to = parseHex(b);
  if (!from || !to) return a;
  const channel = (i: number) => Math.round(from[i] + (to[i] - from[i]) * amount);
  return `${channel(0)} ${channel(1)} ${channel(2)}`;
}

/**
 * Relative luminance, used to decide whether text on a brand colour should be
 * white or near-black. Cheap WCAG-style check rather than a full contrast
 * calculation — it only ever picks between two known-safe inks.
 */
function readableInk(hex: string): string {
  const rgb = parseHex(hex);
  if (!rgb) return '255 255 255';
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? '17 17 17' : '255 255 255';
}

const RADIUS_SCALE: Record<TemplateTheme['radius'], string> = {
  none: '0px',
  sm: '6px',
  md: '10px',
  lg: '18px',
  full: '9999px',
};

/** Vertical rhythm between home-page sections, per template density. */
const SECTION_SPACE: Record<TemplateTheme['density'], string> = {
  compact: '2rem',
  regular: '3rem',
  airy: '4.5rem',
};

/**
 * Branding the merchant explicitly changed.
 *
 * Anything still equal to the platform default is treated as "not set" and
 * left to the template — see the note at the top of this file.
 */
function explicitBranding(theme: StoreTheme | undefined): Partial<StoreTheme> {
  if (!theme) return {};
  const out: Partial<StoreTheme> = {};
  if (theme.primaryColor && theme.primaryColor !== defaultStoreTheme.primaryColor) {
    out.primaryColor = theme.primaryColor;
  }
  if (theme.accentColor && theme.accentColor !== defaultStoreTheme.accentColor) {
    out.accentColor = theme.accentColor;
  }
  if (theme.radius && theme.radius !== defaultStoreTheme.radius) {
    out.radius = theme.radius;
  }
  return out;
}

/**
 * The complete set of custom properties for one storefront render.
 *
 * Applied to `<html>` in the root layout, so the very first painted byte is
 * already in the store's design — no flash of a generic theme.
 */
export function templateCssVariables(
  templateTheme: TemplateTheme,
  store: Pick<StoreSettings, 'theme'>,
): Record<string, string> {
  const brand = explicitBranding(store.theme);

  const primary = brand.primaryColor ?? templateTheme.primaryColor;
  const accent = brand.accentColor ?? templateTheme.accentColor;
  const radius = brand.radius ?? templateTheme.radius;

  const ground = templateTheme.surfaceColor;
  const ink = templateTheme.contentColor;

  return {
    '--color-primary': toRgbChannels(primary),
    '--color-primary-fg': readableInk(primary),
    '--color-primary-soft': mix(primary, '#ffffff', 0.9),
    '--color-accent': toRgbChannels(accent),
    '--color-accent-fg': readableInk(accent),

    // Cards sit on white; the page ground carries the template's tint.
    '--color-surface': toRgbChannels('#ffffff'),
    '--color-surface-muted': toRgbChannels(ground),
    '--color-surface-raised': toRgbChannels('#ffffff'),
    '--color-border': mix(ground, ink, 0.14),
    '--color-text': toRgbChannels(ink),
    '--color-text-muted': mix(ink, ground, 0.42),
    '--color-text-subtle': mix(ink, ground, 0.6),

    '--radius': RADIUS_SCALE[radius] ?? '10px',

    // Type and rhythm. Read by the `font-display`/`heading` utilities in
    // globals.css so a template's voice reaches every heading on every page.
    '--tpl-heading-font': templateTheme.headingFont,
    '--tpl-body-font': templateTheme.bodyFont,
    '--tpl-heading-weight': String(templateTheme.headingWeight),
    '--tpl-heading-tracking': templateTheme.headingTracking,
    '--tpl-heading-transform': templateTheme.headingTransform,
    '--tpl-section-space': SECTION_SPACE[templateTheme.density],
  };
}
