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
 * Prefers a same-origin `/api/v1` when the console is served through nginx —
 * that avoids a CORS preflight on every request and keeps the deployment simple.
 * Falls back to the configured absolute URL for `next dev` on port 3001.
 */
function resolveBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (typeof window === 'undefined') {
    return process.env.INTERNAL_API_URL ?? configured ?? 'http://localhost:4000/api/v1';
  }
  // Served behind nginx on admin.<domain>: the API is same-origin.
  if (window.location.port === '' || window.location.port === '80') {
    return `${window.location.origin}/api/v1`;
  }
  return configured ?? 'http://localhost:4000/api/v1';
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
