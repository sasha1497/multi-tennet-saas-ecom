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

export function serverApi(): RetailOSClient {
  const host = incomingHost();

  const baseUrl =
    process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

  return new RetailOSClient({
    baseUrl,
    // This is what makes server-rendered pages tenant-correct.
    defaultHeaders: host ? { 'X-Forwarded-Host': host } : {},
    autoRefresh: false,
    fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) => {
      // Next dedupes and caches fetches; storefront content is cached briefly so
      // a burst of visitors does not become a burst of API calls, while a price
      // change still appears within a minute.
      return fetch(input, { ...init, next: { revalidate: 60 } } as RequestInit);
    }) as typeof fetch,
  });
}

/**
 * Loads the tenant's storefront configuration for a server render.
 * Returns null when the host does not map to a store, so the caller can render
 * a proper "no store here" page instead of crashing.
 */
export async function loadStorefront(): Promise<StorefrontBootstrap | null> {
  try {
    return await serverApi().storefront.bootstrap();
  } catch {
    return null;
  }
}

/** Current host, used for canonical URLs and metadata. */
export function currentHost(): string {
  return incomingHost() || 'localhost';
}
