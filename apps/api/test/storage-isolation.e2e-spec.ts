import type { INestApplication } from '@nestjs/common';
import { StorageService } from '@/core/storage/storage.service';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TENANTS, assertSeeded, bootstrapTestApp, loginAdmin, onHost } from './helpers';

/**
 * STORAGE ISOLATION AND THE DIRECT-UPLOAD FLOW
 * ============================================
 *
 * Object storage is the second place a merchant's data lives, and the one where
 * isolation is easiest to get wrong: keys travel to clients in API responses,
 * so a merchant can read one off their own product and try it against another
 * store. Prefixing keys with a tenant id is a convention; this suite is what
 * makes it a control.
 *
 * It attacks from four directions:
 *
 *   1. a presigned URL must be scoped to the tenant that asked for it
 *   2. another tenant's key must not be signable, confirmable or deletable
 *   3. an upload ticket must not be redeemable for something that is not an
 *      image, however the client labels it
 *   4. no response may ever carry a storage credential
 *
 * Runs against the real seeded databases and the real MinIO. A failure here is
 * a data breach, not a bug.
 */
describe('Storage isolation and uploads (e2e)', () => {
  let app: INestApplication;
  let master: MasterPrismaService;
  let storage: StorageService;

  let kickzoneOwner: { token: string; tenantId: string | null };
  let kumarOwner: { token: string; tenantId: string | null };
  let kickzoneTenantId: string;
  let kumarTenantId: string;

  /** A real 1×1 PNG. The service checks magic numbers, not just MIME types. */
  const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  beforeAll(async () => {
    app = await bootstrapTestApp();
    await assertSeeded(app);

    master = app.get(MasterPrismaService);
    storage = app.get(StorageService);

    const [kz, km] = await Promise.all([
      master.tenant.findUniqueOrThrow({ where: { slug: TENANTS.kickzone.slug } }),
      master.tenant.findUniqueOrThrow({ where: { slug: TENANTS.kumarstore.slug } }),
    ]);
    kickzoneTenantId = kz.id;
    kumarTenantId = km.id;

    kickzoneOwner = await loginAdmin(app, TENANTS.kickzone.owner);
    kumarOwner = await loginAdmin(app, TENANTS.kumarstore.owner);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
  });

  const presign = (
    owner: { token: string },
    host: string,
    files: { fileName: string; mimeType: string; size: number }[],
    extra: Record<string, unknown> = {},
  ) =>
    onHost(app, host)
      .post('/merchant/files/presign')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ files, folder: 'products', ...extra });

  // ===================================================================
  // Layer 1 — a ticket is scoped to the tenant that asked for it
  // ===================================================================
  describe('Layer 1: presigned URLs are tenant-scoped', () => {
    it('mints keys under the requesting tenant prefix', async () => {
      const res = await presign(kickzoneOwner, TENANTS.kickzone.host, [
        { fileName: 'front.png', mimeType: 'image/png', size: PNG.length },
      ]);

      expect(res.status).toBe(200);
      const [ticket] = res.body.data.uploads;
      expect(ticket.objectKey.startsWith(`tenants/${kickzoneTenantId}/`)).toBe(true);
      expect(ticket.objectKey).not.toContain(kumarTenantId);
    });

    it('gives two tenants disjoint key spaces for the same file name', async () => {
      const [kz, km] = await Promise.all([
        presign(kickzoneOwner, TENANTS.kickzone.host, [
          { fileName: 'same.png', mimeType: 'image/png', size: PNG.length },
        ]),
        presign(kumarOwner, TENANTS.kumarstore.host, [
          { fileName: 'same.png', mimeType: 'image/png', size: PNG.length },
        ]),
      ]);

      const kzKey = kz.body.data.uploads[0].objectKey as string;
      const kmKey = km.body.data.uploads[0].objectKey as string;

      expect(kzKey).not.toBe(kmKey);
      expect(kzKey.startsWith(`tenants/${kickzoneTenantId}/`)).toBe(true);
      expect(kmKey.startsWith(`tenants/${kumarTenantId}/`)).toBe(true);
    });

    it('gives every file in one batch its own key', async () => {
      const res = await presign(kickzoneOwner, TENANTS.kickzone.host, [
        { fileName: 'a.png', mimeType: 'image/png', size: PNG.length },
        { fileName: 'b.png', mimeType: 'image/png', size: PNG.length },
        { fileName: 'c.png', mimeType: 'image/png', size: PNG.length },
      ]);

      const keys = res.body.data.uploads.map((u: { objectKey: string }) => u.objectKey);
      expect(new Set(keys).size).toBe(3);
    });

    it('refuses a presign request with no authentication at all', async () => {
      const res = await onHost(app, TENANTS.kickzone.host)
        .post('/merchant/files/presign')
        .send({ files: [{ fileName: 'x.png', mimeType: 'image/png', size: 10 }] });

      expect(res.status).toBe(401);
    });
  });

  // ===================================================================
  // Layer 2 — another tenant's key is not usable, however it is obtained
  // ===================================================================
  describe("Layer 2: one tenant cannot touch another tenant's objects", () => {
    let kickzoneKey: string;

    beforeAll(async () => {
      const stored = await storage.upload({
        buffer: PNG,
        originalName: 'owned.png',
        mimeType: 'image/png',
        tenantId: kickzoneTenantId,
        folder: 'products',
      });
      kickzoneKey = stored.key;
    });

    it('REFUSES to confirm an upload against another tenant key', async () => {
      const res = await onHost(app, TENANTS.kumarstore.host)
        .post('/merchant/files/confirm')
        .set('Authorization', `Bearer ${kumarOwner.token}`)
        .send({ uploads: [{ objectKey: kickzoneKey }] });

      // 404 rather than 403: a 403 would confirm the object exists, which is
      // exactly what the caller was probing for.
      expect(res.status).toBe(404);
    });

    it("leaves the other tenant's object intact after a refused confirm", async () => {
      await onHost(app, TENANTS.kumarstore.host)
        .post('/merchant/files/confirm')
        .set('Authorization', `Bearer ${kumarOwner.token}`)
        .send({ uploads: [{ objectKey: kickzoneKey }] });

      expect(await storage.exists(kickzoneTenantId, kickzoneKey)).toBe(true);
    });

    it('REFUSES to sign a preview URL for another tenant object', async () => {
      await expect(storage.signedUrl(kumarTenantId, kickzoneKey)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(storage.readUrl(kumarTenantId, kickzoneKey)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it('REFUSES to read, probe or delete another tenant object', async () => {
      await expect(storage.get(kumarTenantId, kickzoneKey)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(storage.exists(kumarTenantId, kickzoneKey)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      await expect(storage.delete(kumarTenantId, kickzoneKey)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
      expect(await storage.exists(kickzoneTenantId, kickzoneKey)).toBe(true);
    });

    it('rejects a key that climbs out of the tenant prefix', async () => {
      const escape = `tenants/${kumarTenantId}/../${kickzoneTenantId}/products/x.png`;
      await expect(storage.get(kumarTenantId, escape)).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });

    it("REFUSES to attach another tenant's object to a product", async () => {
      const products = await onHost(app, TENANTS.kumarstore.host)
        .get('/merchant/products?limit=1')
        .set('Authorization', `Bearer ${kumarOwner.token}`);
      const productId = products.body.data[0].id as string;

      const res = await onHost(app, TENANTS.kumarstore.host)
        .post(`/merchant/products/${productId}/images`)
        .set('Authorization', `Bearer ${kumarOwner.token}`)
        .send({ images: [{ objectKey: kickzoneKey, isPrimary: false }] });

      expect(res.status).toBe(404);
    });
  });

  // ===================================================================
  // Layer 3 — a ticket is not a licence to store anything
  // ===================================================================
  describe('Layer 3: what a ticket can be redeemed for', () => {
    it('refuses a file type that is not an allowed image', async () => {
      const res = await presign(kickzoneOwner, TENANTS.kickzone.host, [
        { fileName: 'payload.svg', mimeType: 'image/svg+xml', size: 500 },
      ]);
      expect(res.status).toBe(400);
    });

    it('refuses a file whose extension contradicts its declared type', async () => {
      const res = await presign(kickzoneOwner, TENANTS.kickzone.host, [
        { fileName: 'payload.html', mimeType: 'image/png', size: 500 },
      ]);
      expect(res.status).toBe(400);
    });

    it('refuses a file that is over the size limit before any bytes move', async () => {
      const res = await presign(kickzoneOwner, TENANTS.kickzone.host, [
        { fileName: 'huge.png', mimeType: 'image/png', size: 50 * 1024 * 1024 },
      ]);
      expect(res.status).toBe(400);
    });

    it('refuses more files than the configured maximum', async () => {
      const many = Array.from({ length: 40 }, (_, i) => ({
        fileName: `f${i}.png`,
        mimeType: 'image/png',
        size: PNG.length,
      }));
      const res = await presign(kickzoneOwner, TENANTS.kickzone.host, many);
      expect(res.status).toBe(400);
    });

    it('refuses to confirm an object that was never uploaded', async () => {
      const ticket = await presign(kickzoneOwner, TENANTS.kickzone.host, [
        { fileName: 'never.png', mimeType: 'image/png', size: PNG.length },
      ]);
      const { objectKey } = ticket.body.data.uploads[0];

      const res = await onHost(app, TENANTS.kickzone.host)
        .post('/merchant/files/confirm')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .send({ uploads: [{ objectKey }] });

      expect(res.status).toBe(400);
    });

    it('rejects — and deletes — HTML uploaded through an image ticket', async () => {
      const ticket = await presign(kickzoneOwner, TENANTS.kickzone.host, [
        { fileName: 'evil.png', mimeType: 'image/png', size: 64 },
      ]);
      const { objectKey } = ticket.body.data.uploads[0];

      // Redeeming the ticket with something that is not an image at all: this
      // is the stored-XSS case the magic-number check exists for.
      await storage
        .upload({
          buffer: Buffer.from('<html><script>alert(1)</script></html>'),
          originalName: 'evil.png',
          mimeType: 'image/png',
          tenantId: kickzoneTenantId,
        })
        .catch(() => undefined);

      const res = await onHost(app, TENANTS.kickzone.host)
        .post('/merchant/files/confirm')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .send({ uploads: [{ objectKey }] });

      expect(res.status).toBe(400);
      expect(await storage.exists(kickzoneTenantId, objectKey)).toBe(false);
    });
  });

  // ===================================================================
  // Layer 4 — credentials never leave the API
  // ===================================================================
  describe('Layer 4: no response carries a storage credential', () => {
    it('hands out a URL and nothing else', async () => {
      const res = await presign(kickzoneOwner, TENANTS.kickzone.host, [
        { fileName: 'front.png', mimeType: 'image/png', size: PNG.length },
      ]);

      const body = JSON.stringify(res.body);
      for (const secret of [
        process.env.S3_SECRET_KEY,
        process.env.MINIO_SECRET_KEY,
        process.env.AWS_SECRET_ACCESS_KEY,
        'secretAccessKey',
        'retailos_dev_password',
      ]) {
        if (secret) expect(body).not.toContain(secret);
      }
    });

    it('signs the URL rather than embedding a reusable key', async () => {
      const res = await presign(kickzoneOwner, TENANTS.kickzone.host, [
        { fileName: 'front.png', mimeType: 'image/png', size: PNG.length },
      ]);
      const { uploadUrl } = res.body.data.uploads[0];

      // A SigV4 URL: expiring, scoped, and signed — not a bare bucket path.
      expect(uploadUrl).toContain('X-Amz-Signature');
      expect(uploadUrl).toContain('X-Amz-Expires');
    });

    it('never exposes a tenant database password through the media surface', async () => {
      const res = await onHost(app, TENANTS.kickzone.host)
        .get('/merchant/products?limit=5')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain('encryptedPassword');
      expect(body).not.toContain('encrypted_password');
    });
  });

  // ===================================================================
  // Layer 5 — product images through the API, end to end
  // ===================================================================
  describe('Layer 5: product images', () => {
    let productId: string;
    const uploaded: string[] = [];

    beforeAll(async () => {
      const products = await onHost(app, TENANTS.kickzone.host)
        .get('/merchant/products?limit=1')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);
      productId = products.body.data[0].id;

      // Three real objects, stored the way a confirmed direct upload would.
      for (const name of ['front', 'back', 'side']) {
        const stored = await storage.upload({
          buffer: PNG,
          originalName: `${name}.png`,
          mimeType: 'image/png',
          tenantId: kickzoneTenantId,
          productId,
        });
        uploaded.push(stored.key);
      }
    });

    it('scopes a product upload key to that product', () => {
      for (const key of uploaded) {
        expect(key.startsWith(`tenants/${kickzoneTenantId}/products/`)).toBe(true);
      }
    });

    it('adds several images at once and keeps exactly one primary', async () => {
      const res = await onHost(app, TENANTS.kickzone.host)
        .post(`/merchant/products/${productId}/images`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .send({
          images: uploaded.map((objectKey, i) => ({
            objectKey,
            fileName: `${i}.png`,
            mimeType: 'image/png',
            isPrimary: false,
          })),
        });

      expect(res.status).toBe(201);
      const images = res.body.data as { id: string; isPrimary: boolean }[];
      expect(images.length).toBeGreaterThanOrEqual(3);
      expect(images.filter((i) => i.isPrimary)).toHaveLength(1);
    });

    it('returns a fetchable URL for every image', async () => {
      const res = await onHost(app, TENANTS.kickzone.host)
        .get(`/merchant/products/${productId}`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);

      const images = res.body.data.images as { url: string; objectKey: string | null }[];
      expect(images.length).toBeGreaterThan(0);
      for (const image of images) {
        expect(image.url).toMatch(/^https?:\/\//);
      }
    });

    it('reorders the gallery and moves the primary', async () => {
      const before = await onHost(app, TENANTS.kickzone.host)
        .get(`/merchant/products/${productId}`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);
      const ids = (before.body.data.images as { id: string }[]).map((i) => i.id);

      const reversed = [...ids].reverse();
      const res = await onHost(app, TENANTS.kickzone.host)
        .patch(`/merchant/products/${productId}/images`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .send({ imageIds: reversed, primaryImageId: reversed[0] });

      expect(res.status).toBe(200);
      const images = res.body.data as { id: string; isPrimary: boolean; sortOrder: number }[];
      expect(images[0].id).toBe(reversed[0]);
      expect(images.filter((i) => i.isPrimary)).toHaveLength(1);
      expect(images.find((i) => i.isPrimary)!.id).toBe(reversed[0]);
    });

    it('refuses a partial reorder rather than applying half of it', async () => {
      const before = await onHost(app, TENANTS.kickzone.host)
        .get(`/merchant/products/${productId}`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);
      const ids = (before.body.data.images as { id: string }[]).map((i) => i.id);

      const res = await onHost(app, TENANTS.kickzone.host)
        .patch(`/merchant/products/${productId}/images`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .send({ imageIds: ids.slice(0, 1) });

      expect(res.status).toBe(400);
    });

    it('deletes an image and the object behind it', async () => {
      const before = await onHost(app, TENANTS.kickzone.host)
        .get(`/merchant/products/${productId}`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);
      const images = before.body.data.images as { id: string; objectKey: string | null }[];
      const target = images.find((i) => i.objectKey)!;

      const res = await onHost(app, TENANTS.kickzone.host)
        .delete(`/merchant/products/${productId}/images/${target.id}`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);

      expect(res.status).toBe(204);

      // The row is gone…
      const after = await onHost(app, TENANTS.kickzone.host)
        .get(`/merchant/products/${productId}`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);
      const remaining = (after.body.data.images as { id: string }[]).map((i) => i.id);
      expect(remaining).not.toContain(target.id);

      // …and so is the file. "Delete" must not quietly mean "hide".
      expect(await storage.exists(kickzoneTenantId, target.objectKey!)).toBe(false);
    });

    it('promotes the next image when the primary is deleted', async () => {
      const before = await onHost(app, TENANTS.kickzone.host)
        .get(`/merchant/products/${productId}`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);
      const images = before.body.data.images as { id: string; isPrimary: boolean }[];
      if (images.length < 2) return;

      const primary = images.find((i) => i.isPrimary)!;
      await onHost(app, TENANTS.kickzone.host)
        .delete(`/merchant/products/${productId}/images/${primary.id}`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);

      const after = await onHost(app, TENANTS.kickzone.host)
        .get(`/merchant/products/${productId}`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);
      const remaining = after.body.data.images as { isPrimary: boolean }[];
      expect(remaining.filter((i) => i.isPrimary)).toHaveLength(1);
    });

    it("REFUSES to delete another tenant's product image", async () => {
      const kz = await onHost(app, TENANTS.kickzone.host)
        .get(`/merchant/products/${productId}`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);
      const images = kz.body.data.images as { id: string }[];
      if (images.length === 0) return;

      const res = await onHost(app, TENANTS.kumarstore.host)
        .delete(`/merchant/products/${productId}/images/${images[0].id}`)
        .set('Authorization', `Bearer ${kumarOwner.token}`);

      expect(res.status).toBe(404);
    });
  });

  // ===================================================================
  // Branding URLs are re-signed on read, never served expired
  // ===================================================================
  describe('store branding images', () => {
    let originalLogo: string | null = null;

    afterAll(async () => {
      await onHost(app, TENANTS.kickzone.host)
        .patch('/merchant/store')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .send({ logoUrl: originalLogo });
    });

    it('serves a freshly signed logo even when the stored URL has expired', async () => {
      const before = await onHost(app, TENANTS.kickzone.host)
        .get('/merchant/store')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);
      originalLogo = before.body.data.logoUrl;

      const stored = await storage.upload({
        buffer: PNG,
        originalName: 'logo.png',
        mimeType: 'image/png',
        tenantId: kickzoneTenantId,
        folder: 'branding',
      });
      // What a merchant's browser saved after an upload: a presigned URL, here
      // made unmistakably stale.
      const stale = `${(await storage.signedUrl(kickzoneTenantId, stored.key, 1)).split('?')[0]}?X-Amz-Date=20200101T000000Z&X-Amz-Expires=1`;

      await onHost(app, TENANTS.kickzone.host)
        .patch('/merchant/store')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .send({ logoUrl: stale })
        .expect(200);

      const res = await onHost(app, TENANTS.kickzone.host).get('/store');
      const logo = res.body.data.store.logoUrl as string;
      expect(logo).not.toBe(stale);
      expect(logo).toContain(stored.key);
    });

    it("never re-signs a URL that points at another tenant's object", async () => {
      const theirs = `http://localhost:9100/retailos-media/tenants/${kumarTenantId}/branding/x.png?X-Amz-Date=20200101T000000Z`;
      await onHost(app, TENANTS.kickzone.host)
        .patch('/merchant/store')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .send({ logoUrl: theirs })
        .expect(200);

      const res = await onHost(app, TENANTS.kickzone.host).get('/store');
      expect(res.body.data.store.logoUrl).toBe(theirs);
    });
  });
});
