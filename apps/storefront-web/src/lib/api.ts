'use client';

import { RetailOSClient, type TokenPair, type TokenStore } from '@retailos/api-client';

const ACCESS_KEY = 'retailos.shop.access';
const REFRESH_KEY = 'retailos.shop.refresh';
const GUEST_KEY = 'retailos.shop.guest';

/**
 * Shopper token storage.
 *
 * Keys are namespaced per host by the browser's own origin isolation: a token
 * issued by `kickzone.ourdomain.in` is stored under that origin's localStorage
 * and is simply not visible to `abcstore.ourdomain.in`. Combined with the API
 * rejecting a customer token whose `tid` does not match the resolved tenant,
 * that gives two independent layers of separation.
 */
class ShopTokenStore implements TokenStore {
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
      /* private mode */
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

export const tokenStore = new ShopTokenStore();

export function getGuestToken(): string | null {
  try {
    return localStorage.getItem(GUEST_KEY);
  } catch {
    return null;
  }
}

export function setGuestToken(token: string): void {
  try {
    localStorage.setItem(GUEST_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearGuestToken(): void {
  try {
    localStorage.removeItem(GUEST_KEY);
  } catch {
    /* ignore */
  }
}

let client: RetailOSClient | null = null;

/**
 * The browser-side API client.
 *
 * Same-origin `/api/v1` whenever the storefront is served through nginx on the
 * tenant's own hostname — which means the tenant travels in the Host header the
 * browser sets itself, and there is no CORS preflight on the shopping path.
 */
/**
 * Same-origin behind nginx; the API's own port under `next dev`.
 *
 * NEXT_PUBLIC_API_URL is usually the nginx address (port 80), which is right
 * for the Docker stack and wrong for a dev server — nginx is not running there,
 * so honouring it produces an unexplained "Network request failed" on every
 * call. A configured URL on port 80 therefore cannot apply to a dev server.
 * Deriving from window.location.hostname (rather than a literal `localhost`)
 * also keeps the tenant hostname intact, which is what the API resolves on.
 */
function resolveBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;

  if (typeof window === 'undefined') return configured ?? 'http://localhost:4000/api/v1';

  if (window.location.port === '' || window.location.port === '80') {
    return `${window.location.origin}/api/v1`;
  }

  if (configured) {
    try {
      const port = new URL(configured).port;
      if (port !== '' && port !== '80') return configured;
    } catch {
      // A relative or malformed value: fall through to the derived URL.
    }
  }

  return `${window.location.protocol}//${window.location.hostname}:4000/api/v1`;
}

export function api(): RetailOSClient {
  if (client) return client;

  const baseUrl = resolveBaseUrl();

  client = new RetailOSClient({
    baseUrl,
    tokenStore,
    getGuestToken,
    // The API mints a signed guest token on the first anonymous cart write.
    onGuestToken: setGuestToken,
    onAuthFailure: () => {
      tokenStore.clear();
    },
  });

  return client;
}
