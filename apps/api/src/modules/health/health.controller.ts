import { Controller, Get, Module } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { HealthStatus } from '@retailos/types';
import { Public } from '@/common/decorators';
import { NoEnvelope } from '@/common/interceptors/transform.interceptor';
import { SkipRateLimit } from '@/common/guards/rate-limit.guard';
import { AppConfigService } from '@/config/config.module';
import { CacheService } from '@/core/cache/cache.service';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantConnectionManager } from '@/core/database/tenant-connection.manager';
import { MetricsService } from '@/core/observability/metrics.service';
import { QueueService } from '@/core/queue/queue.service';
import { StorageService } from '@/core/storage/storage.service';

const STARTED_AT = Date.now();
const VERSION = process.env.npm_package_version ?? '0.1.0';

/**
 * Health and metrics endpoints.
 *
 * Three probes with genuinely different jobs, which matters for orchestration:
 *
 *   /health/live  — is the process alive? Never touches a dependency, so a
 *                   database blip does not get the container killed.
 *   /health/ready — can it serve traffic? Checks the master DB and Redis, so a
 *                   load balancer stops routing here while they are down.
 *   /health       — the full picture, for humans and dashboards.
 *
 * All three bypass the response envelope so external probes see a plain,
 * conventional JSON body.
 */
@ApiTags('Health')
@Controller('health')
@Public()
@NoEnvelope()
@SkipRateLimit()
export class HealthController {
  constructor(
    private readonly master: MasterPrismaService,
    private readonly cache: CacheService,
    private readonly queue: QueueService,
    private readonly storage: StorageService,
    private readonly connections: TenantConnectionManager,
    private readonly metrics: MetricsService,
    private readonly config: AppConfigService,
  ) {}

  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000) };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  async ready(): Promise<{ status: 'ok' | 'error'; checks: Record<string, boolean> }> {
    const [db, redis] = await Promise.all([this.master.healthCheck(), this.cache.ping()]);
    const ok = db.ok && redis;
    return { status: ok ? 'ok' : 'error', checks: { masterDatabase: db.ok, redis } };
  }

  @Get()
  @ApiOperation({ summary: 'Full health report' })
  async health(): Promise<HealthStatus> {
    const [db, redis, queues, storage] = await Promise.all([
      this.master.healthCheck(),
      this.cache.ping(),
      this.queue.isHealthy(),
      this.storage.healthCheck(),
    ]);

    const pool = this.connections.stats();

    const details: HealthStatus['details'] = {
      masterDatabase: {
        status: db.ok ? 'up' : 'down',
        latencyMs: db.latencyMs,
        ...(db.error ? { message: db.error } : {}),
      },
      redis: { status: redis ? 'up' : 'down' },
      queues: { status: queues ? 'up' : 'down' },
      storage: {
        status: storage.ok ? 'up' : 'down',
        driver: this.config.storage.driver,
        ...(storage.message ? { message: storage.message } : {}),
      },
      tenantConnections: {
        status: 'up',
        open: pool.openConnections,
        max: pool.maxConnections,
        busy: pool.busy,
      },
    };

    const info = Object.fromEntries(Object.entries(details).filter(([, v]) => v.status === 'up'));
    const error = Object.fromEntries(
      Object.entries(details)
        .filter(([, v]) => v.status !== 'up')
        .map(([k, v]) => [k, { status: v.status, message: String(v.message ?? 'unavailable') }]),
    );

    // Storage being down degrades image uploads but not shopping, so it does not
    // flip the whole service to `error`.
    const critical = db.ok && redis;

    return {
      status: critical ? (Object.keys(error).length ? 'degraded' : 'ok') : 'error',
      info,
      error,
      details,
      uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
      version: VERSION,
    };
  }

  @Get('metrics')
  @ApiExcludeEndpoint()
  metricsSnapshot() {
    return this.metrics.snapshot();
  }
}

/**
 * The API root, `/api/v1`.
 *
 * There is no resource here, so this would otherwise be a bare 404 — which
 * reads as "the API is down" to anyone who opens the base URL in a browser to
 * check. Answering with a short index makes "is it running?" a question the
 * address itself can answer, and points at the two things people actually want.
 */
@ApiTags('Health')
@Controller()
export class ApiIndexController {
  @Get()
  @Public()
  @SkipRateLimit()
  @NoEnvelope()
  @ApiExcludeEndpoint()
  index() {
    return {
      name: 'RetailOS API',
      version: VERSION,
      status: 'ok',
      message: 'The API is running. There is no resource at this path.',
      documentation: '/docs',
      health: '/api/v1/health',
      uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    };
  }
}

@Module({
  controllers: [HealthController, ApiIndexController],
})
export class HealthModule {}
