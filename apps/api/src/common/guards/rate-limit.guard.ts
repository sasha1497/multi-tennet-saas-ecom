import { CanActivate, ExecutionContext, HttpStatus, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { ApiErrorCode } from '@retailos/types';
import { cacheKeys } from '@retailos/config';
import { AppConfigService } from '@/config/config.module';
import { AppException } from '@/common/errors/app.exception';
import { CacheService } from '@/core/cache/cache.service';
import type { AuthContextData, TenantContextData } from '@/core/context/request-context';

export const RATE_LIMIT_META = 'retailos:rate-limit';
export const SKIP_RATE_LIMIT_META = 'retailos:skip-rate-limit';

export interface RateLimitOptions {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in seconds. */
  ttl: number;
  /** Bucket name, so different routes do not share a counter. */
  bucket?: string;
  /**
   * What to count by. `ip` for anonymous endpoints, `user` once authenticated,
   * `tenant` for expensive per-store work like report generation.
   */
  by?: 'ip' | 'user' | 'tenant' | 'ip+tenant';
}

export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_META, options);
export const SkipRateLimit = () => SetMetadata(SKIP_RATE_LIMIT_META, true);

/**
 * Redis-backed fixed-window rate limiting.
 *
 * Backed by Redis rather than in-memory state on purpose: with more than one API
 * container an in-process limiter multiplies the effective limit by the replica
 * count, which is exactly when you need it to hold.
 *
 * Buckets are namespaced by tenant where relevant, so one busy store cannot
 * consume another store's allowance.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
    private readonly config: AppConfigService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const handler = ctx.getHandler();
    const controller = ctx.getClass();

    if (this.reflector.getAllAndOverride<boolean>(SKIP_RATE_LIMIT_META, [handler, controller])) {
      return true;
    }

    const options: RateLimitOptions =
      this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_META, [handler, controller]) ?? {
        limit: this.config.security.rateLimitLimit,
        ttl: this.config.security.rateLimitTtl,
        bucket: 'global',
        by: 'ip+tenant',
      };

    const req = ctx.switchToHttp().getRequest<
      Request & { auth?: AuthContextData; tenant?: TenantContextData }
    >();
    const res = ctx.switchToHttp().getResponse<Response>();

    const identity = this.identityFor(options.by ?? 'ip+tenant', req);
    const key = cacheKeys.rateLimit(options.bucket ?? 'global', identity);

    const count = await this.cache.increment(key, options.ttl);

    const remaining = Math.max(0, options.limit - count);
    res.setHeader('X-RateLimit-Limit', options.limit);
    res.setHeader('X-RateLimit-Remaining', remaining);

    if (count > options.limit) {
      res.setHeader('Retry-After', options.ttl);
      throw new AppException({
        status: HttpStatus.TOO_MANY_REQUESTS,
        code: ApiErrorCode.RATE_LIMIT_EXCEEDED,
        message: 'Too many requests. Please slow down and try again shortly.',
        details: { retryAfterSeconds: options.ttl },
      });
    }

    return true;
  }

  private identityFor(
    by: NonNullable<RateLimitOptions['by']>,
    req: Request & { auth?: AuthContextData; tenant?: TenantContextData },
  ): string {
    const ip = req.ip ?? 'unknown';
    const tenant = req.tenant?.tenantId ?? 'no-tenant';
    const user = req.auth?.userId;

    switch (by) {
      case 'ip':
        return `ip:${ip}`;
      case 'user':
        // Falls back to IP for anonymous callers so the bucket still bites.
        return user ? `user:${user}` : `ip:${ip}`;
      case 'tenant':
        return `tenant:${tenant}`;
      case 'ip+tenant':
      default:
        return `${tenant}:${ip}`;
    }
  }
}
