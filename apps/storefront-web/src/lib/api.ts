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
export function api(): RetailOSClient {
  if (client) return client;

  const baseUrl =
    typeof window !== 'undefined' && (window.location.port === '' || window.location.port === '80')
      ? `${window.location.origin}/api/v1`
      : (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1');

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
