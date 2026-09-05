import type { ApiResponse } from '@retailos/types';
import { ApiClientError, NetworkError } from './errors';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Pluggable token storage so the same client works with:
 *   - Next.js  (httpOnly cookies read server-side, memory client-side)
 *   - Expo     (expo-secure-store)
 *   - tests    (plain object)
 */
export interface TokenStore {
  get(): TokenPair | null | Promise<TokenPair | null>;
  set(tokens: TokenPair): void | Promise<void>;
  clear(): void | Promise<void>;
}

export class MemoryTokenStore implements TokenStore {
  private tokens: TokenPair | null = null;
  get(): TokenPair | null {
    return this.tokens;
  }
  set(tokens: TokenPair): void {
    this.tokens = tokens;
  }
  clear(): void {
    this.tokens = null;
  }
}

export interface HttpClientConfig {
  /** e.g. `http://api.localhost/api/v1` */
  baseUrl: string;
  tokenStore?: TokenStore;
  /**
   * Tenant hint for merchant/platform calls. The API still verifies membership
   * server-side — this only tells it *which* of the caller's tenants to act on.
   */
  getTenantHint?: () => string | null | undefined;
  /**
   * Tenant slug hint for clients with no tenant hostname — in practice the
   * mobile app talking to a LAN IP during development. The API resolves it
   * through the same `domains` lookup the Host header uses, so it selects a
   * public storefront and grants nothing on its own.
   */
  getTenantSlug?: () => string | null | undefined;
  /** Storefront guest cart identity. */
  getGuestToken?: () => string | null | undefined;
  onGuestToken?: (token: string) => void;
  /** Called after a refresh attempt fails; apps use it to bounce to /login. */
  onAuthFailure?: () => void | Promise<void>;
  /** Override for SSR / tests. */
  fetchImpl?: typeof fetch;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  /** Set false for the mobile app, which manages tokens explicitly. */
  autoRefresh?: boolean;
}

export interface RequestOptions {
  query?: Record<string, unknown>;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Skip the Authorization header (login, public storefront reads). */
  anonymous?: boolean;
  /** Skip envelope unwrapping — used for the health endpoint. */
  raw?: boolean;
  timeoutMs?: number;
}

const REFRESH_PATH = '/auth/refresh';

/**
 * Thin fetch wrapper that owns: URL building, the response envelope, auth
 * headers, single-flight token refresh and error normalisation.
 *
 * Deliberately dependency-free so React Native's Metro bundler and Next's
 * server runtime can both consume it unchanged.
 */
export class HttpClient {
  private readonly cfg: HttpClientConfig;
  private readonly fetchImpl: typeof fetch;
  /** Shared promise so ten parallel 401s trigger exactly one refresh. */
  private refreshInFlight: Promise<boolean> | null = null;

  constructor(cfg: HttpClientConfig) {
    this.cfg = { autoRefresh: true, timeoutMs: 20_000, ...cfg };
    this.cfg.baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    const impl = cfg.fetchImpl ?? (globalThis.fetch as typeof fetch | undefined);
    if (!impl) {
      throw new Error('No fetch implementation available; pass `fetchImpl` explicitly.');
    }
    this.fetchImpl = impl;
  }

  get baseUrl(): string {
    return this.cfg.baseUrl;
  }

  get tokenStore(): TokenStore | undefined {
    return this.cfg.tokenStore;
  }

