'use client';

import { RetailOSClient, type TokenPair, type TokenStore } from '@retailos/api-client';

const ACCESS_KEY = 'retailos.admin.access';
const REFRESH_KEY = 'retailos.admin.refresh';
const TENANT_KEY = 'retailos.admin.tenant';

/**
 * Token storage for the merchant console.
 *
 * Tokens live in `localStorage`. The honest trade-off (documented in
 * docs/SECURITY.md): this is readable by any script that achieves XSS on this
 * origin. It is mitigated, not eliminated, by a 15-minute access-token lifetime
 * and refresh-token rotation with reuse detection — a stolen refresh token buys
 * one use before the family is revoked and the real user is forced to sign in
 * again, which is also the signal that something went wrong.
 *
 * The hardening path is httpOnly cookies issued by a Next route handler
 * proxying the API; it is deliberately out of MVP scope and recorded as such.
 *
 * Every read is wrapped in try/catch: Safari private mode throws on
 * `localStorage` access rather than returning null.
 */
class BrowserTokenStore implements TokenStore {
  get(): TokenPair | null {
    try {
      const accessToken = localStorage.getItem(ACCESS_KEY);
      const refreshToken = localStorage.getItem(REFRESH_KEY);
      if (!accessToken || !refreshToken) return null;
      return { accessToken, refreshToken };
    } catch {
      return null;
    }
  }

  set(tokens: TokenPair): void {
    try {
      localStorage.setItem(ACCESS_KEY, tokens.accessToken);
      localStorage.setItem(REFRESH_KEY, tokens.refreshToken);
    } catch {
      // Storage unavailable: the session simply will not survive a reload.
    }
  }

  clear(): void {
    try {
      localStorage.removeItem(ACCESS_KEY);
      localStorage.removeItem(REFRESH_KEY);
    } catch {
      /* ignore */
    }
  }
}

export const tokenStore = new BrowserTokenStore();

export function getActiveTenantId(): string | null {
  try {
    return localStorage.getItem(TENANT_KEY);
  } catch {
    return null;
  }
}

export function setActiveTenantId(tenantId: string | null): void {
  try {
    if (tenantId) localStorage.setItem(TENANT_KEY, tenantId);
    else localStorage.removeItem(TENANT_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Resolves the API base URL.
 *
 * In the browser this is ALWAYS same-origin. Behind nginx the API genuinely is
 * same-origin; under `next dev` it is made so by the rewrite in
 * next.config.mjs, which proxies /api/v1 to the API's port.
 *
 * The console therefore never makes a cross-origin request. That removes CORS
 * preflights, and — the reason this matters — removes any dependence on the
 * browser being able to open a second port. A firewall, proxy or security tool
 * that blocks :4000 for browsers while curl sails through is otherwise almost
 * impossible to tell apart from a broken API.
 *
 * Server-side rendering has no origin to borrow, so it still needs an absolute
 * URL.
 */
function resolveBaseUrl(): string {
  if (typeof window === 'undefined') {
    return (
      process.env.INTERNAL_API_URL ??
      process.env.NEXT_PUBLIC_API_URL ??
      'http://127.0.0.1:4000/api/v1'
    );
  }
  return `${window.location.origin}/api/v1`;
}

let client: RetailOSClient | null = null;

/**
 * The shared API client.
 *
 * Single instance so the single-flight refresh in `HttpClient` actually
 * de-duplicates — a fresh client per call would mean ten parallel refreshes on
 * a page that fires ten queries at once.
 */
export function api(): RetailOSClient {
  if (client) return client;

  client = new RetailOSClient({
    baseUrl: resolveBaseUrl(),
    tokenStore,
    // The tenant hint the API re-verifies against the caller's membership.
    getTenantHint: () => getActiveTenantId(),
    onAuthFailure: () => {
      tokenStore.clear();
      setActiveTenantId(null);
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      }
    },
  });

  return client;
}
