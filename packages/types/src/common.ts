/** Cross-cutting envelope, pagination and error shapes. */

/**
 * Every successful API response is wrapped in this envelope by
 * `TransformInterceptor` in the API. Keeping a single shape means clients never
 * have to guess whether they got data or an error.
 */
export interface ApiSuccessResponse<T> {
  success: true;
  data: T;
  meta?: ResponseMeta;
  requestId: string;
}

export interface ApiErrorResponse {
  success: false;
  error: {
    code: ApiErrorCode | string;
    message: string;
    /** Field-level validation problems, or provider detail. Never a stack trace. */
    details?: Record<string, unknown> | null;
  };
  requestId: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export interface ResponseMeta {
  pagination?: PaginationMeta;
  [key: string]: unknown;
}

/** Offset pagination — used for admin tables where a page count matters. */
export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationMeta;
}

/** Cursor pagination — used for storefront/mobile infinite scroll over large sets. */
export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PaginationQuery {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: SortOrder;
  search?: string;
}

export type SortOrder = 'asc' | 'desc';

/**
 * Stable machine-readable error codes. Clients switch on these, never on the
 * human-readable `message`.
 */
export const ApiErrorCode = {
  // 400
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  BAD_REQUEST: 'BAD_REQUEST',
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  // 401
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  REFRESH_TOKEN_REUSE_DETECTED: 'REFRESH_TOKEN_REUSE_DETECTED',
  // 403
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  TENANT_MEMBERSHIP_REQUIRED: 'TENANT_MEMBERSHIP_REQUIRED',
  FEATURE_NOT_ENTITLED: 'FEATURE_NOT_ENTITLED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  // 404
  NOT_FOUND: 'NOT_FOUND',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  // 409
  CONFLICT: 'CONFLICT',
  DUPLICATE_RESOURCE: 'DUPLICATE_RESOURCE',
  CONCURRENT_MODIFICATION: 'CONCURRENT_MODIFICATION',
  // 422
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  CART_EMPTY: 'CART_EMPTY',
  PRICE_CHANGED: 'PRICE_CHANGED',
  COUPON_INVALID: 'COUPON_INVALID',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  PAYMENT_SIGNATURE_INVALID: 'PAYMENT_SIGNATURE_INVALID',
  // 423 / 503
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  TENANT_PROVISIONING: 'TENANT_PROVISIONING',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  // 429
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  // 500
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/**
 * All monetary values in this system are integers in the currency's **minor
 * unit** (paise for INR). Never floats — see docs/DECISION_LOG.md ADR-004.
 */
export type Money = number;

export interface MoneyFormatted {
  amount: Money;
  currency: string;
  /** Pre-formatted for display, e.g. "₹1,499.00". */
  display: string;
}

export interface AuditableEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
}

export interface SoftDeletableEntity extends AuditableEntity {
  deletedAt: string | null;
}

export interface HealthStatus {
  status: 'ok' | 'degraded' | 'error';
  info: Record<string, { status: string; [k: string]: unknown }>;
  error: Record<string, { status: string; message?: string }>;
  details: Record<string, { status: string; [k: string]: unknown }>;
  uptimeSeconds: number;
  version: string;
}

export interface IdParam {
  id: string;
}
