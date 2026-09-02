import { randomUUID } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type {
  AccessTokenClaims,
  AuthTokens,
  RefreshTokenClaims,
  Role,
  TokenAudience,
} from '@retailos/types';
import { AppConfigService } from '@/config/config.module';
import { Errors } from '@/common/errors/app.exception';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { TokenHasher } from '@/core/security/credential-cipher.service';
import { AppLogger } from '@/core/logger/logger.service';

export interface MintParams {
  userId: string;
  audience: TokenAudience;
  tenantId: string | null;
  role: Role;
  permissions: string[];
  email?: string | null;
  userAgent?: string | null;
  ipAddress?: string | null;
  /** Reuses an existing session on rotation instead of creating a new device. */
  sessionId?: string;
  version?: number;
}

/**
 * Issues, rotates and revokes tokens.
 *
 * Design (docs/AUTHENTICATION.md):
 *   • Short-lived access JWT (15 min) carrying role + permissions, so the hot
 *     path needs no database round-trip.
 *   • Long-lived refresh token, stored **hashed** and rotated on every use.
 *   • **Reuse detection**: presenting a superseded refresh token kills the whole
 *     session family. A stolen token therefore buys an attacker one refresh
 *     before the legitimate user's next refresh locks them both out — and the
 *     user sees a forced re-login, which is the signal you want.
 *
 * Console sessions live in the master DB; shopper sessions live in the tenant's
 * own DB, because customer identity is tenant-scoped.
 */
