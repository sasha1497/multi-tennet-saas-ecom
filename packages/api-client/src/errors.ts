import type { ApiErrorCode } from '@retailos/types';

/**
 * Every non-2xx response becomes one of these, so callers have a single error
 * type to catch regardless of whether the failure came from the network, the
 * gateway or the API itself.
 */
export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly details: Record<string, unknown> | null;
  readonly requestId: string | null;

  constructor(params: {
    status: number;
    code: ApiErrorCode | string;
    message: string;
    details?: Record<string, unknown> | null;
    requestId?: string | null;
  }) {
    super(params.message);
    this.name = 'ApiClientError';
    this.status = params.status;
    this.code = params.code;
    this.details = params.details ?? null;
    this.requestId = params.requestId ?? null;
    Object.setPrototypeOf(this, ApiClientError.prototype);
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isValidation(): boolean {
    return this.status === 400 || this.status === 422;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isServer(): boolean {
    return this.status >= 500;
  }

  /**
   * Field → message map for form libraries. The API returns Zod issues under
   * `details.fieldErrors`.
   */
  get fieldErrors(): Record<string, string> {
    const raw = (this.details?.fieldErrors ?? null) as Record<string, string[] | string> | null;
    if (!raw) return {};
    const out: Record<string, string> = {};
    for (const [field, value] of Object.entries(raw)) {
      out[field] = Array.isArray(value) ? String(value[0]) : String(value);
    }
    return out;
  }
}

export class NetworkError extends ApiClientError {
  constructor(message: string, cause?: unknown) {
    super({ status: 0, code: 'NETWORK_ERROR', message });
    this.name = 'NetworkError';
    if (cause) (this as { cause?: unknown }).cause = cause;
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

export function isApiClientError(e: unknown): e is ApiClientError {
  return e instanceof ApiClientError;
}
