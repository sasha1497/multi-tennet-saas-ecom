import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { HEADERS } from '@retailos/config';
import { RequestContextService } from '@/core/context/request-context';
import { AppLogger } from '@/core/logger/logger.service';
import { TenantResolverService } from './tenant-resolver.service';

/**
 * Establishes tenant context from the request Host.
 *
 * This runs for *every* request and never rejects: a request to the admin
 * console or the bare API domain simply has no host tenant, and the
 * `TenantGuard` later derives one from the caller's verified token instead.
 *
 * What this middleware will never do is take a tenant id from the request body,
 * the query string, or an arbitrary header. The only inputs it trusts are the
 * Host header and — for clients with no tenant hostname, i.e. the mobile app on
 * a LAN IP — an `X-Tenant-Slug` hint, which is resolved through exactly the same
 * `domains` table lookup and grants nothing on its own.
 */
@Injectable()
export class TenantResolverMiddleware implements NestMiddleware {
  private readonly logger: AppLogger;

  constructor(
    private readonly resolver: TenantResolverService,
    private readonly context: RequestContextService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('TenantResolverMiddleware');
  }

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const host = req.header('host');
      let resolved = await this.resolver.resolveByHostname(host);
      let source: 'HOST' | 'HEADER' = 'HOST';

      if (!resolved) {
        const slugHint = req.header(HEADERS.TENANT_SLUG);
        if (slugHint) {
          resolved = await this.resolver.resolveBySlug(slugHint);
          source = 'HEADER';
        }
      }

      if (resolved) {
        this.context.setTenant({
          tenantId: resolved.tenantId,
          slug: resolved.slug,
          name: resolved.name,
          status: resolved.status,
          hostname: resolved.hostname,
          source,
        });
        // Handy when debugging a routing problem from the browser network tab.
        res.setHeader('X-Resolved-Tenant', resolved.slug);
      }
    } catch (err) {
      // Resolution problems must not take down non-tenant routes such as
      // /health or the platform console.
      this.logger.warn('Tenant resolution failed', {
        host: req.header('host'),
        error: (err as Error).message,
      });
    }

    next();
  }
}
