import { Injectable } from '@nestjs/common';
import type { Client as PgClient } from 'pg';
import {
  TenantMigration,
  loadTenantMigrations,
  requiresAutocommit,
  splitSqlStatements,
} from '@retailos/database';
import { AppConfigService } from '@/config/config.module';
import { AppLogger } from '@/core/logger/logger.service';
import { TenantDdlService } from './tenant-ddl.service';
import { MasterPrismaService } from './master-prisma.service';

export interface MigrationResult {
  databaseName: string;
  applied: string[];
  skipped: string[];
  schemaVersion: string;
  durationMs: number;
}

/**
 * Applies versioned SQL migrations to a tenant database.
 *
 * Guarantees, in order of how much they matter:
 *
 *  1. **Idempotent.** Already-applied migrations are skipped, so re-running is a
 *     no-op. This is what lets provisioning retry safely after a partial failure.
 *  2. **Serialised.** A PostgreSQL advisory lock is taken on the *tenant's own*
 *     database, so two API replicas booting at once cannot both migrate it.
 *  3. **Atomic per migration.** Each migration runs inside one transaction with
 *     its ledger row, so a failure halfway through leaves no partial schema and
 *     no phantom "applied" record.
 *  4. **Tamper-evident.** Checksums are verified; an edited, already-applied
 *     migration is a hard error rather than silent drift.
 *
 * See docs/DATABASE_PROVISIONING.md.
 */
@Injectable()
export class TenantMigrationRunner {
  private readonly logger: AppLogger;
  private migrationsCache: TenantMigration[] | null = null;

  /** Arbitrary but stable key for the advisory lock. */
  private static readonly LOCK_KEY = 8_642_197;

  constructor(
    private readonly ddl: TenantDdlService,
    private readonly master: MasterPrismaService,
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('TenantMigrationRunner');
  }

  get migrations(): TenantMigration[] {
    if (!this.migrationsCache) {
      this.migrationsCache = loadTenantMigrations(this.config.tenantDb.migrationsDir);
      if (this.migrationsCache.length === 0) {
        throw new Error('No tenant migrations were found — the API cannot provision tenants.');
      }
    }
    return this.migrationsCache;
  }

  get latestVersion(): string {
    const list = this.migrations;
    return list[list.length - 1].name;
  }

  /** Brings one tenant database up to the latest schema version. */
  async migrate(params: { tenantId: string; databaseName: string }): Promise<MigrationResult> {
    const started = Date.now();
    const client = await this.ddl.connect(params.databaseName);

    try {
      await this.acquireLock(client);

      const applied = await this.readLedger(client);
      this.verifyChecksums(applied);

      const appliedNames = new Set(applied.map((a) => a.name));
      const pending = this.migrations.filter((m) => !appliedNames.has(m.name));

      const appliedNow: string[] = [];
      for (const migration of pending) {
        const durationMs = await this.applyOne(client, migration, params.databaseName);
        appliedNow.push(migration.name);

        // Mirror into the master DB so the platform console can show fleet-wide
        // schema drift without opening every tenant database.
        await this.master.tenantMigrationRecord
          .upsert({
            where: {
              tenantId_migrationName: {
                tenantId: params.tenantId,
                migrationName: migration.name,
              },
            },
            create: {
              tenantId: params.tenantId,
              migrationName: migration.name,
              checksum: migration.checksum,
              durationMs,
            },
            update: { checksum: migration.checksum, durationMs },
          })
          .catch((err) =>
            // A mirror failure must not fail the migration itself.
            this.logger.warn('Failed to mirror migration record to master', {
              tenantId: params.tenantId,
              migration: migration.name,
              error: (err as Error).message,
            }),
          );
      }

      const result: MigrationResult = {
        databaseName: params.databaseName,
        applied: appliedNow,
        skipped: [...appliedNames],
        schemaVersion: this.latestVersion,
        durationMs: Date.now() - started,
      };

      if (appliedNow.length > 0) {
        this.logger.info('Tenant migrations applied', {
          tenantId: params.tenantId,
          databaseName: params.databaseName,
          applied: appliedNow,
          durationMs: result.durationMs,
        });
      } else {
        this.logger.debug('Tenant schema already up to date', {
          tenantId: params.tenantId,
          schemaVersion: result.schemaVersion,
        });
      }

      return result;
    } finally {
      await this.releaseLock(client).catch(() => undefined);
      await client.end().catch(() => undefined);
    }
  }

