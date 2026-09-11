import type { TemplateCustomization } from './types';

/**
 * Carrying an *unsaved* home-page layout to the storefront, for preview only.
 *
 * The store builder stages changes locally and applies them on save, which is
 * right — a half-finished rearrangement must never be live to customers. But it
 * left the merchant rearranging blocks against a preview that could not show
 * them, so the only way to see a layout was to publish it and look.
 *
 * This closes that gap the same way template preview already works: the draft
 * travels in the URL, the storefront renders it for that session, and nothing
 * is written. See `storefront-web/src/middleware.ts`.
 *
 * ── Why this is safe to accept from a URL ──────────────────────────────────
 *   - It is decoded, then *validated field by field* below. Anything that is
 *     not one of the four known keys, in the expected shape, is dropped rather
 *     than trusted.
 *   - It selects which presentation blocks render. It cannot select a store —
 *     the tenant is still resolved from the Host by the API — and it reaches no
 *     product, price, order or customer.
 *   - `resolveTemplate` sanitises whatever survives against the active
 *     template, so a section id the template does not have is a no-op, and a
 *     non-removable section cannot be hidden however the URL is written.
 *   - Nothing is persisted. The stored customisation is not read or written.
 */

/** The query parameter and the header/cookie it is promoted to. */
export const SECTIONS_PARAM = '__sections';

/**
 * Hard ceiling on an encoded draft.
 *
 * Both a sanity bound on URL length and a cheap denial-of-service guard: a
 * megabyte of base64 should be rejected before it is ever parsed, not after.
 */
export const MAX_ENCODED_LENGTH = 4000;

/** Bounds on the decoded value, applied before anything is trusted. */
const MAX_SECTIONS = 64;
const MAX_ID_LENGTH = 64;
const MAX_TEXT_LENGTH = 200;

export function encodePreviewCustomization(customization: TemplateCustomization): string {
  return toBase64Url(JSON.stringify(customization));
}

/**
 * Decodes and validates a draft from a URL.
 *
 * Returns `null` for anything malformed — a caller should treat that as "no
 * draft", never as an error worth surfacing to a shopper.
 */
export function decodePreviewCustomization(raw: string): TemplateCustomization | null {
  if (!raw || raw.length > MAX_ENCODED_LENGTH) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(raw));
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
  const input = parsed as Record<string, unknown>;

  const customization: TemplateCustomization = {
    hiddenSections: idList(input.hiddenSections),
    shownSections: idList(input.shownSections),
    sectionOrder: idList(input.sectionOrder),
    sectionText: textOverrides(input.sectionText),
  };

  return customization;
}

/** A list of section ids, bounded in both length and element size. */
function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= MAX_ID_LENGTH)
    .slice(0, MAX_SECTIONS);
}

function textOverrides(value: unknown): TemplateCustomization['sectionText'] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};

  const out: NonNullable<TemplateCustomization['sectionText']> = {};
  for (const [id, override] of Object.entries(value as Record<string, unknown>).slice(
    0,
    MAX_SECTIONS,
  )) {
    if (id.length === 0 || id.length > MAX_ID_LENGTH) continue;
    if (typeof override !== 'object' || override === null || Array.isArray(override)) continue;

    const { title, subtitle } = override as Record<string, unknown>;
    out[id] = { title: text(title), subtitle: text(subtitle) };
  }
  return out;
}

/** `null` is meaningful here — it means "use the template's own wording". */
function text(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  return value.slice(0, MAX_TEXT_LENGTH);
}

// ------------------------------------------------------------- base64url ----
//
// Hand-rolled rather than reached for from a dependency because this package is
// deliberately dependency-free, and because it has to run unchanged in three
// places: the Edge runtime (middleware), Node (the server render) and the
// browser (the console building the URL). `btoa`/`atob` are the only encoder
// all three have, and they are byte-oriented — hence the TextEncoder round trip
// rather than passing a string straight in, which would throw on any non-Latin-1
// character a merchant typed into a section heading.

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input: string): string {
  if (!/^[A-Za-z0-9_-]*$/.test(input)) throw new Error('Not base64url');
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padding = base64.length % 4 === 0 ? '' : '='.repeat(4 - (base64.length % 4));
  const binary = atob(base64 + padding);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
