import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission, Role, TokenAudience } from '@retailos/types';
import type { AuthContextData, TenantContextData } from '@/core/context/request-context';

export const METADATA = {
  PUBLIC: 'retailos:public',
  AUDIENCE: 'retailos:audience',
  PERMISSIONS: 'retailos:permissions',
  ANY_PERMISSION: 'retailos:any-permission',
  ROLES: 'retailos:roles',
  TENANT_REQUIRED: 'retailos:tenant-required',
  SUPER_ADMIN: 'retailos:super-admin',
  FEATURE: 'retailos:feature',
  PLAN_LIMIT: 'retailos:plan-limit',
  INTERNAL: 'retailos:internal',
  SKIP_TENANT_STATUS: 'retailos:skip-tenant-status',
} as const;

/**
 * Marks a route as reachable without authentication.
 *
 * The auth guard is global and deny-by-default, so forgetting this decorator
 * makes a route private — the safe failure mode. Forgetting to *remove* it is
 * the dangerous one, which is why public routes are few and reviewed.
 */
export const Public = () => SetMetadata(METADATA.PUBLIC, true);

/**
 * Restricts a route to one token audience.
 *
 * Merchant-console tokens and shopper tokens are minted from different identity
 * stores (master DB vs tenant DB) and must never be interchangeable: a customer
 * token must not open `/merchant/orders` even if the ids happened to collide.
 */
export const Audience = (audience: TokenAudience) => SetMetadata(METADATA.AUDIENCE, audience);

/** Requires ALL listed permissions. */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(METADATA.PERMISSIONS, permissions);

/** Requires AT LEAST ONE of the listed permissions. */
export const RequireAnyPermission = (...permissions: Permission[]) =>
  SetMetadata(METADATA.ANY_PERMISSION, permissions);

export const RequireRoles = (...roles: Role[]) => SetMetadata(METADATA.ROLES, roles);

/**
 * Declares that the route operates on tenant data.
 *
 * `TenantGuard` will establish and verify the tenant, and every
 * `TenantDatabaseService` call inside the handler is then guaranteed to hit the
 * right database.
 */
export const RequireTenant = () => SetMetadata(METADATA.TENANT_REQUIRED, true);

/** Allows the handler to run for a SUSPENDED or PROVISIONING tenant. */
export const AllowInactiveTenant = () => SetMetadata(METADATA.SKIP_TENANT_STATUS, true);

export const SuperAdminOnly = () => SetMetadata(METADATA.SUPER_ADMIN, true);

/** Gates a route behind a plan feature entitlement. */
export const RequireFeature = (featureKey: string) => SetMetadata(METADATA.FEATURE, featureKey);

/** Service-to-service route, authenticated by the internal API key. */
export const InternalOnly = () => SetMetadata(METADATA.INTERNAL, true);

// ------------------------------------------------------------- parameters --

/** The authenticated principal for this request. */
export const CurrentUser = createParamDecorator(
  (field: keyof AuthContextData | undefined, ctx: ExecutionContext) => {
    const auth = ctx.switchToHttp().getRequest<{ auth?: AuthContextData }>().auth ?? null;
    if (!auth) return null;
    return field ? auth[field] : auth;
  },
);

/** The resolved tenant for this request. */
export const CurrentTenant = createParamDecorator(
  (field: keyof TenantContextData | undefined, ctx: ExecutionContext) => {
    const tenant = ctx.switchToHttp().getRequest<{ tenant?: TenantContextData }>().tenant ?? null;
    if (!tenant) return null;
    return field ? tenant[field] : tenant;
  },
);

export const TenantId = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<{ tenant?: TenantContextData }>().tenant?.tenantId ?? null;
});

export const RequestId = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<{ requestId?: string }>().requestId ?? null;
});

/** Client IP, already normalised by the request-context middleware. */
export const ClientIp = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<{ ip?: string }>();
  return req.ip ?? null;
});

/** Raw request body buffer — needed for webhook signature verification. */
export const RawBody = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<{ rawBody?: Buffer }>().rawBody ?? null;
});
