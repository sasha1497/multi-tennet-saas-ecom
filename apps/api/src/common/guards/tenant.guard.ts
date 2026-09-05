import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { HEADERS } from '@retailos/config';
import { TenantStatus, TokenAudience } from '@retailos/types';
import { uuidSchema } from '@retailos/validation';
import { METADATA } from '@/common/decorators';
import { Errors } from '@/common/errors/app.exception';
import {
  RequestContextService,
  type AuthContextData,
  type TenantContextData,
} from '@/core/context/request-context';
import { AppLogger } from '@/core/logger/logger.service';
import { MembershipService } from '@/core/tenant/membership.service';
import { TenantResolverService } from '@/core/tenant/tenant-resolver.service';

/**
 * Establishes and *verifies* the tenant for routes marked `@RequireTenant()`.
 *
 * This is the security centrepiece of the whole platform. The rules it enforces:
 *
 *  1. A tenant resolved from the Host is authoritative for storefront traffic.
 *  2. A **customer** token is bound to exactly one tenant. If its `tid` does not
 *     match the tenant resolved from the Host, the request is rejected — this is
 *     what stops a KickZone shopper's token from reading ABC Store data by
 *     pointing it at a different hostname.
 *  3. An **admin** token may act on a tenant only if a live `tenant_users` row
 *     says so. The token's own `tid` is not trusted on its own; membership is
 *     re-read (with a 30s cache) on every request, so revocation is near-instant.
 *  4. An `X-Tenant-Id` header is accepted *only* as a hint, and only after the
 *     same membership check. It can never widen access — at best it selects
 *     among tenants the caller already belongs to.
 *  5. A super admin may act cross-tenant, and every such request is logged.
 *  6. SUSPENDED / PROVISIONING / DELETED tenants are refused unless the route
 *     opts out with `@AllowInactiveTenant()`.
 *
 * Nothing here ever reads a tenant id from the request body or query string.
 */
@Injectable()
export class TenantGuard implements CanActivate {
  private readonly logger: AppLogger;

  constructor(
    private readonly reflector: Reflector,
    private readonly context: RequestContextService,
    private readonly memberships: MembershipService,
    private readonly resolver: TenantResolverService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('TenantGuard');
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const handler = ctx.getHandler();
    const controller = ctx.getClass();

    const required = this.reflector.getAllAndOverride<boolean>(METADATA.TENANT_REQUIRED, [
      handler,
      controller,
    ]);
    if (!required) return true;

    const req = ctx.switchToHttp().getRequest<
      Request & { auth?: AuthContextData; tenant?: TenantContextData }
    >();
    const auth = req.auth ?? null;
    const hostTenant = this.context.tenant;

    const allowInactive = this.reflector.getAllAndOverride<boolean>(METADATA.SKIP_TENANT_STATUS, [
      handler,
      controller,
    ]);

    const tenant = hostTenant
      ? await this.verifyHostTenant(hostTenant, auth)
      : await this.deriveTenantFromToken(req, auth);

    if (!allowInactive) this.assertUsable(tenant);

    this.context.setTenant(tenant);
    req.tenant = tenant;
    return true;
  }

  /**
   * The Host already told us which store this is. Now confirm the caller is
   * allowed to act on it.
   */
  private async verifyHostTenant(
    hostTenant: TenantContextData,
    auth: AuthContextData | null,
  ): Promise<TenantContextData> {
    // Anonymous storefront traffic: the tenant stands on its own.
    if (!auth) return hostTenant;

    if (auth.audience === TokenAudience.CUSTOMER) {
      // Rule 2 — a shopper token is valid for one store only.
      if (auth.tokenTenantId !== hostTenant.tenantId) {
        this.logger.warn('Rejected cross-tenant customer token', {
          tokenTenantId: auth.tokenTenantId,
          hostTenantId: hostTenant.tenantId,
          userId: auth.userId,
        });
        throw Errors.forbidden('Your session belongs to a different store');
      }
      return hostTenant;
    }

    // Admin audience acting through a storefront hostname (e.g. previewing).
    if (auth.isSuperAdmin) {
      this.logger.info('Super admin acting on tenant', {
        tenantId: hostTenant.tenantId,
        userId: auth.userId,
      });
      return hostTenant;
    }

    const membership = await this.memberships.find(auth.userId, hostTenant.tenantId);
    if (!membership) throw Errors.tenantMembershipRequired();

    return hostTenant;
  }

  /**
   * No tenant hostname (admin console / bare API domain), so the tenant comes
   * from the caller's identity — never from unverified request data.
   */
  private async deriveTenantFromToken(
    req: Request,
    auth: AuthContextData | null,
  ): Promise<TenantContextData> {
    if (!auth) {
      // A storefront route reached without a tenant hostname and without a token.
      throw Errors.tenantNotFound(req.header('host') ?? undefined);
    }

    if (auth.audience === TokenAudience.CUSTOMER) {
      if (!auth.tokenTenantId) throw Errors.tenantNotFound();
      const resolved = await this.resolver.resolveById(auth.tokenTenantId);
      if (!resolved) throw Errors.tenantNotFound();
      return { ...resolved, source: 'TOKEN' };
    }

    // Rule 4: the header is a *selection*, validated below, never a grant.
    const hint = req.header(HEADERS.TENANT_ID)?.trim();
    const candidateId = hint || auth.tokenTenantId;

    if (!candidateId) {
      throw Errors.badRequest(
        'No store selected. Pick a store in the console or sign in again.',
      );
    }

    // Shape-check the header before it reaches the database. Prisma parameterises
    // its queries, so a hostile value cannot inject SQL — but an unparseable id
    // would raise a driver error and surface as a 500, which is both a poor
    // response and a needless hint that the value reached the data layer.
    if (!uuidSchema.safeParse(candidateId).success) {
      this.logger.warn('Rejected malformed tenant selector', {
        userId: auth.userId,
        source: hint ? 'header' : 'token',
      });
      throw Errors.badRequest('Invalid store selection');
    }

    if (!auth.isSuperAdmin) {
      // Rule 3 — the authoritative check.
      const membership = await this.memberships.find(auth.userId, candidateId);
      if (!membership) {
        this.logger.warn('Rejected tenant access without membership', {
          userId: auth.userId,
          requestedTenantId: candidateId,
          source: hint ? 'header' : 'token',
        });
        throw Errors.tenantMembershipRequired();
      }
    }

    const resolved = await this.resolver.resolveById(candidateId);
    if (!resolved) throw Errors.tenantNotFound();

    return { ...resolved, source: hint ? 'HEADER' : 'TOKEN' };
  }

  private assertUsable(tenant: TenantContextData): void {
    switch (tenant.status) {
      case TenantStatus.ACTIVE:
        return;
      case TenantStatus.PROVISIONING:
        throw Errors.tenantProvisioning();
      case TenantStatus.SUSPENDED:
        throw Errors.tenantSuspended();
      case TenantStatus.DELETING:
      case TenantStatus.DELETED:
        throw Errors.tenantNotFound(tenant.hostname ?? undefined);
      default:
        throw Errors.tenantNotFound();
    }
  }
}
