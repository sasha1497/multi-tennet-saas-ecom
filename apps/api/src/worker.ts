import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AppConfigModule } from '@/config/config.module';
import { CacheModule } from '@/core/cache/cache.service';
import { DatabaseModule } from '@/core/database/database.module';
import { LoggerModule } from '@/core/logger/logger.service';
import { ObservabilityModule } from '@/core/observability/metrics.service';
import { QueueModule } from '@/core/queue/queue.module';
import { SecurityModule } from '@/core/security/security.module';
import { StorageModule } from '@/core/storage/storage.service';
import { TenantModule } from '@/core/tenant/tenant.module';
import { AppLogger } from '@/core/logger/logger.service';
import { AuditModule } from '@/modules/audit/audit.service';
import { EntitlementsModule } from '@/modules/entitlements/entitlements.module';
import { TenantsModule } from '@/modules/tenants/tenants.module';
import {
  CartModule,
  CatalogModule,
  CouponsModule,
  InventoryModule,
  NotificationsModule,
  OrdersModule,
  PaymentsModule,
  StoreModule,
} from '@/modules/feature.modules';
import { MaintenanceProcessor } from '@/worker/maintenance.processor';
import { NotificationsProcessor } from '@/worker/notifications.processor';
import { ProvisioningProcessor } from '@/worker/provisioning.processor';
import { installBigIntSerializer } from '@/common/utils/serialization';

installBigIntSerializer();

/**
 * Worker process.
 *
 * A separate entrypoint from the API, sharing the same codebase and modules but
 * registering **consumers** instead of an HTTP server. Requirement §13 asks for
 * exactly this split: the API stays responsive because none of the slow work —
 * email, SMS, push, tenant provisioning, report generation, housekeeping — runs
 * inside a request.
 *
 * Scale the two independently: more API replicas for traffic, more workers for
 * a provisioning backlog.
 */
@Module({
  imports: [
    AppConfigModule,
    LoggerModule,
    ObservabilityModule,
    SecurityModule,
    CacheModule,
    DatabaseModule,
    TenantModule,
    QueueModule,
    StorageModule,
    AuditModule,
    EntitlementsModule,
    TenantsModule,
    ScheduleModule.forRoot(),

    CatalogModule,
    InventoryModule,
    StoreModule,
    CouponsModule,
    CartModule,
    NotificationsModule,
    OrdersModule,
    PaymentsModule,
  ],
  providers: [
    NotificationsProcessor,
    ProvisioningProcessor,
    MaintenanceProcessor,
  ],
})
export class WorkerModule {}

async function bootstrap(): Promise<void> {
  // `createApplicationContext` starts DI and the BullMQ consumers without
  // opening a port — the worker has no HTTP surface to attack.
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });

  const logger = app.get(AppLogger).withContext('Worker');
  app.useLogger(logger);
  app.enableShutdownHooks();

  logger.info('Worker started', {
    queues: ['notifications', 'provisioning', 'images', 'reports', 'maintenance'],
    pid: process.pid,
  });

  const shutdown = async (signal: string) => {
    logger.info('Worker shutting down', { signal });
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  console.error('Failed to start the worker:', err);
  process.exit(1);
});
