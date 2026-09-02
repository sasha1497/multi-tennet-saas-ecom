import { Injectable } from '@nestjs/common';
import { cacheKeys } from '@retailos/config';
import { Role, permissionsForRole } from '@retailos/types';
import { CacheService } from '@/core/cache/cache.service';
import { MasterPrismaService } from '@/core/database/master-prisma.service';

export interface Membership {
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
  tenantStatus: string;
  userId: string;
  role: Role;
  permissions: string[];
  isActive: boolean;
  isDefault: boolean;
}

/**
 * Answers the one question that makes multi-tenant authorisation safe:
 * *may this user act inside this tenant, and with what powers?*
 *
 * Every merchant-console request runs through here. It is deliberately a fresh
 * check against the master database (cached briefly in Redis) rather than
 * trusting the token's claims alone — so revoking a staff member's access takes
 * effect within seconds instead of waiting out their access-token TTL.
 */
@Injectable()
export class MembershipService {
  /** Short TTL: long enough to matter under load, short enough that a revoke lands fast. */
  private static readonly CACHE_TTL_SECONDS = 30;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly cache: CacheService,
  ) {}

  async find(userId: string, tenantId: string): Promise<Membership | null> {
    const key = cacheKeys.membership(userId, tenantId);
    const cached = await this.cache.get<Membership | { none: true }>(key);
    if (cached) return 'none' in cached ? null : cached;

    const row = await this.master.tenantUser.findUnique({
      where: { tenantId_userId: { tenantId, userId } },
      select: {
        userId: true,
        role: true,
        extraPermissions: true,
        isActive: true,
        isDefault: true,
        tenant: { select: { id: true, slug: true, name: true, status: true, deletedAt: true } },
      },
    });

    if (!row || !row.isActive || row.tenant.deletedAt) {
      await this.cache.set(key, { none: true }, MembershipService.CACHE_TTL_SECONDS);
      return null;
    }

    const membership: Membership = {
      tenantId: row.tenant.id,
      tenantSlug: row.tenant.slug,
      tenantName: row.tenant.name,
      tenantStatus: row.tenant.status,
      userId: row.userId,
      role: row.role as Role,
      permissions: permissionsForRole(row.role as Role, row.extraPermissions),
      isActive: row.isActive,
      isDefault: row.isDefault,
    };

    await this.cache.set(key, membership, MembershipService.CACHE_TTL_SECONDS);
    return membership;
  }

  /** Every tenant this user can manage — powers the console's store switcher. */
  async listForUser(userId: string): Promise<Membership[]> {
    const rows = await this.master.tenantUser.findMany({
      where: {
        userId,
        isActive: true,
        tenant: { deletedAt: null, status: { not: 'DELETED' } },
      },
      select: {
        userId: true,
        role: true,
        extraPermissions: true,
        isActive: true,
        isDefault: true,
        tenant: { select: { id: true, slug: true, name: true, status: true } },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });

    return rows.map((row) => ({
      tenantId: row.tenant.id,
      tenantSlug: row.tenant.slug,
      tenantName: row.tenant.name,
      tenantStatus: row.tenant.status,
      userId: row.userId,
      role: row.role as Role,
      permissions: permissionsForRole(row.role as Role, row.extraPermissions),
      isActive: row.isActive,
      isDefault: row.isDefault,
    }));
  }

  /** Called on any membership, role or permission change. */
  async invalidate(userId: string, tenantId?: string): Promise<void> {
    if (tenantId) {
      await this.cache.del(cacheKeys.membership(userId, tenantId));
    } else {
      await this.cache.delByPattern(`member:${userId}:*`);
    }
  }

  async invalidateTenant(tenantId: string): Promise<void> {
    await this.cache.delByPattern(`member:*:${tenantId}`);
  }
}
