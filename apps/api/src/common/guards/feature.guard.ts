import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { METADATA } from '@/common/decorators';
import { Errors } from '@/common/errors/app.exception';
import { EntitlementsService } from '@/modules/entitlements/entitlements.service';
import type { AuthContextData, TenantContextData } from '@/core/context/request-context';

/**
 * Plan-based feature gating.
 *
 * Keeps subscription logic out of business services: a route simply declares
 * `@RequireFeature(FeatureKey.ADVANCED_ANALYTICS)` and the guard consults the
 * tenant's effective entitlements (plan defaults plus any per-tenant override).
 */
@Injectable()
export class FeatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const featureKey = this.reflector.getAllAndOverride<string>(METADATA.FEATURE, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!featureKey) return true;

    const req = ctx.switchToHttp().getRequest<
      Request & { auth?: AuthContextData; tenant?: TenantContextData }
    >();

    // Platform admins are not billed and are never blocked by entitlements.
    if (req.auth?.isSuperAdmin) return true;

    const tenantId = req.tenant?.tenantId;
    if (!tenantId) throw Errors.tenantNotFound();

    const enabled = await this.entitlements.isFeatureEnabled(tenantId, featureKey);
    if (!enabled) throw Errors.featureNotEntitled(featureKey);

    return true;
  }
}