@Injectable()
export class TokenService {
  private readonly logger: AppLogger;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
    private readonly master: MasterPrismaService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly hasher: TokenHasher,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('TokenService');
  }

  async mint(params: MintParams): Promise<AuthTokens> {
    const sessionId = params.sessionId ?? randomUUID();
    const version = params.version ?? 1;

    const accessClaims: AccessTokenClaims = {
      sub: params.userId,
      aud: params.audience,
      tid: params.tenantId,
      role: params.role,
      perms: params.permissions,
      sid: sessionId,
      email: params.email ?? undefined,
    };

    const refreshClaims: RefreshTokenClaims = {
      sub: params.userId,
      aud: params.audience,
      tid: params.tenantId,
      sid: sessionId,
      ver: version,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(accessClaims, {
        secret: this.config.auth.accessSecret,
        expiresIn: this.config.auth.accessTtl,
        issuer: this.config.auth.issuer,
      }),
      this.jwt.signAsync(refreshClaims, {
        secret: this.config.auth.refreshSecret,
        expiresIn: this.config.auth.refreshTtl,
        issuer: this.config.auth.issuer,
      }),
    ]);

    await this.persistSession({
      sessionId,
      version,
      refreshToken,
      params,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: this.config.auth.accessTtl,
      tokenType: 'Bearer',
    };
  }

  /**
   * Verifies a refresh token and issues a new pair.
   *
   * The caller supplies fresh role/permission data, so a refresh also picks up
   * any authorisation change made since the last login.
   */
  async rotate(
    refreshToken: string,
    resolve: (claims: RefreshTokenClaims) => Promise<Omit<MintParams, 'sessionId' | 'version'>>,
  ): Promise<AuthTokens> {
    let claims: RefreshTokenClaims;
    try {
      claims = await this.jwt.verifyAsync<RefreshTokenClaims>(refreshToken, {
        secret: this.config.auth.refreshSecret,
        issuer: this.config.auth.issuer,
      });
    } catch (err) {
      throw (err as Error).name === 'TokenExpiredError' ? Errors.tokenExpired() : Errors.tokenInvalid();
    }

    const tokenHash = this.hasher.hashToken(refreshToken);
    const session = await this.findSession(claims, tokenHash);

    if (!session) {
      // No row for this hash: either it never existed or it has been rotated
      // away. Treat it as a possible theft and burn the family.
      await this.revokeSessionFamily(claims);
      this.logger.warn('Refresh token reuse detected', {
        userId: claims.sub,
        sessionId: claims.sid,
      });
      throw Errors.refreshReuse();
    }

    if (session.revokedAt) {
      await this.revokeSessionFamily(claims);
      throw Errors.refreshReuse();
    }

    if (session.expiresAt < new Date()) {
      throw Errors.tokenExpired();
    }

    const next = await resolve(claims);

    // Rotate: the new token supersedes this row, which is deleted so a replay of
    // the old one lands in the "no row" branch above.
    await this.consumeSession(claims, tokenHash);

    return this.mint({
      ...next,
      sessionId: claims.sid,
      version: (session.version ?? claims.ver) + 1,
    });
  }

  /** Signs out one device: revokes only the session family named by `sid`. */
  async revokeSession(params: {
    audience: TokenAudience;
    tenantId: string | null;
    sessionId: string;
    userId: string;
  }): Promise<void> {
    if (params.audience === 'admin') {
      await this.master.session.updateMany({
        where: { userId: params.userId, sessionId: params.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return;
    }

    if (!params.tenantId) return;
    await this.tenantDb.runFor(params.tenantId, (db) =>
      db.customerSession.updateMany({
        where: { customerId: params.userId, sessionId: params.sessionId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  /** Signs the user out of every device — used on password change. */
  async revokeAllForUser(params: {
    audience: TokenAudience;
    userId: string;
    tenantId: string | null;
  }): Promise<void> {
    if (params.audience === 'admin') {
      await this.master.session.updateMany({
        where: { userId: params.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return;
    }
    if (!params.tenantId) return;
    await this.tenantDb.runFor(params.tenantId, (db) =>
      db.customerSession.updateMany({
        where: { customerId: params.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    );
  }

  // ------------------------------------------------------------- internals --

  private async persistSession(input: {
    sessionId: string;
    version: number;
    refreshToken: string;
    params: MintParams;
  }): Promise<void> {
    const { params } = input;
    const tokenHash = this.hasher.hashToken(input.refreshToken);
    const expiresAt = new Date(Date.now() + this.config.auth.refreshTtl * 1000);

    if (params.audience === 'admin') {
      await this.master.session.create({
        data: {
          userId: params.userId,
          audience: 'ADMIN',
          tenantId: params.tenantId,
          sessionId: input.sessionId,
          tokenHash,
          version: input.version,
          userAgent: params.userAgent ?? null,
          ipAddress: params.ipAddress ?? null,
          expiresAt,
        },
      });
      return;
    }

    if (!params.tenantId) {
      throw Errors.internal('A customer session requires a tenant');
    }

    await this.tenantDb.runFor(params.tenantId, (db) =>
      db.customerSession.create({
        data: {
          customerId: params.userId,
          sessionId: input.sessionId,
          tokenHash,
          version: input.version,
          userAgent: params.userAgent ?? null,
          ipAddress: params.ipAddress ?? null,
          expiresAt,
        },
      }),
    );
  }

  private async findSession(
    claims: RefreshTokenClaims,
    tokenHash: string,
  ): Promise<{ version: number; revokedAt: Date | null; expiresAt: Date } | null> {
    if (claims.aud === 'admin') {
      return this.master.session.findUnique({
        where: { tokenHash },
        select: { version: true, revokedAt: true, expiresAt: true },
      });
    }
    if (!claims.tid) return null;
    return this.tenantDb.runFor(claims.tid, (db) =>
      db.customerSession.findUnique({
        where: { tokenHash },
        select: { version: true, revokedAt: true, expiresAt: true },
      }),
    );
  }

  /** Deletes the consumed row so a replay cannot find it. */
  private async consumeSession(claims: RefreshTokenClaims, tokenHash: string): Promise<void> {
    if (claims.aud === 'admin') {
      await this.master.session.deleteMany({ where: { tokenHash } });
      return;
    }
    if (!claims.tid) return;
    await this.tenantDb.runFor(claims.tid, (db) =>
      db.customerSession.deleteMany({ where: { tokenHash } }),
    );
  }

  /** Kills every live token for this session id — the reuse-detection response. */
  private async revokeSessionFamily(claims: RefreshTokenClaims): Promise<void> {
    try {
      if (claims.aud === 'admin') {
        await this.master.session.updateMany({
          where: { userId: claims.sub, sessionId: claims.sid, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        return;
      }
      if (!claims.tid) return;
      await this.tenantDb.runFor(claims.tid, (db) =>
        db.customerSession.updateMany({
          where: { customerId: claims.sub, sessionId: claims.sid, revokedAt: null },
          data: { revokedAt: new Date() },
        }),
      );
    } catch (err) {
      this.logger.error('Failed to revoke session family', err as Error, { userId: claims.sub });
    }
  }
}
