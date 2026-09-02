import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { ApiErrorCode, type ApiErrorResponse } from '@retailos/types';
import { AppConfigService } from '@/config/config.module';
import { AppException } from '@/common/errors/app.exception';
import { RequestContextService } from '@/core/context/request-context';
import { AppLogger } from '@/core/logger/logger.service';

/** Prisma error codes we can translate into something a user can act on. */
const PRISMA_CODES: Record<string, { status: HttpStatus; code: string; message: string }> = {
  P2002: {
    status: HttpStatus.CONFLICT,
    code: ApiErrorCode.DUPLICATE_RESOURCE,
    message: 'A record with these details already exists',
  },
  P2003: {
    status: HttpStatus.BAD_REQUEST,
    code: ApiErrorCode.BAD_REQUEST,
    message: 'A referenced record does not exist',
  },
  P2025: {
    status: HttpStatus.NOT_FOUND,
    code: ApiErrorCode.NOT_FOUND,
    message: 'Record not found',
  },
  P2034: {
    status: HttpStatus.CONFLICT,
    code: ApiErrorCode.CONCURRENT_MODIFICATION,
    message: 'The operation conflicted with another change. Please retry.',
  },
};

/**
 * Single exit point for every error.
 *
 * Two invariants:
 *   • the client always receives the same envelope shape, with a stable `code`
 *   • **stack traces and internal detail never leave the process in production**
 *     — they go to the log, keyed by the requestId the client is handed, so
 *     support can find the exact failure from a screenshot.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger: AppLogger;

  constructor(
    private readonly config: AppConfigService,
    private readonly context: RequestContextService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('ExceptionFilter');
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.logger.error('Non-HTTP exception', exception as Error);
      return;
    }

    const res = host.switchToHttp().getResponse<Response>();
    const requestId = this.context.requestId;
    const { status, body, logLevel, cause } = this.translate(exception, requestId);

    if (logLevel === 'error') {
      this.logger.error(`Unhandled error: ${body.error.message}`, cause, {
        status,
        code: body.error.code,
      });
    } else if (logLevel === 'warn') {
      this.logger.warn(`Request error: ${body.error.message}`, {
        status,
        code: body.error.code,
      });
    }

    if (res.headersSent) return;
    res.status(status).json(body);
  }

  private translate(
    exception: unknown,
    requestId: string,
  ): {
    status: number;
    body: ApiErrorResponse;
    logLevel: 'error' | 'warn' | 'none';
    cause?: Error;
  } {
    // ---------------------------------------------------- application errors
    if (exception instanceof AppException) {
      const status = exception.getStatus();
      return {
        status,
        logLevel: status >= 500 ? 'error' : 'warn',
        cause: status >= 500 ? exception : undefined,
        body: {
          success: false,
          error: {
            code: exception.code,
            message: exception.message,
            details: exception.details,
          },
          requestId,
        },
      };
    }

    // ------------------------------------------------------ validation (zod)
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.BAD_REQUEST,
        logLevel: 'none',
        body: {
          success: false,
          error: {
            code: ApiErrorCode.VALIDATION_ERROR,
            message: 'The submitted data is invalid',
            details: { fieldErrors: flattenZod(exception) },
          },
          requestId,
        },
      };
    }

    // --------------------------------------------------------------- prisma
    const prisma = this.matchPrisma(exception);
    if (prisma) {
      return {
        status: prisma.status,
        logLevel: 'warn',
        body: {
          success: false,
          error: { code: prisma.code, message: prisma.message, details: prisma.details },
          requestId,
        },
      };
    }

    // ------------------------------------------------------- nest exceptions
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const { message, code, details } = normaliseNestResponse(response, status);
      return {
        status,
        logLevel: status >= 500 ? 'error' : 'none',
        cause: status >= 500 ? exception : undefined,
        body: { success: false, error: { code, message, details }, requestId },
      };
    }

    // ------------------------------------------------------------ everything
    const err = exception instanceof Error ? exception : new Error(String(exception));
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      logLevel: 'error',
      cause: err,
      body: {
        success: false,
        error: {
          code: ApiErrorCode.INTERNAL_ERROR,
          // In development the real message speeds up debugging; in production
          // it could leak schema or infrastructure detail, so it is withheld.
          message: this.config.isProd ? 'Something went wrong' : err.message,
          details: this.config.isProd ? null : { stack: err.stack?.split('\n').slice(0, 5) },
        },
        requestId,
      },
    };
  }

  /**
   * Prisma errors are matched structurally rather than with `instanceof`, so
   * this filter does not have to import the generated client (of which there
   * are two — master and tenant — with distinct class identities).
   */
  private matchPrisma(
    exception: unknown,
  ): { status: HttpStatus; code: string; message: string; details: Record<string, unknown> | null } | null {
    if (typeof exception !== 'object' || exception === null) return null;
    const e = exception as { name?: string; code?: string; meta?: Record<string, unknown> };
    if (!e.name?.startsWith('PrismaClient') || typeof e.code !== 'string') return null;

    const mapped = PRISMA_CODES[e.code];
    if (!mapped) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: ApiErrorCode.INTERNAL_ERROR,
        message: 'A database error occurred',
        details: this.config.isProd ? null : { prismaCode: e.code },
      };
    }

    // `meta.target` names the conflicting column(s) — genuinely useful to a form.
    const target = e.meta?.target;
    const field = Array.isArray(target) ? String(target[0]) : target ? String(target) : null;

    return {
      status: mapped.status,
      code: mapped.code,
      message: field && e.code === 'P2002' ? `This ${humanise(field)} is already in use` : mapped.message,
      details: field ? { field } : null,
    };
  }
}

function flattenZod(error: ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    (out[path] ??= []).push(issue.message);
  }
  return out;
}

function normaliseNestResponse(
  response: string | object,
  status: number,
): { message: string; code: string; details: Record<string, unknown> | null } {
  if (typeof response === 'string') {
    return { message: response, code: defaultCodeFor(status), details: null };
  }

  const r = response as {
    message?: string | string[];
    code?: string;
    error?: string;
    details?: Record<string, unknown>;
  };

  const message = Array.isArray(r.message)
    ? r.message.join('; ')
    : (r.message ?? r.error ?? 'Request failed');

  return {
    message,
    code: r.code ?? defaultCodeFor(status),
    details: r.details ?? null,
  };
}

function defaultCodeFor(status: number): string {
  switch (status) {
    case 400:
      return ApiErrorCode.BAD_REQUEST;
    case 401:
      return ApiErrorCode.UNAUTHENTICATED;
    case 403:
      return ApiErrorCode.FORBIDDEN;
    case 404:
      return ApiErrorCode.NOT_FOUND;
    case 409:
      return ApiErrorCode.CONFLICT;
    case 422:
      return ApiErrorCode.VALIDATION_ERROR;
    case 429:
      return ApiErrorCode.RATE_LIMIT_EXCEEDED;
    case 503:
      return ApiErrorCode.SERVICE_UNAVAILABLE;
    default:
      return status >= 500 ? ApiErrorCode.INTERNAL_ERROR : ApiErrorCode.BAD_REQUEST;
  }
}

function humanise(field: string): string {
  return field.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
}
