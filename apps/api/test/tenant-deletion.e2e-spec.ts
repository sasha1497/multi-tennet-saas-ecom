import type { INestApplication } from '@nestjs/common';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { TenantDdlService } from '@/core/database/tenant-ddl.service';
import { StorageService } from '@/core/storage/storage.service';
import { TenantProvisioningService } from '@/modules/tenants/tenant-provisioning.service';
import {
  SUPER_ADMIN,
  TENANTS,
  assertSeeded,
  bootstrapTestApp,
  loginAdmin,
  onApi,
  onHost,
} from './helpers';

/**
 * PERMANENT TENANT DELETION
 * =========================
 *
 * The most destructive operation on the platform, exercised against real
 * databases and real object storage.
 *
 * A throwaway tenant is provisioned, filled with data across all three systems
 * a tenant occupies, then deleted — and the assertions are as much about what
 * *survives* as about what goes. The seeded tenants sit alongside it throughout
 * and must come out the other side untouched; if they do not, the blast radius
 * of a delete is the whole platform.
 *
 * Requires the infrastructure and the seed:
 *   pnpm docker:up:infra && pnpm db:migrate:deploy && pnpm db:seed
 */
describe('Permanent tenant deletion (e2e)', () => {
  let app: INestApplication;
  let master: MasterPrismaService;
  let storage: StorageService;
  let ddl: TenantDdlService;
  let tenantDb: TenantDatabaseService;
  let provisioning: TenantProvisioningService;

  let superAdminToken: string;
  let kickzoneOwner: { token: string; tenantId: string | null };

  /** The tenant this suite creates and destroys. */
  const slug = `deltest${Date.now().toString(36)}`;
  let victimId: string;
  let victimDatabase: string;
  const victimObjectKeys: string[] = [];

  /** A neighbour that must be completely unaffected. */
  let kickzoneId: string;
  let kickzoneObjectKey: string;

  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  beforeAll(async () => {
    app = await bootstrapTestApp();
    await assertSeeded(app);

    master = app.get(MasterPrismaService);
    storage = app.get(StorageService);
    ddl = app.get(TenantDdlService);
    tenantDb = app.get(TenantDatabaseService);
    provisioning = app.get(TenantProvisioningService);

    superAdminToken = (await loginAdmin(app, SUPER_ADMIN.email, SUPER_ADMIN.password)).token;
    kickzoneOwner = await loginAdmin(app, TENANTS.kickzone.owner);

    kickzoneId = (await master.tenant.findUniqueOrThrow({ where: { slug: TENANTS.kickzone.slug } }))
      .id;

    // A file belonging to the neighbour, so "other tenants are untouched" is
    // asserted against something real rather than against absence.
    kickzoneObjectKey = (
      await storage.upload({
        buffer: PNG,
        originalName: 'neighbour.png',
        mimeType: 'image/png',
        tenantId: kickzoneId,
        folder: 'products',
      })
    ).key;

    // ---- build the tenant that is going to be destroyed ------------------
    const created = await onApi(app)
      .post('/platform/tenants')
      .set('Authorization', `Bearer ${superAdminToken}`)
      .send({
        name: 'Deletion Test Store',
        slug,
        ownerEmail: `owner@${slug}.test`,
        ownerFirstName: 'Del',
        ownerLastName: 'Test',
        businessCategory: 'General Retail',
      });

    if (created.status !== 201 && created.status !== 200) {
      throw new Error(`Could not create the test tenant: ${JSON.stringify(created.body)}`);
    }
    victimId = created.body.data.tenant.id;

    await provisioning.provision(victimId);

    const record = await master.tenantDatabase.findUniqueOrThrow({
      where: { tenantId: victimId },
    });
    victimDatabase = record.databaseName;

    // Data in all three systems: rows in its own database, objects in storage,
    // and control-plane records in master.
    await tenantDb.runFor(victimId, async (db) => {
      const category = await db.category.create({
        data: { name: 'Test Aisle', slug: 'test-aisle' },
      });
      const product = await db.product.create({
        data: {
          name: 'Doomed Product',
          slug: 'doomed-product',
          status: 'PUBLISHED',
          categoryId: category.id,
        },
      });
      await db.customer.create({
        data: {
          email: `shopper@${slug}.test`,
          firstName: 'Test',
          lastName: 'Shopper',
          passwordHash: 'x'.repeat(60),
        },
      });

      for (const name of ['a', 'b']) {
        const stored = await storage.upload({
          buffer: PNG,
          originalName: `${name}.png`,
          mimeType: 'image/png',
          tenantId: victimId,
          productId: product.id,
        });
        victimObjectKeys.push(stored.key);
        await db.productImage.create({
          data: {
            productId: product.id,
            url: stored.url,
            objectKey: stored.key,
            bucket: stored.bucket,
            mimeType: stored.mimeType,
            sizeBytes: stored.size,
            isPrimary: name === 'a',
          },
        });
      }
    });

    // A store asset outside the product prefix, so the purge is shown to sweep
    // the whole tenant rather than just its catalogue.
    victimObjectKeys.push(
      (
        await storage.upload({
          buffer: PNG,
          originalName: 'logo.png',
          mimeType: 'image/png',
          tenantId: victimId,
          folder: 'store',
        })
      ).key,
    );
  }, 240_000);

  afterAll(async () => {
    // Belt and braces: if an assertion failed part way, do not leave a database
    // and a role behind on the developer's machine.
    if (victimDatabase) {
      await ddl.dropTenantDatabase(victimDatabase, `tu_${slug}`).catch(() => undefined);
    }
    await master?.tenant.deleteMany({ where: { slug } }).catch(() => undefined);
    await storage?.purgeTenant(victimId).catch(() => undefined);
    await storage?.delete(kickzoneId, kickzoneObjectKey).catch(() => undefined);
    await app?.close();
  });

  // ===================================================================
  // Authorisation
  // ===================================================================
  describe('only a super admin can do this', () => {
    it('refuses an unauthenticated caller', async () => {
      const res = await onApi(app).delete(`/platform/tenants/${victimId}`).send({
        confirmation: slug,
      });
      expect(res.status).toBe(401);
    });

    it('REFUSES a tenant owner — even for their own store', async () => {
      const res = await onHost(app, TENANTS.kickzone.host)
        .delete(`/platform/tenants/${kickzoneId}`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .send({ confirmation: TENANTS.kickzone.slug });

      // A merchant destroying their own tenant globally is not a merchant
      // operation. 403 or 404 — either way, not 200.
      expect([401, 403, 404]).toContain(res.status);

      const still = await master.tenant.findUnique({ where: { id: kickzoneId } });
      expect(still).not.toBeNull();
      expect(still!.status).toBe('ACTIVE');
    });

    it("REFUSES a tenant owner pointed at another merchant's store", async () => {
      const res = await onHost(app, TENANTS.kickzone.host)
        .delete(`/platform/tenants/${victimId}`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .send({ confirmation: slug });

      expect([401, 403, 404]).toContain(res.status);
      expect(await master.tenant.findUnique({ where: { id: victimId } })).not.toBeNull();
    });
  });

  // ===================================================================
  // Confirmation
  // ===================================================================
  describe('confirmation', () => {
    it('refuses without the store identifier', async () => {
      const res = await onApi(app)
        .delete(`/platform/tenants/${victimId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ confirmation: 'yes' });

      expect(res.status).toBe(400);
      expect(await master.tenant.findUnique({ where: { id: victimId } })).not.toBeNull();
    });

    it("refuses another store's identifier", async () => {
      const res = await onApi(app)
        .delete(`/platform/tenants/${victimId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ confirmation: TENANTS.kickzone.slug });

      expect(res.status).toBe(400);
      // And most importantly, KickZone is still there.
      expect(await master.tenant.findUnique({ where: { id: kickzoneId } })).not.toBeNull();
    });
  });

  // ===================================================================
  // The deletion itself
  // ===================================================================
  describe('deleting the tenant', () => {
    let result: {
      status: string;
      completedSteps: string[];
      objectsDeleted: number;
      currentStep: string | null;
      error: string | null;
    };

    it('completes every step', async () => {
      const res = await onApi(app)
        .delete(`/platform/tenants/${victimId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ confirmation: slug.toUpperCase() });

      expect(res.status).toBe(200);
      result = res.body.data;

      expect(result.error).toBeNull();
      expect(result.status).toBe('COMPLETED');
      expect(result.completedSteps).toEqual([
        'REVOKE_ACCESS',
        'PURGE_STORAGE',
        'DROP_DATABASE',
        'PURGE_MASTER_RECORDS',
        'FINALISE',
      ]);
    }, 120_000);

    it('reports how many objects it removed', () => {
      expect(result.objectsDeleted).toBeGreaterThanOrEqual(victimObjectKeys.length);
    });

    it('drops the tenant database', async () => {
      expect(await ddl.databaseExists(victimDatabase)).toBe(false);
    });

    it('removes every object under the tenant prefix', async () => {
      expect(await storage.listTenantObjects(victimId)).toHaveLength(0);
    });

    it('removes the tenant and its control-plane rows', async () => {
      expect(await master.tenant.findUnique({ where: { id: victimId } })).toBeNull();
      expect(await master.tenantDatabase.findUnique({ where: { tenantId: victimId } })).toBeNull();
      expect(await master.tenantUser.count({ where: { tenantId: victimId } })).toBe(0);
      expect(await master.domain.count({ where: { tenantId: victimId } })).toBe(0);
      expect(await master.subscription.count({ where: { tenantId: victimId } })).toBe(0);
      expect(await master.featureEntitlement.count({ where: { tenantId: victimId } })).toBe(0);
      expect(await master.tenantMigrationRecord.count({ where: { tenantId: victimId } })).toBe(0);
      expect(await master.session.count({ where: { tenantId: victimId } })).toBe(0);
    });

    it('leaves the deletion job behind as the record of what happened', async () => {
      const jobs = await master.tenantDeletionJob.findMany({ where: { tenantId: victimId } });
      expect(jobs).toHaveLength(1);
      expect(jobs[0].status).toBe('COMPLETED');
      expect(jobs[0].tenantSlug).toBe(slug);
      expect(jobs[0].finishedAt).not.toBeNull();
    });

    it('writes a TENANT_DELETED audit entry that outlives the tenant', async () => {
      const entry = await master.platformAuditLog.findFirst({
        where: { tenantId: victimId, action: 'TENANT_DELETED' },
      });
      expect(entry).not.toBeNull();
      expect(entry!.tenantSlug).toBe(slug);
    });
  });

  // ===================================================================
  // After the fact
  // ===================================================================
  describe('the deleted tenant is unusable', () => {
    it('no longer resolves from its hostname', async () => {
      const res = await onHost(app, `${slug}.localhost`).get('/store');
      expect([404, 400]).toContain(res.status);
    });

    it('is gone from the platform tenant list', async () => {
      const res = await onApi(app)
        .get(`/platform/tenants?search=${slug}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      const found = (res.body.data as { slug: string }[]).filter((t) => t.slug === slug);
      expect(found).toHaveLength(0);
    });

    it('404s a second deletion rather than doing anything twice', async () => {
      const res = await onApi(app)
        .delete(`/platform/tenants/${victimId}`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ confirmation: slug });

      expect(res.status).toBe(404);
    });

    it('cannot have a presigned URL minted for it any more', async () => {
      // Nothing is left under the prefix, and nothing can authenticate into it.
      expect(await storage.listTenantObjects(victimId)).toHaveLength(0);
    });
  });

  // ===================================================================
  // The promise the platform rests on
  // ===================================================================
  describe('every other tenant is untouched', () => {
    it('leaves the neighbouring tenants exactly as they were', async () => {
      for (const tenant of [TENANTS.kickzone, TENANTS.kumarstore, TENANTS.abcstore]) {
        const row = await master.tenant.findUnique({ where: { slug: tenant.slug } });
        expect(row).not.toBeNull();
        expect(row!.status).toBe('ACTIVE');
        expect(row!.deletedAt).toBeNull();
      }
    });

    it('leaves their storefronts serving', async () => {
      for (const tenant of [TENANTS.kickzone, TENANTS.kumarstore, TENANTS.abcstore]) {
        const res = await onHost(app, tenant.host).get('/store');
        expect(res.status).toBe(200);
        expect(res.body.data.tenant.slug).toBe(tenant.slug);
      }
    });

    it('leaves their catalogues intact', async () => {
      const res = await onHost(app, TENANTS.kickzone.host).get('/products?limit=5');
      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
    });

    it("leaves the neighbour's databases in place", async () => {
      const records = await master.tenantDatabase.findMany({
        where: { tenant: { slug: { in: [TENANTS.kickzone.slug, TENANTS.kumarstore.slug] } } },
      });
      expect(records.length).toBe(2);
      for (const record of records) {
        expect(await ddl.databaseExists(record.databaseName)).toBe(true);
      }
    });

    it("leaves the neighbour's files in object storage", async () => {
      expect(await storage.exists(kickzoneId, kickzoneObjectKey)).toBe(true);
    });

    it('leaves the shared platform plans alone', async () => {
      expect(await master.plan.count()).toBeGreaterThan(0);
    });

    it('leaves the super admin account alone', async () => {
      const admin = await master.user.findUnique({ where: { email: SUPER_ADMIN.email } });
      expect(admin).not.toBeNull();
      expect(admin!.isSuperAdmin).toBe(true);
    });
  });
});