  /** Reports drift without changing anything — used by /platform/system/health. */
  async status(databaseName: string): Promise<{
    schemaVersion: string | null;
    latestVersion: string;
    pending: string[];
    upToDate: boolean;
  }> {
    const client = await this.ddl.connect(databaseName);
    try {
      const applied = await this.readLedger(client);
      const appliedNames = new Set(applied.map((a) => a.name));
      const pending = this.migrations.filter((m) => !appliedNames.has(m.name)).map((m) => m.name);
      return {
        schemaVersion: applied.length ? applied[applied.length - 1].name : null,
        latestVersion: this.latestVersion,
        pending,
        upToDate: pending.length === 0,
      };
    } finally {
      await client.end().catch(() => undefined);
    }
  }

  // -------------------------------------------------------------- internals --

  private async applyOne(
    client: PgClient,
    migration: TenantMigration,
    databaseName: string,
  ): Promise<number> {
    const started = Date.now();
    const statements = splitSqlStatements(migration.sql);

    // A handful of statements (CREATE INDEX CONCURRENTLY) cannot run in a
    // transaction. We do not use any today, but the runner handles them so a
    // future zero-downtime index migration does not need a special case.
    const transactional = statements.filter((s) => !requiresAutocommit(s));
    const autocommit = statements.filter((s) => requiresAutocommit(s));

    try {
      await client.query('BEGIN');
      for (const statement of transactional) {
        await client.query(statement);
      }

      // The ledger row goes in the same transaction as the DDL, so "applied"
      // and "actually applied" can never disagree.
      const durationMs = Date.now() - started;
      await client.query(
        `INSERT INTO schema_migrations (name, checksum, duration_ms)
         VALUES ($1, $2, $3)
         ON CONFLICT (name) DO NOTHING`,
        [migration.name, migration.checksum, durationMs],
      );
      await client.query('COMMIT');

      for (const statement of autocommit) {
        await client.query(statement);
      }

      return durationMs;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      this.logger.error('Tenant migration failed', err as Error, {
        databaseName,
        migration: migration.name,
      });
      throw new Error(
        `Migration ${migration.name} failed on ${databaseName}: ${(err as Error).message}`,
      );
    }
  }

  private async readLedger(
    client: PgClient,
  ): Promise<{ name: string; checksum: string }[]> {
    // On a brand-new database the ledger table does not exist yet — that simply
    // means nothing has been applied.
    const exists = await client.query<{ reg: string | null }>(
      `SELECT to_regclass('public.schema_migrations')::text AS reg`,
    );
    if (!exists.rows[0]?.reg) return [];

    const rows = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migrations ORDER BY name ASC',
    );
    return rows.rows;
  }

  /**
   * An already-applied migration whose file changed means the fleet's databases
   * no longer match the repository. Failing loudly beats silently diverging.
   */
  private verifyChecksums(applied: { name: string; checksum: string }[]): void {
    const known = new Map(this.migrations.map((m) => [m.name, m.checksum]));
    for (const record of applied) {
      const expected = known.get(record.name);
      if (!expected) {
        // The database is ahead of this build — likely a rollback of app code.
        this.logger.warn('Tenant database has a migration this build does not know about', {
          migration: record.name,
        });
        continue;
      }
      if (expected !== record.checksum) {
        throw new Error(
          `Checksum mismatch for migration ${record.name}. ` +
            `An already-applied migration file was modified. Create a new migration instead of editing history.`,
        );
      }
    }
  }

  private async acquireLock(client: PgClient): Promise<void> {
    // Session-level advisory lock on the tenant's own database.
    await client.query('SELECT pg_advisory_lock($1)', [TenantMigrationRunner.LOCK_KEY]);
  }

  private async releaseLock(client: PgClient): Promise<void> {
    await client.query('SELECT pg_advisory_unlock($1)', [TenantMigrationRunner.LOCK_KEY]);
  }
}
