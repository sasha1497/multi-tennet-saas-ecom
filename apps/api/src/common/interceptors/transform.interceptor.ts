import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Response } from 'express';
import { Observable, map } from 'rxjs';
import type { ApiSuccessResponse, PaginatedResult } from '@retailos/types';
import { RequestContextService } from '@/core/context/request-context';

export const NO_ENVELOPE = 'retailos:no-envelope';

/** Opts a route out of the response envelope (health checks, webhooks, files). */
export const NoEnvelope = () => SetMetadata(NO_ENVELOPE, true);

/**
 * Wraps every successful response in the standard envelope:
 *
 *   { success: true, data, meta?, requestId }
 *
 * Handlers just return their data; nothing has to remember the shape. When a
 * service returns a `PaginatedResult`, its pagination block is lifted into
 * `meta` so `data` stays a clean array — which is what clients want to map over.
 */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<unknown>> {
  constructor(
    private readonly reflector: Reflector,
    private readonly context: RequestContextService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccessResponse<unknown>> {
    const skip = this.reflector.getAllAndOverride<boolean>(NO_ENVELOPE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (skip || ctx.getType() !== 'http') {
      return next.handle() as Observable<ApiSuccessResponse<unknown>>;
    }

    const requestId = this.context.requestId;
    const res = ctx.switchToHttp().getResponse<Response>();

    return next.handle().pipe(
      map((payload) => {
        // 204 responses must not carry a body.
        if (res.statusCode === 204 || payload === undefined) {
          return undefined as unknown as ApiSuccessResponse<unknown>;
        }

        if (isPaginated(payload)) {
          return {
            success: true as const,
            data: payload.items,
            meta: { pagination: payload.pagination },
            requestId,
          };
        }

        return { success: true as const, data: payload, requestId };
      }),
    );
  }
}

function isPaginated(value: unknown): value is PaginatedResult<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as PaginatedResult<unknown>).items) &&
    typeof (value as PaginatedResult<unknown>).pagination === 'object' &&
    (value as PaginatedResult<unknown>).pagination !== null
  );
}
