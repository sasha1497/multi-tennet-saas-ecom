import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { HEADERS } from '@retailos/config';
import { AccessTokenClaims, Role, TokenAudience } from '@retailos/types';
import { AppConfigService } from '@/config/config.module';
import { METADATA } from '@/common/decorators';
import { Errors } from '@/common/errors/app.exception';
import { RequestContextService, type AuthContextData } from '@/core/context/request-context';
import { TokenHasher } from '@/core/security/credential-cipher.service';

/**
 * Global authentication guard — **deny by default**.
 *
 * Every route requires a valid access token unless it carries `@Public()`.
 * Making this the default (rather than opting routes in) means a newly added
 * controller is private until someone deliberately opens it, which is the
 * failure mode you want.
 *
 * Responsibilities, in order:
 *   1. verify the JWT signature, issuer and expiry
 *   2. enforce the token *audience* (admin console vs shopper)
 *   3. publish the principal into both the request object and the ALS context
 *
 * Authorisation — permissions, tenant membership — is deliberately NOT done
 * here; see `TenantGuard` and `PermissionsGuard`.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly context: RequestContextService,
    private readonly hasher: TokenHasher,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const handler = ctx.getHandler();
    const controller = ctx.getClass();
    const req = ctx.switchToHttp().getRequest<Request & { auth?: AuthContextData }>();

    const isInternal = this.reflector.getAllAndOverride<boolean>(METADATA.INTERNAL, [
      handler,
      controller,
    ]);
    if (isInternal) return this.checkInternalKey(req);

    const isPublic = this.reflector.getAllAndOverride<boolean>(METADATA.PUBLIC, [
      handler,
      controller,
    ]);

    const token = extractBearer(req);

    // Public routes still parse a token when one is present, so a storefront
    // page can personalise itself (wishlist state, "your orders") without
    // becoming a protected route.
    if (!token) {
      if (isPublic) return true;
      throw Errors.unauthenticated();
    }

    let claims: AccessTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<AccessTokenClaims>(token, {
        secret: this.config.auth.accessSecret,
        issuer: this.config.auth.issuer,
      });
    } catch (err) {
      if (isPublic) return true;
      const name = (err as Error)?.name;
      throw name === 'TokenExpiredError' ? Errors.tokenExpired() : Errors.tokenInvalid();
    }

    if (!claims.sub || !claims.aud || !claims.sid) {
      if (isPublic) return true;
      throw Errors.tokenInvalid('Malformed token');
    }

    const auth: AuthContextData = {
      userId: claims.sub,
      audience: claims.aud,
      role: (claims.role ?? 'CUSTOMER') as Role,
      permissions: Array.isArray(claims.perms) ? claims.perms : [],
      sessionId: claims.sid,
      email: claims.email ?? null,
      tokenTenantId: claims.tid ?? null,
      isSuperAdmin: claims.role === 'SUPER_ADMIN',
    };

    // Audience separation. A shopper's token must never satisfy a merchant route.
    const requiredAudience = this.reflector.getAllAndOverride<TokenAudience>(METADATA.AUDIENCE, [
      handler,
      controller,
    ]);
    if (requiredAudience && auth.audience !== requiredAudience) {
      if (isPublic) return true;
      throw Errors.forbidden('This endpoint is not available for your account type');
    }

    req.auth = auth;
    this.context.setAuth(auth);
    return true;
  }

  /**
   * Service-to-service authentication for internal routes (worker → API).
   * Compared in constant time so the key cannot be recovered by timing.
   */
  private checkInternalKey(req: Request): boolean {
    const provided = req.header(HEADERS.INTERNAL_API_KEY);
    if (!provided || !this.hasher.safeEqual(provided, this.config.crypto.internalApiKey)) {
      throw Errors.unauthenticated('Invalid internal API key');
    }
    return true;
  }
}

function extractBearer(req: Request): string | null {
  const header = req.header('authorization');
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !value) return null;
  const token = value.trim();
  // Bound the length before handing it to the JWT verifier.
  return token.length > 0 && token.length < 4096 ? token : null;
}
