import { randomUUID } from 'node:crypto';
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { HEADERS } from '@retailos/config';
import { RequestContextService, createRequestContext } from '@/core/context/request-context';
import { TokenHasher } from '@/core/security/credential-cipher.service';

/**
 * Opens the AsyncLocalStorage scope for the request.
 *
 * Must be the very first middleware: everything downstream — the tenant
 * resolver, guards, services, the logger — reads from the context this creates.
 * Because `next()` is invoked synchronously inside `als.run()`, the whole
 * downstream chain (including async handlers) inherits the store.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly context: RequestContextService,
    private readonly tokens: TokenHasher,
  ) {}

  use(req: Request, res: Response, next: NextFunction): void {
    // Honour an upstream request id (nginx / load balancer) so a trace survives
    // the hop, but only if it looks sane — it ends up in logs and headers.
    const incoming = req.header(HEADERS.REQUEST_ID);
    const requestId =
      incoming && /^[A-Za-z0-9_.:-]{8,64}$/.test(incoming) ? incoming : randomUUID();

    res.setHeader(HEADERS.REQUEST_ID, requestId);

    // Guest cart tokens are HMAC-signed; an unsigned or tampered one is dropped
    // here so no downstream code can be tricked into loading someone else's cart.
    const rawGuest = req.header(HEADERS.GUEST_TOKEN);
    const guestToken = this.tokens.verifyGuestToken(rawGuest);

    const ctx = createRequestContext({
      requestId,
      ip: extractIp(req),
      userAgent: (req.header('user-agent') ?? '').slice(0, 512) || null,
      method: req.method,
      path: req.originalUrl?.split('?')[0] ?? req.path,
      guestToken,
    });

    // Mirror onto the request object so the `@RequestId()` / `@CurrentUser()`
    // param decorators can read it without touching AsyncLocalStorage.
    (req as Request & { requestId?: string }).requestId = requestId;

    this.context.run(ctx, () => next());
  }
}

/**
 * Client IP behind a proxy.
 *
 * Express's `trust proxy` is enabled in main.ts, so `req.ip` is already the
 * left-most X-Forwarded-For entry. This is a defensive fallback for setups
 * where the header arrives but the trust setting has not been applied.
 */
function extractIp(req: Request): string | null {
  const forwarded = req.header('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first.slice(0, 64);
  }
  return (req.ip ?? req.socket?.remoteAddress ?? null)?.slice(0, 64) ?? null;
}
