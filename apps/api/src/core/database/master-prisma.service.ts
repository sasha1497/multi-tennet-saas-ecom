import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { MasterPrismaClient } from '@retailos/database';
import { AppConfigService } from '@/config/config.module';
import { AppLogger } from '@/core/logger/logger.service';

/**
 * The single control-plane database connection for this process.
 *
 * Unlike tenant clients (one per tenant, created on demand), exactly one master
 * client exists per process and lives for the lifetime of the app.
 */
@Injectable()
export class MasterPrismaService extends MasterPrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger: AppLogger;

  constructor(config: AppConfigService, logger: AppLogger) {
    super({
      datasources: { db: { url: config.masterDb.url } },
      log: config.isDev
        ? [{ emit: 'event', level: 'warn' }, { emit: 'event', level: 'error' }]
        : [{ emit: 'event', level: 'error' }],
    });
    this.logger = logger.withContext('MasterPrisma');

    // Prisma's typed event map does not model the dynamic `log` array, so these
    // two subscriptions need a narrow cast.
    const emitter = this as unknown as {
      $on(event: 'warn' | 'error', cb: (e: { message: string }) => void): void;
    };
    emitter.$on('warn', (e) => this.logger.warn('Prisma warning', { message: e.message }));
    emitter.$on('error', (e) => this.logger.error('Prisma error', undefined, { message: e.message }));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.info('Master database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.info('Master database disconnected');
  }

  /** Cheap liveness probe used by /health/ready. */
  async healthCheck(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const started = Date.now();
    try {
      await this.$queryRaw`SELECT 1`;
      return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
      return { ok: false, latencyMs: Date.now() - started, error: (err as Error).message };
    }
  }
}
