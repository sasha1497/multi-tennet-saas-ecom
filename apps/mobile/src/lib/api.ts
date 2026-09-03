import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { RetailOSClient, type TokenPair, type TokenStore } from '@retailos/api-client';

const ACCESS_KEY = 'retailos_access';
const REFRESH_KEY = 'retailos_refresh';
const TENANT_KEY = 'retailos.tenant';
const GUEST_KEY = 'retailos.guest';

/**
 * Token storage backed by the device keychain / keystore.
 *
 * This is the one place the mobile app is meaningfully *more* secure than the
 * web clients: `expo-secure-store` puts tokens in the iOS Keychain or Android
 * EncryptedSharedPreferences rather than in JavaScript-readable storage.
 *
 * Non-secret preferences (which store you are shopping, the guest cart token)
 * live in AsyncStorage — the keychain is small and slow, and neither of those
 * is a credential.
 */
class SecureTokenStore implements TokenStore {
  private cached: TokenPair | null = null;

  async get(): Promise<TokenPair | null> {
    if (this.cached) return this.cached;
    try {
      const [accessToken, refreshToken] = await Promise.all([
        SecureStore.getItemAsync(ACCESS_KEY),
        SecureStore.getItemAsync(REFRESH_KEY),
      ]);
      if (!accessToken || !refreshToken) return null;
      this.cached = { accessToken, refreshToken };
      return this.cached;
    } catch {
      return null;
    }
  }

  async set(tokens: TokenPair): Promise<void> {
    this.cached = tokens;
    try {
      await Promise.all([
        SecureStore.setItemAsync(ACCESS_KEY, tokens.accessToken),
        SecureStore.setItemAsync(REFRESH_KEY, tokens.refreshToken),
      ]);
    } catch {
      // Keychain unavailable (rare): the session lives for this launch only.
    }
  }

  async clear(): Promise<void> {
    this.cached = null;
    try {
      await Promise.all([
        SecureStore.deleteItemAsync(ACCESS_KEY),
        SecureStore.deleteItemAsync(REFRESH_KEY),
      ]);
    } catch {
      /* ignore */
    }
  }
}

export const tokenStore = new SecureTokenStore();

// ------------------------------------------------------------ tenant state --

let activeTenantSlug: string | null = null;
let guestToken: string | null = null;

export async function loadPersistedTenant(): Promise<string | null> {
  try {
    activeTenantSlug = await AsyncStorage.getItem(TENANT_KEY);
    guestToken = await AsyncStorage.getItem(GUEST_KEY);
    return activeTenantSlug;
  } catch {
    return null;
  }
}

export async function setActiveTenantSlug(slug: string | null): Promise<void> {
  activeTenantSlug = slug;
  try {
    if (slug) await AsyncStorage.setItem(TENANT_KEY, slug);
    else await AsyncStorage.removeItem(TENANT_KEY);
  } catch {
    /* ignore */
  }
}

export function getActiveTenantSlug(): string | null {
  return activeTenantSlug;
}

/**
 * Resolves the API base URL.
 *
 * In production every store has a real hostname, so the app talks to
 * `https://<slug>.ourdomain.in/api/v1` and the tenant travels in the Host
 * header exactly as it does for the web storefront.
 *
 * In development the app runs on a device that cannot resolve `*.localhost`, so
 * it uses the LAN address of the machine running Expo and identifies the tenant
 * with `X-Tenant-Slug` instead. Both paths end in the same server-side lookup.
 */
function resolveBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_URL;
  if (explicit) return explicit;

  const platformDomain = process.env.EXPO_PUBLIC_PLATFORM_DOMAIN;
  if (platformDomain && platformDomain !== 'localhost' && activeTenantSlug) {
    return `https://${activeTenantSlug}.${platformDomain}/api/v1`;
  }

  // Expo puts the dev server's LAN address here, which is exactly the host the
  // API is reachable on from a physical device.
  const hostUri =
    Constants.expoConfig?.hostUri ?? Constants.expoGoConfig?.debuggerHost ?? undefined;
  const lanHost = hostUri?.split(':')[0];

  if (lanHost) return `http://${lanHost}:4000/api/v1`;
  // Android emulators reach the host machine on 10.0.2.2, iOS simulators on localhost.
  return Platform.OS === 'android'
    ? 'http://10.0.2.2:4000/api/v1'
    : 'http://localhost:4000/api/v1';
}

let client: RetailOSClient | null = null;

export function api(): RetailOSClient {
  if (client) return client;

  client = new RetailOSClient({
    baseUrl: resolveBaseUrl(),
    tokenStore,
    // Only sent when there is no tenant hostname (development).
    getTenantSlug: () => (process.env.EXPO_PUBLIC_API_URL ? activeTenantSlug : activeTenantSlug),
    getGuestToken: () => guestToken,
    onGuestToken: (token) => {
      guestToken = token;
      void AsyncStorage.setItem(GUEST_KEY, token).catch(() => undefined);
    },
    onAuthFailure: async () => {
      await tokenStore.clear();
    },
  });

  return client;
}

/** Forces a new client — used after switching stores so the base URL is rebuilt. */
export function resetApiClient(): void {
  client = null;
}
