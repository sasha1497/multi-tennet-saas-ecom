import { cookies, headers } from 'next/headers';
import { resolveTemplate, templateExists, type ResolvedTemplate } from '@retailos/templates';
import type { StorefrontBootstrap } from '@retailos/types';
import { PREVIEW_COOKIE, PREVIEW_HEADER } from '@/middleware';

/**
 * Which template this render uses, and whether it is a preview.
 *
 * The store's stored template is the answer unless a preview is in flight —
 * see `middleware.ts` for how that is established and why it cannot reach
 * anything but presentation.
 */
export interface ActiveTemplate extends ResolvedTemplate {
  /** True when the design on screen is not the one the store has saved. */
  isPreview: boolean;
}

/** The preview template for this request, or null when there is none. */
export function previewTemplateId(): string | null {
  // The header is set by middleware on the request that carried `?__template`,
  // so the very first previewed render is already correct. The cookie carries
  // it through the navigation that follows.
  const fromHeader = headers().get(PREVIEW_HEADER);
  if (fromHeader) return fromHeader === 'off' ? null : fromHeader;

  const fromCookie = cookies().get(PREVIEW_COOKIE)?.value ?? null;
  return fromCookie && templateExists(fromCookie) ? fromCookie : null;
}

/**
 * Resolves the design for a server render.
 *
 * Read-only in every branch: nothing here writes, and the preview override is
 * passed to the resolver rather than merged into the store's config, so the
 * stored value is not even mutated in memory.
 */
export function activeTemplate(bootstrap: StorefrontBootstrap): ActiveTemplate {
  const preview = previewTemplateId();
  const resolved = resolveTemplate(bootstrap.store.template, {
    overrideTemplateId: preview,
  });

  return {
    ...resolved,
    isPreview: preview !== null && preview !== bootstrap.store.template.templateId,
  };
}
