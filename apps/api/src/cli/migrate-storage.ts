/* eslint-disable no-console -- this is a CLI: stdout IS the user interface, not stray debugging */
import { readdir, readFile, stat, unlink } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { installBigIntSerializer } from '@/common/utils/serialization';
import { AppConfigModule, AppConfigService } from '@/config/config.module';
import { CacheModule } from '@/core/cache/cache.service';
import { DatabaseModule } from '@/core/database/database.module';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { LoggerModule } from '@/core/logger/logger.service';
import { ObservabilityModule } from '@/core/observability/metrics.service';
import { QueueModule } from '@/core/queue/queue.module';
import { SecurityModule } from '@/core/security/security.module';
import { StorageModule } from '@/core/storage/storage.module';
import { StorageService } from '@/core/storage/storage.service';
import { TenantModule } from '@/core/tenant/tenant.module';
import { AuditModule } from '@/modules/audit/audit.service';
import { EntitlementsModule } from '@/modules/entitlements/entitlements.module';
import { TenantsModule } from '@/modules/tenants/tenants.module';

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
class MigrateStorageModule {}

/** MIME types recoverable from an extension. Anything else is skipped. */
const MIME_BY_EXTENSION: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
};

interface Outcome {
  path: string;
  tenantId: string;
  status: 'uploaded' | 'already-there' | 'skipped' | 'failed';
  objectKey?: string;
  rowsUpdated?: number;
  reason?: string;
}

/**
 * Moves files left on the application filesystem into object storage.
 *
 * Only ever needed by a deployment that ran with `STORAGE_PROVIDER=local`, which
 * is no longer a supported configuration — a container filesystem is not shared
 * between replicas and does not survive a rebuild. This walks whatever is in
 * `STORAGE_LOCAL_DIR`, uploads it under the same tenant-prefixed key, repoints
 * the database rows that referenced it, and only then offers to remove the
 * local copy.
 *
 * Three properties matter more than speed:
 *
 *  1. **Nothing is deleted by default.** `--delete-local` is opt-in, and even
 *     then a file is only removed after its upload has been verified by reading
 *     the object's size back from the store.
 *  2. **Every failure is per-file.** One unreadable image does not abandon the
 *     other nine hundred; it is reported and the run continues.
 *  3. **Re-runnable.** A file already present in object storage is detected and
 *     skipped, so an interrupted run is resumed by running it again.
 *
 *   pnpm db:storage:migrate                 # dry run — reports, changes nothing
 *   pnpm db:storage:migrate --apply         # upload and repoint database rows
 *   pnpm db:storage:migrate --apply --delete-local   # …then remove local copies
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const deleteLocal = args.includes('--delete-local');

  const app = await NestFactory.createApplicationContext(MigrateStorageModule, {
    bufferLogs: false,
  });

  const config = app.get(AppConfigService);
  const storage = app.get(StorageService);
  const master = app.get(MasterPrismaService);
  const tenantDb = app.get(TenantDatabaseService);

  const root = resolve(config.storage.localDir);

  console.log('\nLocal → object storage migration');
  console.log(`  source    ${root}`);
  console.log(`  target    ${storage.providerName} · ${storage.bucket}`);
  console.log(`  mode      ${apply ? 'APPLY' : 'DRY RUN (nothing will be changed)'}`);
  if (apply && deleteLocal) console.log('  local     will be deleted after verification');
  console.log('');

  try {
    const files = await walk(root).catch((err) => {
      console.log(`Nothing to migrate: ${(err as Error).message}\n`);
      return [] as string[];
    });

    if (files.length === 0) {
      console.log('No local files found. Nothing to do.\n');
      return;
    }

    console.log(`Found ${files.length} file(s).\n`);

    // Which tenants exist, so a stray directory under `tenants/` cannot be
    // uploaded under a tenant id that was deleted or never existed.
    const knownTenants = new Set(
      (await master.tenant.findMany({ select: { id: true } })).map((t) => t.id),
    );

    const outcomes: Outcome[] = [];

    for (const [index, absolute] of files.entries()) {
      // Keys are URLs: always forward slashes, whatever the platform.
      const key = relative(root, absolute).split(sep).join('/');
      const progress = `[${String(index + 1).padStart(String(files.length).length)}/${files.length}]`;

      const outcome = await migrateOne({
        absolute,
        key,
        knownTenants,
        storage,
        tenantDb,
        apply,
      });
      outcomes.push(outcome);

      const symbol = { uploaded: '✓', 'already-there': '·', skipped: '–', failed: '✗' }[
        outcome.status
      ];
      const detail =
        outcome.status === 'uploaded'
          ? `repointed ${outcome.rowsUpdated ?? 0} row(s)`
          : (outcome.reason ?? '');
      console.log(`  ${progress} ${symbol} ${key}${detail ? `  — ${detail}` : ''}`);

      // Deleting is a separate decision from uploading, and happens only after
      // the object has been confirmed present at its destination.
      if (apply && deleteLocal && outcome.status === 'uploaded' && outcome.objectKey) {
        const verified = await storage.head(outcome.tenantId, outcome.objectKey);
        if (verified && verified.size > 0) {
          await unlink(absolute);
        } else {
          console.log(`         ! kept the local copy: could not verify ${outcome.objectKey}`);
        }
      }
    }

    // ---- summary ---------------------------------------------------------
    const count = (status: Outcome['status']) => outcomes.filter((o) => o.status === status).length;

    console.log('\nSummary');
    console.log(`  uploaded       ${count('uploaded')}`);
    console.log(`  already there  ${count('already-there')}`);
    console.log(`  skipped        ${count('skipped')}`);
    console.log(`  failed         ${count('failed')}`);

    const failures = outcomes.filter((o) => o.status === 'failed');
    if (failures.length > 0) {
      console.error('\nFailures — safe to re-run; anything already uploaded is skipped:');
      for (const failure of failures) console.error(`  ✗ ${failure.path}: ${failure.reason}`);
      process.exitCode = 1;
    }

    if (!apply) {
      console.log('\nThis was a dry run. Re-run with --apply to upload and repoint the rows.');
    } else if (!deleteLocal) {
      console.log(
        '\nLocal copies were kept. Once you have confirmed the storefront renders correctly,' +
          '\nre-run with --apply --delete-local to remove them.',
      );
    }
    console.log('');
  } finally {
    await app.close();
  }
}

/**
 * One file: upload it, then repoint whatever referenced it.
 *
 * The tenant is taken from the key's own prefix — that is where the file was
 * written from, and it is what `StorageService` will check the upload against.
 * A file outside `tenants/<id>/` cannot be attributed to anyone and is skipped
 * rather than guessed at.
 */
