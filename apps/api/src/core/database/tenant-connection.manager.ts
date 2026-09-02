import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { TenantPrismaClient, buildTenantDatabaseUrl } from '@retailos/database';
import { AppConfigService } from '@/config/config.module';
import { AppLogger } from '@/core/logger/logger.service';
import { CredentialCipherService } from '@/core/security/credential-cipher.service';
import { Errors } from '@/common/errors/app.exception';
import { MasterPrismaService } from './master-prisma.service';

interface PooledClient {
  client: TenantPrismaClient;
  tenantId: string;
  databaseName: string;
  lastUsedAt: number;
  /** In-flight operations; a client is never evicted while this is > 0. */
  activeOperations: number;
  createdAt: number;
}

export interface TenantConnectionInfo {
  tenantId: string;
  clusterId: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  password: string;
}

/**
 * Owns the lifecycle of per-tenant database connections.
 *
 * This is the piece that makes database-per-tenant practical. The naive
 * implementation — a new PrismaClient per request — would open and tear down a
 * connection pool on every call and exhaust PostgreSQL's `max_connections`
 * within minutes. Instead:
 *
 *   • one client per *active* tenant, reused across requests
 *   • an LRU bound (`TENANT_POOL_MAX_CONNECTIONS`) on how many are open at once
 *   • idle eviction after `TENANT_POOL_IDLE_TIMEOUT_MS`, with `$disconnect()`
 *   • a small per-client pool (`TENANT_DB_CONNECTION_LIMIT`), because N tenants
 *     × M connections is what actually hits the server limit
 *   • clients are never handed out for a suspended or unprovisioned tenant
 *
 * Connections are keyed strictly by tenant id and are never shared, so one
 * request can never end up holding another tenant's client.
 *
 * See docs/TENANCY.md §Connection strategy and DECISION_LOG.md ADR-005.
 */
