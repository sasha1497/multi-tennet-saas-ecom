import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable, tap } from 'rxjs';
import { AppLogger } from '@/core/logger/logger.service';
import { MetricsService } from '@/core/observability/metrics.service';

/** Endpoints too noisy to log at info level. */
const QUIET_PATHS = ['/health', '/health/live', '/health/ready', '/metrics', '/favicon.ico'];

/**
 * One structured line per request, with the timing that latency SLOs are built
 * from. Tenant, user and request ids come from the ALS context automatically.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger: AppLogger;

  constructor(
    logger: AppLogger,
    private readonly metrics: MetricsService,
  ) {
    this.logger = logger.withContext('HTTP');
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType() !== 'http') return next.handle();

    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();
    const started = process.hrtime.bigint();
    const path = req.route?.path ?? req.originalUrl?.split('?')[0] ?? req.path;
    const quiet = QUIET_PATHS.includes(path);

    const finish = (error?: Error) => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const status = error ? (res.statusCode >= 400 ? res.statusCode : 500) : res.statusCode;

      // Route template, not the concrete URL, so metric cardinality stays bounded.
      this.metrics.recordHttpRequest({
        method: req.method,
        route: path,
        status,
        durationMs,
      });

      if (quiet && !error) return;

      const fields = {
        method: req.method,
        path,
        status,
        durationMs: Math.round(durationMs * 100) / 100,
        ip: req.ip,
      };

      if (status >= 500) this.logger.error('Request failed', undefined, fields);
      else if (status >= 400) this.logger.warn('Request rejected', fields);
      else this.logger.info('Request completed', fields);
    };

    return next.handle().pipe(
      tap({
        next: () => finish(),
        error: (err) => finish(err as Error),
      }),
    );
  }
}