async function migrateOne(params: {
  absolute: string;
  key: string;
  knownTenants: Set<string>;
  storage: StorageService;
  tenantDb: TenantDatabaseService;
  apply: boolean;
}): Promise<Outcome> {
  const { absolute, key, knownTenants, storage, tenantDb, apply } = params;

  const [root, tenantId] = key.split('/');
  if (root !== 'tenants' || !tenantId) {
    return { path: key, tenantId: '', status: 'skipped', reason: 'not under a tenant prefix' };
  }
  if (!knownTenants.has(tenantId)) {
    return { path: key, tenantId, status: 'skipped', reason: 'tenant no longer exists' };
  }

  const mimeType = MIME_BY_EXTENSION[extname(key).toLowerCase()];
  if (!mimeType) {
    return { path: key, tenantId, status: 'skipped', reason: 'not a supported image type' };
  }

  try {
    // Already in object storage under the same key: a previous run got there.
    if (await storage.exists(tenantId, key)) {
      return { path: key, tenantId, status: 'already-there', reason: 'object already exists' };
    }

    const buffer = await readFile(absolute);
    if (buffer.length === 0) {
      return { path: key, tenantId, status: 'skipped', reason: 'empty file' };
    }

    if (!apply) {
      return { path: key, tenantId, status: 'uploaded', reason: 'would upload', rowsUpdated: 0 };
    }

    // Uploading through `StorageService` rather than the provider directly, so
    // the same validation a merchant's upload gets applies here too — a corrupt
    // or mistyped file should not be laundered into the bucket by a migration.
    const stored = await storage.upload({
      buffer,
      originalName: key.split('/').pop() ?? 'upload',
      mimeType,
      tenantId,
    });

    const rowsUpdated = await repointRows({ tenantDb, tenantId, oldKey: key, stored });

    return { path: key, tenantId, status: 'uploaded', objectKey: stored.key, rowsUpdated };
  } catch (err) {
    return { path: key, tenantId, status: 'failed', reason: (err as Error).message };
  }
}

/**
 * Points the database at the new object.
 *
 * The old row holds a `/media/<key>` URL, which is what the local driver served.
 * Matching on the key rather than the whole URL means a row written under a
 * different host or path prefix is still found.
 */
async function repointRows(params: {
  tenantDb: TenantDatabaseService;
  tenantId: string;
  oldKey: string;
  stored: { key: string; url: string; size: number; mimeType: string; bucket: string };
}): Promise<number> {
  const { tenantDb, tenantId, oldKey, stored } = params;

  return tenantDb.runFor(tenantId, async (db) => {
    let updated = 0;

    const images = await db.productImage.findMany({
      where: { url: { contains: oldKey } },
      select: { id: true },
    });
    for (const image of images) {
      await db.productImage.update({
        where: { id: image.id },
        data: {
          url: stored.url,
          objectKey: stored.key,
          bucket: stored.bucket,
          mimeType: stored.mimeType,
          sizeBytes: stored.size,
        },
      });
      updated++;
    }

    // The other places a media URL is stored. These have no object-reference
    // column of their own — they are single-image fields — so the URL is all
    // there is to update.
    const simple = await Promise.all([
      db.productVariant.updateMany({
        where: { imageUrl: { contains: oldKey } },
        data: { imageUrl: stored.url },
      }),
      db.category.updateMany({
        where: { imageUrl: { contains: oldKey } },
        data: { imageUrl: stored.url },
      }),
      db.brand.updateMany({
        where: { logoUrl: { contains: oldKey } },
        data: { logoUrl: stored.url },
      }),
    ]);

    return updated + simple.reduce((sum, result) => sum + result.count, 0);
  });
}

/** Every file under a directory, recursively. Absolute paths. */
async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(full)));
    } else if (entry.isFile()) {
      // Skip anything with no content rather than uploading a zero-byte object.
      const info = await stat(full);
      if (info.size > 0) files.push(full);
    }
  }

  return files;
}

main().catch((err) => {
  console.error('\nStorage migration failed:', err);
  process.exit(1);
});
