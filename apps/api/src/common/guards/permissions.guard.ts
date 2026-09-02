import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Permission, Role, hasAnyPermission } from '@retailos/types';
import { METADATA } from '@/common/decorators';
import { Errors } from '@/common/errors/app.exception';
import { MembershipService } from '@/core/tenant/membership.service';
import type { AuthContextData, TenantContextData } from '@/core/context/request-context';

/**
 * RBAC enforcement.
 *
 * Permissions come from the **live membership** when a tenant is in play, not
 * from the token's baked-in `perms` claim. That matters: demoting a manager to
 * staff takes effect on their next request rather than up to 15 minutes later
 * when their access token expires.
 *
 * Runs after `TenantGuard`, so by the time we get here the tenant is verified.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: MembershipService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const handler = ctx.getHandler();
    const controller = ctx.getClass();

    const all = this.reflector.getAllAndOverride<Permission[]>(METADATA.PERMISSIONS, [
      handler,
      controller,
    ]);
    const any = this.reflector.getAllAndOverride<Permission[]>(METADATA.ANY_PERMISSION, [
      handler,
      controller,
    ]);
    const roles = this.reflector.getAllAndOverride<Role[]>(METADATA.ROLES, [handler, controller]);
    const superAdminOnly = this.reflector.getAllAndOverride<boolean>(METADATA.SUPER_ADMIN, [
      handler,
      controller,
    ]);

    if (!all?.length && !any?.length && !roles?.length && !superAdminOnly) return true;

    const req = ctx.switchToHttp().getRequest<
      Request & { auth?: AuthContextData; tenant?: TenantContextData }
    >();
    const auth = req.auth;
    if (!auth) throw Errors.unauthenticated();

    if (superAdminOnly && !auth.isSuperAdmin) {
      throw Errors.forbidden('This action is restricted to platform administrators');
    }

    // A super admin holds every permission by construction.
    if (auth.isSuperAdmin) return true;

    const { role, permissions } = await this.effectiveGrants(auth, req.tenant ?? null);

    if (roles?.length && !roles.includes(role)) {
      throw Errors.forbidden('Your role does not allow this action');
    }

    if (all?.length && !all.every((p) => permissions.includes(p))) {
      throw Errors.insufficientPermissions(all);
    }

    if (any?.length && !hasAnyPermission(permissions, any)) {
      throw Errors.insufficientPermissions(any);
    }

    return true;
  }

  /**
   * Live grants for this (user, tenant) pair. Falls back to the token claims
   * only for tenant-less routes, where there is no membership to read.
   */
  private async effectiveGrants(
    auth: AuthContextData,
    tenant: TenantContextData | null,
  ): Promise<{ role: Role; permissions: string[] }> {
    if (!tenant) {
      return { role: auth.role, permissions: auth.permissions };
    }

    const membership = await this.memberships.find(auth.userId, tenant.tenantId);
    if (!membership) throw Errors.tenantMembershipRequired();

    return { role: membership.role, permissions: membership.permissions };
  }
}
