import { HttpException, HttpStatus } from '@nestjs/common';
import { ApiErrorCode } from '@retailos/types';

/**
 * The one exception type the application throws.
 *
 * Carrying a stable `code` alongside the HTTP status means clients can branch on
 * `INSUFFICIENT_STOCK` without string-matching a message that might be reworded
 * tomorrow. `AllExceptionsFilter` renders it into the standard error envelope.
 */
export class AppException extends HttpException {
  readonly code: ApiErrorCode | string;
  readonly details: Record<string, unknown> | null;
  /** Extra context for the log line only — never serialised to the client. */
  readonly logContext: Record<string, unknown> | null;

  constructor(params: {
    status: HttpStatus;
    code: ApiErrorCode | string;
    message: string;
    details?: Record<string, unknown> | null;
    logContext?: Record<string, unknown> | null;
  }) {
    super({ code: params.code, message: params.message }, params.status);
    this.code = params.code;
    this.details = params.details ?? null;
    this.logContext = params.logContext ?? null;
  }
}

/**
 * Factories for the failures this system actually produces. Using these instead
 * of bare `new BadRequestException()` is what keeps error codes consistent
 * across 20-odd modules.
 */
export const Errors = {
  // ------------------------------------------------------------------ 400 --
  badRequest: (message: string, details?: Record<string, unknown>) =>
    new AppException({
      status: HttpStatus.BAD_REQUEST,
      code: ApiErrorCode.BAD_REQUEST,
      message,
      details,
    }),

  validation: (message = 'The submitted data is invalid', details?: Record<string, unknown>) =>
    new AppException({
      status: HttpStatus.BAD_REQUEST,
      code: ApiErrorCode.VALIDATION_ERROR,
      message,
      details,
    }),

  invalidTransition: (from: string, to: string) =>
    new AppException({
      status: HttpStatus.BAD_REQUEST,
      code: ApiErrorCode.INVALID_STATE_TRANSITION,
      message: `Cannot move from ${from} to ${to}`,
      details: { from, to },
    }),

  // ------------------------------------------------------------------ 401 --
  unauthenticated: (message = 'Authentication is required') =>
    new AppException({
      status: HttpStatus.UNAUTHORIZED,
      code: ApiErrorCode.UNAUTHENTICATED,
      message,
    }),

  invalidCredentials: () =>
    new AppException({
      status: HttpStatus.UNAUTHORIZED,
      code: ApiErrorCode.INVALID_CREDENTIALS,
      // Deliberately vague: never reveal whether the account exists.
      message: 'Incorrect email or password',
    }),

  tokenExpired: () =>
    new AppException({
      status: HttpStatus.UNAUTHORIZED,
      code: ApiErrorCode.TOKEN_EXPIRED,
      message: 'Your session has expired. Please sign in again.',
    }),

  tokenInvalid: (message = 'Invalid authentication token') =>
    new AppException({
      status: HttpStatus.UNAUTHORIZED,
      code: ApiErrorCode.TOKEN_INVALID,
      message,
    }),

  refreshReuse: () =>
    new AppException({
      status: HttpStatus.UNAUTHORIZED,
      code: ApiErrorCode.REFRESH_TOKEN_REUSE_DETECTED,
      message: 'This session was ended for security reasons. Please sign in again.',
    }),

  // ------------------------------------------------------------------ 403 --
  forbidden: (message = 'You do not have access to this resource') =>
    new AppException({ status: HttpStatus.FORBIDDEN, code: ApiErrorCode.FORBIDDEN, message }),

  insufficientPermissions: (required: readonly string[]) =>
    new AppException({
      status: HttpStatus.FORBIDDEN,
      code: ApiErrorCode.INSUFFICIENT_PERMISSIONS,
      message: 'Your role does not allow this action',
      details: { required },
    }),

  tenantMembershipRequired: () =>
    new AppException({
      status: HttpStatus.FORBIDDEN,
      code: ApiErrorCode.TENANT_MEMBERSHIP_REQUIRED,
      message: 'You are not a member of this store',
    }),

  featureNotEntitled: (featureKey: string) =>
    new AppException({
      status: HttpStatus.FORBIDDEN,
      code: ApiErrorCode.FEATURE_NOT_ENTITLED,
      message: 'This feature is not available on your current plan',
      details: { featureKey },
    }),

  planLimitReached: (limitKey: string, limit: number, current: number) =>
    new AppException({
      status: HttpStatus.FORBIDDEN,
      code: ApiErrorCode.PLAN_LIMIT_REACHED,
      message: `You have reached your plan limit (${limit}). Upgrade to add more.`,
      details: { limitKey, limit, current },
    }),

  // ------------------------------------------------------------------ 404 --
  notFound: (resource = 'Resource', id?: string) =>
    new AppException({
      status: HttpStatus.NOT_FOUND,
      code: ApiErrorCode.NOT_FOUND,
      message: `${resource} not found`,
      details: id ? { id } : undefined,
    }),

  tenantNotFound: (hostname?: string) =>
    new AppException({
      status: HttpStatus.NOT_FOUND,
      code: ApiErrorCode.TENANT_NOT_FOUND,
      message: 'No store is configured for this address',
      details: hostname ? { hostname } : undefined,
    }),

  // ------------------------------------------------------------------ 409 --
  conflict: (message: string, details?: Record<string, unknown>) =>
    new AppException({ status: HttpStatus.CONFLICT, code: ApiErrorCode.CONFLICT, message, details }),

  duplicate: (resource: string, field?: string) =>
    new AppException({
      status: HttpStatus.CONFLICT,
      code: ApiErrorCode.DUPLICATE_RESOURCE,
      message: field ? `A ${resource} with this ${field} already exists` : `${resource} already exists`,
      details: field ? { field } : undefined,
    }),

  concurrentModification: (resource = 'record') =>
    new AppException({
      status: HttpStatus.CONFLICT,
      code: ApiErrorCode.CONCURRENT_MODIFICATION,
      message: `This ${resource} was changed by someone else. Reload and try again.`,
    }),

  // ------------------------------------------------------------------ 422 --
  insufficientStock: (sku: string, requested: number, available: number) =>
    new AppException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: ApiErrorCode.INSUFFICIENT_STOCK,
      message:
        available === 0
          ? `${sku} is out of stock`
          : `Only ${available} left of ${sku}, but ${requested} were requested`,
      details: { sku, requested, available },
    }),

  cartEmpty: () =>
    new AppException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: ApiErrorCode.CART_EMPTY,
      message: 'Your cart is empty',
    }),

  priceChanged: (details: Record<string, unknown>) =>
    new AppException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: ApiErrorCode.PRICE_CHANGED,
      message: 'Some prices changed while you were shopping. Please review your cart.',
      details,
    }),

  couponInvalid: (reason: string) =>
    new AppException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: ApiErrorCode.COUPON_INVALID,
      message: reason,
    }),

  paymentFailed: (reason: string, details?: Record<string, unknown>) =>
    new AppException({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
      code: ApiErrorCode.PAYMENT_FAILED,
      message: reason,
      details,
    }),

  paymentSignatureInvalid: () =>
    new AppException({
      status: HttpStatus.BAD_REQUEST,
      code: ApiErrorCode.PAYMENT_SIGNATURE_INVALID,
      message: 'Payment verification failed',
    }),

  // ------------------------------------------------------------ 423 / 503 --
  tenantSuspended: (reason?: string | null) =>
    new AppException({
      status: HttpStatus.FORBIDDEN,
      code: ApiErrorCode.TENANT_SUSPENDED,
      message: 'This store is currently unavailable',
      details: reason ? { reason } : undefined,
    }),

  tenantProvisioning: () =>
    new AppException({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: ApiErrorCode.TENANT_PROVISIONING,
      message: 'This store is still being set up. Please try again in a moment.',
    }),

  serviceUnavailable: (message = 'Service temporarily unavailable') =>
    new AppException({
      status: HttpStatus.SERVICE_UNAVAILABLE,
      code: ApiErrorCode.SERVICE_UNAVAILABLE,
      message,
    }),

  // ------------------------------------------------------------------ 500 --
  internal: (message = 'Something went wrong', logContext?: Record<string, unknown>) =>
    new AppException({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ApiErrorCode.INTERNAL_ERROR,
      message,
      logContext,
    }),
};
