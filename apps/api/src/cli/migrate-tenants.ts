import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppConfigModule } from '@/config/config.module';
import { CacheModule } from '@/core/cache/cache.service';
import { DatabaseModule } from '@/core/database/database.module';
import { LoggerModule } from '@/core/logger/logger.service';
import { ObservabilityModule } from '@/core/observability/metrics.service';
import { QueueModule } from '@/core/queue/queue.module';
import { SecurityModule } from '@/core/security/security.module';
import { StorageModule } from '@/core/storage/storage.service';
import { TenantModule } from '@/core/tenant/tenant.module';
import { AuditModule } from '@/modules/audit/audit.service';
import { EntitlementsModule } from '@/modules/entitlements/entitlements.module';
import { TenantsModule } from '@/modules/tenants/tenants.module';
import { TenantProvisioningService } from '@/modules/tenants/tenant-provisioning.service';
import { TenantMigrationRunner } from '@/core/database/tenant-migration.runner';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { Module } from '@nestjs/common';
import { installBigIntSerializer } from '@/common/utils/serialization';

installBigIntSerializer();

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
  ],
})
class MigrateModule {}

/**
 * Fleet migration CLI.
 *
 * With database-per-tenant, a schema change has to reach N databases. This walks
 * them sequentially — parallel DDL across a whole fleet is a reliable way to
 * saturate a database server — and reports exactly which tenants moved.
 *
 *   pnpm db:tenant:migrate            # every ACTIVE tenant
 *   pnpm db:tenant:migrate --status   # report drift without changing anything
 *   pnpm db:tenant:migrate <tenantId> # one tenant
 */
async function main(): Promise<void> {
  const app = await NestFactory.createApplicationContext(MigrateModule, { bufferLogs: false });

  const provisioning = app.get(TenantProvisioningService);
  const runner = app.get(TenantMigrationRunner);
  const master = app.get(MasterPrismaService);

  const args = process.argv.slice(2);
  const statusOnly = args.includes('--status');
  const explicitTenant = args.find((a) => !a.startsWith('--'));

  console.log(`\nLatest tenant schema version: ${runner.latestVersion}\n`);

  try {
    if (statusOnly) {
      const databases = await master.tenantDatabase.findMany({
        where: { status: 'READY' },
        include: { tenant: { select: { slug: true, name: true } } },
      });

      let behind = 0;
      for (const db of databases) {
        const status = await runner.status(db.databaseName);
        const marker = status.upToDate ? '✓' : '✗';
        if (!status.upToDate) behind++;
        console.log(
          `  ${marker} ${db.tenant.slug.padEnd(20)} ${String(status.schemaVersion ?? 'none').padEnd(32)}` +
            (status.pending.length ? ` pending: ${status.pending.join(', ')}` : ''),
        );
      }
      console.log(`\n${databases.length} tenant database(s), ${behind} behind.\n`);
      return;
    }

    if (explicitTenant) {
      const result = await provisioning.migrateTenant(explicitTenant);
      console.log(
        result.applied.length
          ? `Applied ${result.applied.length} migration(s): ${result.applied.join(', ')}`
          : 'Already up to date.',
      );
      return;
    }

    const result = await provisioning.migrateAllTenants();
    console.log(`\nMigrated ${result.migrated} tenant database(s).`);
    if (result.failed.length) {
      console.error(`\n${result.failed.length} failure(s):`);
      for (const f of result.failed) console.error(`  ✗ ${f.tenantId}: ${f.error}`);
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Tenant migration failed:', err);
  process.exit(1);
});
