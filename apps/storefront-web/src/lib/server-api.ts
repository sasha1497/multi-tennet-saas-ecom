import { cache } from 'react';
import { headers } from 'next/headers';
import { RetailOSClient } from '@retailos/api-client';
import type { StorefrontBootstrap } from '@retailos/types';

/**
 * Server-side API access.
 *
 * The critical detail: the browser's original hostname is forwarded to the API
 * as `X-Forwarded-Host`, so a server render of `kickzone.ourdomain.in` resolves
 * to KickZone's catalog through exactly the same lookup a browser request uses.
 *
 * It has to be `X-Forwarded-Host` rather than `Host`: `Host` is a forbidden
 * header name for `fetch`, so Node silently drops it and every request would
 * resolve to the internal `api:4000` hostname — i.e. to no tenant at all.
 * nginx sets the same header in front of the API, so both paths agree.
 *
 * Reading the *incoming* hostname prefers `x-forwarded-host` over `host` for the
 * same reason the API does: a CDN or load balancer that rewrites `Host` to the
 * origin's name would otherwise collapse every tenant into "unknown". Whichever
 * one survives, it is only ever used to pick which public storefront to render —
 * it grants nothing on its own.
 */
function incomingHost(): string {
  const incoming = headers();
  return (
    incoming.get('x-forwarded-host')?.split(',')[0]?.trim() ||
    incoming.get('host') ||
    ''
  );
}

/** How long a server-side read may be served from Next's data cache. */
export interface CachePolicy {
  /**
   * Seconds to cache for, or `false` for "never cache this".
   *
   * Defaults to 60 — catalogue content, where a burst of visitors should not
   * become a burst of API calls and a price change appearing within a minute
   * is fine.
   */
  revalidate?: number | false;
}

export function serverApi({ revalidate = 60 }: CachePolicy = {}): RetailOSClient {
  const host = incomingHost();

  const baseUrl =
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

  return new RetailOSClient({
    baseUrl,
    // This is what makes server-rendered pages tenant-correct. It is also what
    // keeps the data cache tenant-correct: Next hashes the request headers into
    // the cache key, so two tenants can never share a cached response.
    defaultHeaders: host ? { 'X-Forwarded-Host': host } : {},
    autoRefresh: false,
    fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => {
      const policy =
        revalidate === false ? { cache: 'no-store' as const } : { next: { revalidate } };
      return fetch(input, { ...init, ...policy } as RequestInit);
    }) as typeof fetch,
  });
}

/**
 * Loads the tenant's storefront configuration for a server render.
 * Returns null when the host does not map to a store, so the caller can render
 * a proper "no store here" page instead of crashing.
 *
 * ── Why this one read is never cached ──────────────────────────────────────
 * The bootstrap carries the store's *presentation* config — `templateId`,
 * `templateVersion` and the merchant's section customisation. Serving it from a
 * 60-second data cache meant a merchant who switched design watched their old
 * storefront for up to a minute and reasonably concluded that switching was
 * broken, or that two templates looked identical. Worse, it was not one stale
 * request but every concurrent one in the window.
 *
 * The catalogue reads in `templates/data.ts` still cache normally; it is only
 * the answer to "which design is this shop in right now" that must be current.
 * `cache()` keeps the cost of that at exactly one API call per render, shared by
 * `generateMetadata`, the layout and the page — previously they were deduped by
 * the data cache, and dropping it without this would have tripled the requests.
 */
export const loadStorefront = cache(async (): Promise<StorefrontBootstrap | null> => {
  try {
    return await serverApi({ revalidate: false }).storefront.bootstrap();
  } catch {
    return null;
  }
});

/** Current host, used for canonical URLs and metadata. */
export function currentHost(): string {
  return incomingHost() || 'localhost';
}
