import { Injectable } from '@nestjs/common';
import { cacheKeys, normaliseHostname, resolveHost } from '@retailos/config';
import type { TenantStatus } from '@retailos/types';
import { AppConfigService } from '@/config/config.module';
import { CacheService } from '@/core/cache/cache.service';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { AppLogger } from '@/core/logger/logger.service';

export interface ResolvedTenant {
  tenantId: string;
  slug: string;
  name: string;
  status: TenantStatus;
  hostname: string;
}

/** Cached negative result, so a hostile scan of random subdomains cannot hammer the DB. */
type CachedResolution = ResolvedTenant | { notFound: true };

/**
 * Turns a hostname into a tenant.
 *
 * This is the single trusted entry point for tenant identity. The flow is:
 *
 *   Host header
 *     → normalise (lowercase, strip port)
 *     → structural parse (is this even a tenant subdomain?)
 *     → **master `domains` table lookup**   ← the authoritative step
 *     → tenant id + status
 *
 * The parse step is only a fast filter; it never grants anything. A hostname is
 * a tenant only if a row exists in `domains`, which is why a merchant cannot
 * claim another's store by spoofing a Host header — there is no such row.
 *
 * Results are cached in Redis (`domain:<hostname>`), including misses, and
 * invalidated whenever a domain or tenant status changes.
 */
@Injectable()
export class TenantResolverService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly cache: CacheService,
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('TenantResolver');
  }

  /**
   * Resolves a raw Host header. Returns null when the host is not a tenant
   * (the API domain, the admin console, or an unknown hostname).
   */
  async resolveByHostname(rawHost: string | null | undefined): Promise<ResolvedTenant | null> {
    const hostname = normaliseHostname(rawHost);
    if (!hostname) return null;

    const parsed = resolveHost(hostname, this.config.domain);
    // `admin.`/`api.`/root are structurally not tenants — skip the lookup.
    if (parsed.kind === 'admin' || parsed.kind === 'api' || parsed.kind === 'root') return null;
    if (parsed.kind === 'unknown') return null;

    return this.lookupHostname(hostname);
  }

  /**
   * Resolves a slug supplied by a client that has no tenant hostname — today
   * only the mobile app in development, which talks to a LAN IP.
   *
   * This is exactly as trustworthy as the Host header: it identifies *which*
   * public storefront to serve and grants nothing. Every authenticated action is
   * still gated on a token whose `tid` must match the tenant resolved here.
   */
  async resolveBySlug(slug: string | null | undefined): Promise<ResolvedTenant | null> {
    if (!slug) return null;
    const clean = slug.trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(clean)) return null;
    // Go through the domain table by the canonical subdomain, so slug and
    // hostname resolution share one code path and one cache.
    return this.lookupHostname(`${clean}.${normaliseHostname(this.config.domain.platformDomain)}`);
  }

  /** Direct lookup by id — used by workers and by the tenant guard. */
  async resolveById(tenantId: string): Promise<ResolvedTenant | null> {
    const cached = await this.cache.get<CachedResolution>(cacheKeys.tenantMeta(tenantId));
    if (cached) return 'notFound' in cached ? null : cached;

    const tenant = await this.master.tenant.findFirst({
      where: { id: tenantId, deletedAt: null },
      select: {
        id: true,
        slug: true,
        name: true,
        status: true,
        domains: { where: { isPrimary: true }, select: { hostname: true }, take: 1 },
      },
    });

    if (!tenant) {
      await this.cache.set(
        cacheKeys.tenantMeta(tenantId),
        { notFound: true },
        this.config.redis.ttl.tenantResolution,
      );
      return null;
    }

    const resolved: ResolvedTenant = {
      tenantId: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status as TenantStatus,
      hostname:
        tenant.domains[0]?.hostname ??
        `${tenant.slug}.${normaliseHostname(this.config.domain.platformDomain)}`,
    };

    await this.cache.set(
      cacheKeys.tenantMeta(tenantId),
      resolved,
      this.config.redis.ttl.tenantResolution,
    );
    return resolved;
  }

  private async lookupHostname(hostname: string): Promise<ResolvedTenant | null> {
    const key = cacheKeys.domainResolution(hostname);

    const cached = await this.cache.get<CachedResolution>(key);
    if (cached) return 'notFound' in cached ? null : cached;

    const domain = await this.master.domain.findUnique({
      where: { hostname },
      select: {
        hostname: true,
        isVerified: true,
        tenant: {
          select: { id: true, slug: true, name: true, status: true, deletedAt: true },
        },
      },
    });

    if (!domain || !domain.isVerified || !domain.tenant || domain.tenant.deletedAt) {
      // Cache the miss briefly — enough to absorb a subdomain scan, short enough
      // that a newly provisioned store appears quickly.
      await this.cache.set(key, { notFound: true }, 30);
      return null;
    }

    const resolved: ResolvedTenant = {
      tenantId: domain.tenant.id,
      slug: domain.tenant.slug,
      name: domain.tenant.name,
      status: domain.tenant.status as TenantStatus,
      hostname: domain.hostname,
    };

    await this.cache.set(key, resolved, this.config.redis.ttl.tenantResolution);
    return resolved;
  }

  /** Called whenever a tenant's status, name or domains change. */
  async invalidate(params: { tenantId?: string; hostnames?: string[] }): Promise<void> {
    const keys: string[] = [];
    if (params.tenantId) {
      keys.push(cacheKeys.tenantMeta(params.tenantId), cacheKeys.tenantDb(params.tenantId));
    }
    for (const host of params.hostnames ?? []) {
      keys.push(cacheKeys.domainResolution(normaliseHostname(host)));
    }
    if (keys.length) {
      await this.cache.del(...keys);
      this.logger.debug('Invalidated tenant resolution cache', { keys });
    }
  }

  /** Convenience: invalidate every cached entry for a tenant, including its domains. */
  async invalidateTenantCompletely(tenantId: string): Promise<void> {
    const domains = await this.master.domain.findMany({
      where: { tenantId },
      select: { hostname: true },
    });
    await this.invalidate({ tenantId, hostnames: domains.map((d) => d.hostname) });
    await this.cache.invalidateTenant(tenantId);
  }
}
