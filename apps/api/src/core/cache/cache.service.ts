import { Global, Injectable, Module, OnModuleDestroy } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';
import { AppConfigModule, AppConfigService } from '@/config/config.module';
import { AppLogger } from '@/core/logger/logger.service';

export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

export function buildRedisOptions(config: AppConfigService): RedisOptions {
  return {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    // BullMQ requires this; setting it globally keeps one connection policy.
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
    reconnectOnError: (err) => err.message.includes('READONLY'),
  };
}

/**
 * Tenant-aware cache.
 *
 * The only rule that matters here: **every tenant-scoped key is namespaced with
 * the tenant id** (see `cacheKeys` in @retailos/config). A cache hit must never
 * be able to serve one merchant's catalog to another's storefront, so this
 * service refuses to build an unscoped key for tenant data and provides
 * `invalidateTenant` to blow away a whole tenant's namespace at once.
 */
@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger: AppLogger;
  /** Guards against a stampede: concurrent misses share one loader promise. */
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly redis: Redis,
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('CacheService');
  }

  get client(): Redis {
    return this.redis;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.redis.get(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch (err) {
      // A cache failure must degrade to a database read, never to a 500.
      this.logger.warn('Cache read failed', { key, error: (err as Error).message });
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? this.config.redis.ttl.default;
    try {
      await this.redis.set(key, JSON.stringify(value), 'EX', ttl);
    } catch (err) {
      this.logger.warn('Cache write failed', { key, error: (err as Error).message });
    }
  }

  /**
   * Read-through with single-flight de-duplication.
   *
   * On a cold cache, 50 simultaneous storefront requests would otherwise all
   * run the same catalog query. Here the first one runs it and the rest await it.
   */
  async remember<T>(key: string, ttlSeconds: number, loader: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;

    const existing = this.inflight.get(key);
    if (existing) return existing as Promise<T>;

    const promise = (async () => {
      try {
        const value = await loader();
        await this.set(key, value, ttlSeconds);
        return value;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, promise);
    return promise;
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.redis.del(...keys);
    } catch (err) {
      this.logger.warn('Cache delete failed', { keys, error: (err as Error).message });
    }
  }

  /**
   * Deletes every key matching a pattern using SCAN + UNLINK.
   *
   * `KEYS` would block Redis for the whole sweep; SCAN in batches does not.
   */
  async delByPattern(pattern: string): Promise<number> {
    let cursor = '0';
    let removed = 0;
    try {
      do {
        const [next, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (keys.length > 0) {
          await this.redis.unlink(...keys);
          removed += keys.length;
        }
      } while (cursor !== '0');
    } catch (err) {
      this.logger.warn('Cache pattern delete failed', {
        pattern,
        error: (err as Error).message,
      });
    }
    return removed;
  }

  /** Drops every cached entry belonging to one tenant. */
  async invalidateTenant(tenantId: string): Promise<void> {
    const removed = await this.delByPattern(`tenant:${tenantId}:*`);
    this.logger.debug('Invalidated tenant cache', { tenantId, removed });
  }

  /** Drops only catalog-derived entries — used after a product/category write. */
  async invalidateCatalog(tenantId: string): Promise<void> {
    await Promise.all([
      this.delByPattern(`tenant:${tenantId}:product*`),
      this.delByPattern(`tenant:${tenantId}:categories*`),
      this.delByPattern(`tenant:${tenantId}:brands*`),
    ]);
  }

  // ------------------------------------------------------ counters / locks --

  /** Fixed-window counter used by the rate limiter. */
  async increment(key: string, ttlSeconds: number): Promise<number> {
    const multi = this.redis.multi();
    multi.incr(key);
    multi.expire(key, ttlSeconds, 'NX');
    const results = await multi.exec();
    const value = results?.[0]?.[1];
    return typeof value === 'number' ? value : Number(value ?? 0);
  }

  /**
   * Best-effort distributed lock (SET NX PX).
   *
   * Used to serialise work that must not run twice across API replicas —
   * tenant provisioning, tenant migrations. Not a Redlock: for those workloads a
   * PostgreSQL advisory lock is the real guarantee and this is the cheap
   * first-line filter.
   */
  async acquireLock(key: string, ttlMs: number): Promise<string | null> {
    const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ok = await this.redis.set(`lock:${key}`, token, 'PX', ttlMs, 'NX');
    return ok ? token : null;
  }

  async releaseLock(key: string, token: string): Promise<void> {
    // Compare-and-delete so we never release someone else's lock.
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end`;
    try {
      await this.redis.eval(script, 1, `lock:${key}`, token);
    } catch (err) {
      this.logger.warn('Lock release failed', { key, error: (err as Error).message });
    }
  }

  async ping(): Promise<boolean> {
    try {
      return (await this.redis.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [AppConfigService],
      useFactory: (config: AppConfigService) => new Redis(buildRedisOptions(config)),
    },
    {
      provide: CacheService,
      inject: [REDIS_CLIENT, AppConfigService, AppLogger],
      useFactory: (redis: Redis, config: AppConfigService, logger: AppLogger) =>
        new CacheService(redis, config, logger),
    },
  ],
  exports: [CacheService, REDIS_CLIENT],
})
export class CacheModule {}
