import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';
import type { Role, TenantStatus, TokenAudience } from '@retailos/types';

/** How the tenant for this request was determined. Recorded for audit + debugging. */
export type TenantResolutionSource =
  /** From the request Host header via the master `domains` table. */
  | 'HOST'
  /** From a verified `tid` claim in the caller's access token. */
  | 'TOKEN'
  /** From an `X-Tenant-Id` hint, only after membership was verified. */
  | 'HEADER'
  /** Set by a worker/CLI running on behalf of one tenant. */
  | 'INTERNAL';

export interface TenantContextData {
  tenantId: string;
  slug: string;
  name: string;
  status: TenantStatus;
  hostname: string | null;
  source: TenantResolutionSource;
}

export interface AuthContextData {
  userId: string;
  audience: TokenAudience;
  role: Role;
  permissions: string[];
  sessionId: string;
  email: string | null;
  /** Tenant the token was minted for; null for platform super admins. */
  tokenTenantId: string | null;
  isSuperAdmin: boolean;
}

export interface RequestContextData {
  requestId: string;
  startedAt: number;
  ip: string | null;
  userAgent: string | null;
  method: string;
  path: string;
  tenant: TenantContextData | null;
  auth: AuthContextData | null;
  /** Anonymous storefront cart identity. */
  guestToken: string | null;
}

/**
 * Request-scoped state without request-scoped providers.
 *
 * NestJS's `Scope.REQUEST` would force every service that touches the tenant —
 * which is nearly all of them — to be instantiated per request, along with its
 * whole dependency subtree. AsyncLocalStorage gives us the same isolation at a
 * fraction of the cost, and it also flows into BullMQ job handlers and
 * background promises where DI scoping would not reach.
 *
 * See docs/DECISION_LOG.md ADR-003.
 */
@Injectable()
export class RequestContextService {
  private static readonly storage = new AsyncLocalStorage<RequestContextData>();

  /** Runs `fn` with a fresh context. Everything awaited inside sees it. */
  run<T>(data: RequestContextData, fn: () => T): T {
    return RequestContextService.storage.run(data, fn);
  }

  /** Current context, or null outside a request (e.g. at bootstrap). */
  get(): RequestContextData | null {
    return RequestContextService.storage.getStore() ?? null;
  }

  /** Current context, throwing if absent — for code that genuinely requires one. */
  require(): RequestContextData {
    const ctx = this.get();
    if (!ctx) {
      throw new Error(
        'No request context available. This code must run inside RequestContextService.run().',
      );
    }
    return ctx;
  }

  get requestId(): string {
    return this.get()?.requestId ?? 'no-request-id';
  }

  // ------------------------------------------------------------- tenant --

  get tenant(): TenantContextData | null {
    return this.get()?.tenant ?? null;
  }

  /**
   * The tenant id for the current request.
   *
   * Every tenant-scoped repository call funnels through here, so if the context
   * is missing we fail loudly rather than silently querying the wrong database.
   */
  requireTenantId(): string {
    const tenant = this.tenant;
    if (!tenant) {
      throw new Error(
        'Tenant context is not set for this request. A tenant-scoped operation was attempted ' +
          'outside a tenant-resolved route — this is a bug, not a client error.',
      );
    }
    return tenant.tenantId;
  }

  requireTenant(): TenantContextData {
    const tenant = this.tenant;
    if (!tenant) throw new Error('Tenant context is not set for this request.');
    return tenant;
  }

  setTenant(tenant: TenantContextData | null): void {
    const ctx = this.get();
    if (ctx) ctx.tenant = tenant;
  }

  // --------------------------------------------------------------- auth --

  get auth(): AuthContextData | null {
    return this.get()?.auth ?? null;
  }

  setAuth(auth: AuthContextData | null): void {
    const ctx = this.get();
    if (ctx) ctx.auth = auth;
  }

  get userId(): string | null {
    return this.auth?.userId ?? null;
  }

  setGuestToken(token: string | null): void {
    const ctx = this.get();
    if (ctx) ctx.guestToken = token;
  }

  get guestToken(): string | null {
    return this.get()?.guestToken ?? null;
  }

  /** Structured fields attached to every log line and audit record. */
  logFields(): Record<string, unknown> {
    const ctx = this.get();
    if (!ctx) return {};
    return {
      requestId: ctx.requestId,
      tenantId: ctx.tenant?.tenantId ?? null,
      tenantSlug: ctx.tenant?.slug ?? null,
      userId: ctx.auth?.userId ?? null,
      audience: ctx.auth?.audience ?? null,
    };
  }
}

export function createRequestContext(
  partial: Partial<RequestContextData> & { requestId: string },
): RequestContextData {
  return {
    startedAt: Date.now(),
    ip: null,
    userAgent: null,
    method: 'INTERNAL',
    path: '',
    tenant: null,
    auth: null,
    guestToken: null,
    ...partial,
  };
}