  async get<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('GET', path, opts);
  }
  async post<T>(path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, { ...opts, body });
  }
  async put<T>(path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('PUT', path, { ...opts, body });
  }
  async patch<T>(path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('PATCH', path, { ...opts, body });
  }
  async delete<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('DELETE', path, opts);
  }

  /** Multipart upload; the browser/RN sets its own boundary so we omit Content-Type. */
  async upload<T>(path: string, form: FormData, opts: RequestOptions = {}): Promise<T> {
    return this.request<T>('POST', path, { ...opts, body: form });
  }

  private async request<T>(
    method: string,
    path: string,
    opts: RequestOptions,
    isRetry = false,
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...this.cfg.defaultHeaders,
      ...opts.headers,
    };
    if (!isForm && opts.body !== undefined) headers['Content-Type'] = 'application/json';

    if (!opts.anonymous) {
      const tokens = await this.cfg.tokenStore?.get();
      if (tokens?.accessToken) headers.Authorization = `Bearer ${tokens.accessToken}`;
    }

    const tenantHint = this.cfg.getTenantHint?.();
    if (tenantHint) headers['X-Tenant-Id'] = tenantHint;

    const tenantSlug = this.cfg.getTenantSlug?.();
    if (tenantSlug) headers['X-Tenant-Slug'] = tenantSlug;

    const guestToken = this.cfg.getGuestToken?.();
    if (guestToken) headers['X-Guest-Token'] = guestToken;

    const controller = new AbortController();
    const timeout = opts.timeoutMs ?? this.cfg.timeoutMs ?? 20_000;
    const timer = setTimeout(() => controller.abort(), timeout);
    if (opts.signal) {
      if (opts.signal.aborted) controller.abort();
      else opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }

    let response: Response;
    try {
      response = await this.fetchImpl(url, {
        method,
        headers,
        body: isForm ? (opts.body as FormData) : opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
        credentials: 'omit',
      });
    } catch (err) {
      clearTimeout(timer);
      const aborted = (err as Error)?.name === 'AbortError';
      // "Network request failed" on its own sends people hunting through
      // application code for a fault that is almost always the API simply not
      // running. Naming the address we could not reach turns a mystery into a
      // one-line check.
      throw new NetworkError(
        aborted
          ? `Request timed out after ${timeout}ms — ${this.cfg.baseUrl} did not respond`
          : `Could not reach the API at ${this.cfg.baseUrl}. Is it running?`,
        err,
      );
    } finally {
      clearTimeout(timer);
    }

    // A fresh guest cart token is minted by the API on first anonymous write.
    const issuedGuestToken = response.headers.get('X-Guest-Token');
    if (issuedGuestToken && issuedGuestToken !== guestToken) {
      this.cfg.onGuestToken?.(issuedGuestToken);
    }

    if (response.status === 204) return undefined as T;

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        // A non-JSON body means something upstream (nginx, a proxy) answered.
        throw new ApiClientError({
          status: response.status,
          code: 'INVALID_RESPONSE',
          message: `Unexpected non-JSON response (${response.status})`,
        });
      }
    }

    if (opts.raw) {
      if (!response.ok) {
        throw new ApiClientError({
          status: response.status,
          code: 'HTTP_ERROR',
          message: `Request failed with status ${response.status}`,
        });
      }
      return payload as T;
    }

    const envelope = payload as ApiResponse<T> | null;

    if (!response.ok || !envelope || envelope.success === false) {
      const err = envelope && envelope.success === false ? envelope.error : null;

      // One transparent refresh + replay, only for genuinely expired tokens.
      const refreshable =
        response.status === 401 &&
        !isRetry &&
        !opts.anonymous &&
        this.cfg.autoRefresh !== false &&
        !path.startsWith(REFRESH_PATH) &&
        err?.code !== 'REFRESH_TOKEN_REUSE_DETECTED';

      if (refreshable) {
        const refreshed = await this.refreshTokens();
        if (refreshed) return this.request<T>(method, path, opts, true);
        await this.cfg.onAuthFailure?.();
      }

      throw new ApiClientError({
        status: response.status,
        code: err?.code ?? 'HTTP_ERROR',
        message: err?.message ?? `Request failed with status ${response.status}`,
        details: err?.details ?? null,
        requestId: (envelope as { requestId?: string } | null)?.requestId ?? null,
      });
    }

    return envelope.data;
  }

  /** Single-flight refresh: concurrent callers await the same promise. */
  private refreshTokens(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;

    this.refreshInFlight = (async () => {
      try {
        const current = await this.cfg.tokenStore?.get();
        if (!current?.refreshToken) return false;

        const res = await this.fetchImpl(`${this.cfg.baseUrl}${REFRESH_PATH}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({ refreshToken: current.refreshToken }),
        });
        if (!res.ok) {
          await this.cfg.tokenStore?.clear();
          return false;
        }
        const body = (await res.json()) as ApiResponse<{
          accessToken: string;
          refreshToken: string;
        }>;
        if (!body.success) {
          await this.cfg.tokenStore?.clear();
          return false;
        }
        await this.cfg.tokenStore?.set({
          accessToken: body.data.accessToken,
          refreshToken: body.data.refreshToken,
        });
        return true;
      } catch {
        return false;
      } finally {
        this.refreshInFlight = null;
      }
    })();

    return this.refreshInFlight;
  }

  private buildUrl(path: string, query?: Record<string, unknown>): string {
    const normalised = path.startsWith('/') ? path : `/${path}`;
    const qs = buildQueryString(query);
    return `${this.cfg.baseUrl}${normalised}${qs}`;
  }
}

/** Skips null/undefined/empty and expands arrays as repeated keys. */
export function buildQueryString(query?: Record<string, unknown>): string {
  if (!query) return '';
  const parts: string[] = [];
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length === 0) continue;
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value.join(','))}`);
    } else if (value instanceof Date) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(value.toISOString())}`);
    } else {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length ? `?${parts.join('&')}` : '';
}