@Injectable()
export class TenantConnectionManager implements OnModuleDestroy {
  private readonly logger: AppLogger;
  private readonly pool = new Map<string, PooledClient>();
  /** De-duplicates concurrent first-time connections for the same tenant. */
  private readonly connecting = new Map<string, Promise<TenantPrismaClient>>();
  private sweeper: NodeJS.Timeout | null = null;
  private destroyed = false;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly config: AppConfigService,
    private readonly cipher: CredentialCipherService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('TenantConnectionManager');
    this.startSweeper();
  }

  /**
   * Returns a Prisma client bound to one tenant's database.
   *
   * Callers should prefer `TenantDatabaseService.run()`, which also marks the
   * client busy so the sweeper cannot disconnect it mid-query.
   */
  async getClient(tenantId: string): Promise<TenantPrismaClient> {
    if (this.destroyed) throw Errors.serviceUnavailable('Server is shutting down');

    const pooled = this.pool.get(tenantId);
    if (pooled) {
      pooled.lastUsedAt = Date.now();
      return pooled.client;
    }

    const pending = this.connecting.get(tenantId);
    if (pending) return pending;

    const promise = this.connect(tenantId).finally(() => this.connecting.delete(tenantId));
    this.connecting.set(tenantId, promise);
    return promise;
  }

  /**
   * Runs `fn` with the tenant's client, holding it open for the duration.
   *
   * The busy counter is what makes eviction safe under load: a long report query
   * cannot have its connection pulled out from under it.
   */
  async run<T>(tenantId: string, fn: (db: TenantPrismaClient) => Promise<T>): Promise<T> {
    const client = await this.getClient(tenantId);
    const pooled = this.pool.get(tenantId);
    if (pooled) {
      pooled.activeOperations++;
      pooled.lastUsedAt = Date.now();
    }
    try {
      return await fn(client);
    } finally {
      if (pooled) {
        pooled.activeOperations = Math.max(0, pooled.activeOperations - 1);
        pooled.lastUsedAt = Date.now();
      }
    }
  }

  private async connect(tenantId: string): Promise<TenantPrismaClient> {
    const info = await this.resolveConnectionInfo(tenantId);

    // Make room *before* opening a new pool, not after.
    await this.enforcePoolLimit();

    const url = buildTenantDatabaseUrl({
      host: info.host,
      port: info.port,
      database: info.databaseName,
      username: info.username,
      password: info.password,
      connectionLimit: this.config.tenantDb.connectionLimit,
      ssl: this.config.tenantDb.ssl,
    });

    const client = new TenantPrismaClient({
      datasources: { db: { url } },
      log: this.config.isDev ? ['error'] : ['error'],
    });

    try {
      await client.$connect();
    } catch (err) {
      await client.$disconnect().catch(() => undefined);
      this.logger.error('Failed to connect to tenant database', err as Error, {
        tenantId,
        databaseName: info.databaseName,
      });
      throw Errors.serviceUnavailable('This store is temporarily unavailable');
    }

    this.pool.set(tenantId, {
      client,
      tenantId,
      databaseName: info.databaseName,
      lastUsedAt: Date.now(),
      createdAt: Date.now(),
      activeOperations: 0,
    });

    this.logger.debug('Opened tenant connection', {
      tenantId,
      databaseName: info.databaseName,
      openConnections: this.pool.size,
    });

    return client;
  }

  /**
   * Reads placement + credentials from the master registry.
   *
   * Deliberately NOT cached in Redis: these are decrypted credentials, and the
   * lookup only happens on a pool miss, which is rare.
   */
  async resolveConnectionInfo(tenantId: string): Promise<TenantConnectionInfo> {
    const record = await this.master.tenantDatabase.findUnique({
      where: { tenantId },
      select: {
        tenantId: true,
        clusterId: true,
        host: true,
        port: true,
        databaseName: true,
        username: true,
        encryptedPassword: true,
        status: true,
      },
    });

    if (!record) {
      throw Errors.internal('Tenant database is not registered', { tenantId });
    }
    if (record.status !== 'READY') {
      // A tenant mid-provision has a row but no usable schema yet.
      throw Errors.tenantProvisioning();
    }

    return {
      tenantId: record.tenantId,
      clusterId: record.clusterId,
      host: record.host,
      port: record.port,
      databaseName: record.databaseName,
      username: record.username,
      password: this.cipher.decrypt(record.encryptedPassword),
    };
  }

  /** Closes and forgets one tenant's client — used on suspend/delete/migrate. */
  async evict(tenantId: string): Promise<void> {
    const pooled = this.pool.get(tenantId);
    if (!pooled) return;
    this.pool.delete(tenantId);
    try {
      await pooled.client.$disconnect();
      this.logger.debug('Evicted tenant connection', { tenantId });
    } catch (err) {
      this.logger.warn('Error disconnecting tenant client', {
        tenantId,
        error: (err as Error).message,
      });
    }
  }

  /** Evicts the least-recently-used idle client when the pool is full. */
  private async enforcePoolLimit(): Promise<void> {
    const max = this.config.tenantDb.poolMaxConnections;
    if (this.pool.size < max) return;

    const idle = [...this.pool.values()]
      .filter((p) => p.activeOperations === 0)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

    if (idle.length === 0) {
      // Everything is busy. Rejecting is better than silently blowing past the
      // PostgreSQL connection limit and taking down every tenant at once.
      this.logger.warn('Tenant connection pool exhausted', { max, size: this.pool.size });
      throw Errors.serviceUnavailable('Server is busy, please retry in a moment');
    }

    await this.evict(idle[0].tenantId);
  }

  private startSweeper(): void {
    const idleTimeout = this.config.tenantDb.poolIdleTimeoutMs;
    const interval = Math.max(30_000, Math.floor(idleTimeout / 4));

    this.sweeper = setInterval(() => {
      const cutoff = Date.now() - idleTimeout;
      const stale = [...this.pool.values()].filter(
        (p) => p.activeOperations === 0 && p.lastUsedAt < cutoff,
      );
      for (const p of stale) {
        void this.evict(p.tenantId);
      }
    }, interval);

    // Do not hold the event loop open on shutdown.
    this.sweeper.unref?.();
  }

  /** Snapshot for /health and the platform console's system page. */
  stats(): {
    openConnections: number;
    maxConnections: number;
    busy: number;
    tenants: { tenantId: string; databaseName: string; idleMs: number; busy: number }[];
  } {
    const now = Date.now();
    return {
      openConnections: this.pool.size,
      maxConnections: this.config.tenantDb.poolMaxConnections,
      busy: [...this.pool.values()].filter((p) => p.activeOperations > 0).length,
      tenants: [...this.pool.values()].map((p) => ({
        tenantId: p.tenantId,
        databaseName: p.databaseName,
        idleMs: now - p.lastUsedAt,
        busy: p.activeOperations,
      })),
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;
    if (this.sweeper) clearInterval(this.sweeper);
    const tenants = [...this.pool.keys()];
    await Promise.all(tenants.map((id) => this.evict(id)));
    this.logger.info('Closed all tenant connections', { count: tenants.length });
  }
}
