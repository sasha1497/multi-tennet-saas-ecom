import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '@/config/config.module';
import { SecurityModule } from '@/core/security/security.module';
import { MasterPrismaService } from './master-prisma.service';
import { TenantConnectionManager } from './tenant-connection.manager';
import { TenantDatabaseService } from './tenant-database.service';
import { TenantDdlService } from './tenant-ddl.service';
import { TenantMigrationRunner } from './tenant-migration.runner';

/**
 * Database layer.
 *
 *   MasterPrismaService     — the one control-plane connection
 *   TenantConnectionManager — pooled per-tenant clients, LRU + idle eviction
 *   TenantDatabaseService   — the accessor business services use
 *   TenantDdlService        — CREATE DATABASE / CREATE ROLE (raw pg)
 *   TenantMigrationRunner   — versioned SQL migrations per tenant
 *
 * Global because virtually every feature module needs the tenant accessor.
 */
@Global()
@Module({
  imports: [AppConfigModule, SecurityModule],
  providers: [
    MasterPrismaService,
    TenantConnectionManager,
    TenantDatabaseService,
    TenantDdlService,
    TenantMigrationRunner,
  ],
  exports: [
    MasterPrismaService,
    TenantConnectionManager,
    TenantDatabaseService,
    TenantDdlService,
    TenantMigrationRunner,
  ],
})
export class DatabaseModule {}
