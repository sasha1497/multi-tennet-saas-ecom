import type { INestApplication } from '@nestjs/common';
import {
  TENANTS,
  assertSeeded,
  bootstrapTestApp,
  loginAdmin,
  loginCustomer,
  onApi,
  onHost,
} from './helpers';
import { MasterPrismaService } from '@/core/database/master-prisma.service';

/**
 * CROSS-TENANT ISOLATION
 * ======================
 *
 * The single most important test file in this repository.
 *
 * The platform's core promise is that a request to `kickzone.ourdomain.in` can
 * never, under any circumstance, return ABC Store's data. That promise rests on
 * several independent layers, and this suite probes each of them the way an
 * attacker would:
 *
 *   1. physical separation — one PostgreSQL database per tenant
 *   2. host-based resolution — the tenant comes from the Host, never the body
 *   3. token binding — a customer token names its tenant and is checked
 *   4. membership verification — an admin token is checked against `tenant_users`
 *   5. audience separation — shopper tokens cannot reach merchant routes
 *
 * Each test below tries to defeat one layer. A failure here is a data breach,
 * not a bug.
 */
describe('Cross-tenant isolation (e2e)', () => {
  let app: INestApplication;
  let master: MasterPrismaService;

  // Session material, resolved once in beforeAll.
  let kickzoneCustomerToken: string;
  let kumarCustomerToken: string;
  let kickzoneOwner: { token: string; tenantId: string | null };
  let kumarOwner: { token: string; tenantId: string | null };
  let superAdminToken: string;
  let kickzoneTenantId: string;
  let kumarTenantId: string;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    await assertSeeded(app);

    master = app.get(MasterPrismaService);

    const [kz, km] = await Promise.all([
      master.tenant.findUniqueOrThrow({ where: { slug: TENANTS.kickzone.slug } }),
      master.tenant.findUniqueOrThrow({ where: { slug: TENANTS.kumarstore.slug } }),
    ]);
    kickzoneTenantId = kz.id;
    kumarTenantId = km.id;

    kickzoneCustomerToken = await loginCustomer(
      app,
      TENANTS.kickzone.host,
      TENANTS.kickzone.customer,
    );
    kumarCustomerToken = await loginCustomer(
      app,
      TENANTS.kumarstore.host,
      TENANTS.kumarstore.customer,
    );
    kickzoneOwner = await loginAdmin(app, TENANTS.kickzone.owner);
    kumarOwner = await loginAdmin(app, TENANTS.kumarstore.owner);
    superAdminToken = (await loginAdmin(app, 'admin@retailos.dev', 'SuperAdmin@123')).token;
  }, 90_000);

  afterAll(async () => {
    await app?.close();
  });

  // ===================================================================
  // Layer 1 — physical separation
  // ===================================================================
  describe('Layer 1: each tenant has its own database', () => {
    it('registers a distinct database per tenant', async () => {
      const databases = await master.tenantDatabase.findMany({
        select: { tenantId: true, databaseName: true, username: true },
      });

      const names = databases.map((d) => d.databaseName);
      expect(new Set(names).size).toBe(names.length);
      expect(names.length).toBeGreaterThanOrEqual(3);
    });

    it('never returns tenant database credentials through the API', async () => {
      const res = await onApi(app)
        .get(`/platform/tenants/${kickzoneTenantId}`)
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      const body = JSON.stringify(res.body);
      expect(body).not.toContain('encryptedPassword');
      expect(body).not.toContain('encrypted_password');
      // The placement metadata is fine to expose; the secret is not.
      expect(res.body.data.database.databaseName).toBeTruthy();
    });

    it('stores tenant credentials encrypted, never in plain text', async () => {
      const record = await master.tenantDatabase.findFirstOrThrow({
        where: { tenant: { slug: TENANTS.kickzone.slug } },
      });
      expect(record.encryptedPassword.startsWith('v1.')).toBe(true);
      // Four dot-separated parts: version, iv, auth tag, ciphertext.
      expect(record.encryptedPassword.split('.')).toHaveLength(4);
    });
  });

  // ===================================================================
  // Layer 2 — host-based tenant resolution
  // ===================================================================
  describe('Layer 2: the Host header decides the tenant', () => {
    it('serves each hostname its own store', async () => {
      const [kz, km, abc] = await Promise.all([
        onHost(app, TENANTS.kickzone.host).get('/store'),
        onHost(app, TENANTS.kumarstore.host).get('/store'),
        onHost(app, TENANTS.abcstore.host).get('/store'),
      ]);

      expect(kz.body.data.tenant.slug).toBe('kickzone');
      expect(km.body.data.tenant.slug).toBe('kumarstore');
      expect(abc.body.data.tenant.slug).toBe('abcstore');
    });

    it('serves disjoint catalogs', async () => {
      const [kz, km] = await Promise.all([
        onHost(app, TENANTS.kickzone.host).get('/products?limit=100'),
        onHost(app, TENANTS.kumarstore.host).get('/products?limit=100'),
      ]);

      const kzIds = new Set<string>(kz.body.data.map((p: { id: string }) => p.id));
      const kmIds = new Set<string>(km.body.data.map((p: { id: string }) => p.id));

      expect(kzIds.size).toBeGreaterThan(0);
      expect(kmIds.size).toBeGreaterThan(0);
      for (const id of kmIds) expect(kzIds.has(id)).toBe(false);
    });

    it('404s a product slug that belongs to another tenant', async () => {
      const kz = await onHost(app, TENANTS.kickzone.host).get('/products?limit=1');
      const slug = kz.body.data[0].slug as string;

      const cross = await onHost(app, TENANTS.kumarstore.host).get(`/products/${slug}`);
      expect(cross.status).toBe(404);
      expect(cross.body.error.code).toBe('NOT_FOUND');
    });

    it('refuses an unknown hostname', async () => {
      const res = await onHost(app, 'nosuchstore.localhost').get('/store');
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('TENANT_NOT_FOUND');
    });

    it('refuses a reserved subdomain as a tenant', async () => {
      const res = await onHost(app, 'mail.localhost').get('/store');
      expect(res.status).toBe(404);
    });

    it('refuses a nested subdomain that merely contains a tenant slug', async () => {
      // `evil.kickzone.localhost` is not KickZone.
      const res = await onHost(app, 'evil.kickzone.localhost').get('/store');
      expect(res.status).toBe(404);
    });
  });

  // ===================================================================
  // Layer 3 — customer tokens are bound to one tenant
  // ===================================================================
  describe('Layer 3: a shopper token works in exactly one store', () => {
    it('accepts the token on its own store', async () => {
      const res = await onHost(app, TENANTS.kickzone.host)
        .get('/auth/customer/me')
        .set('Authorization', `Bearer ${kickzoneCustomerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.customer.email).toBe(TENANTS.kickzone.customer);
    });

    it('REJECTS a KickZone shopper token on Kumar Store', async () => {
      const res = await onHost(app, TENANTS.kumarstore.host)
        .get('/auth/customer/me')
        .set('Authorization', `Bearer ${kickzoneCustomerToken}`);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('REJECTS a cross-tenant token on the orders list', async () => {
      const res = await onHost(app, TENANTS.kumarstore.host)
        .get('/orders')
        .set('Authorization', `Bearer ${kickzoneCustomerToken}`);
      expect(res.status).toBe(403);
    });

    it('REJECTS a cross-tenant token on the address book', async () => {
      const res = await onHost(app, TENANTS.abcstore.host)
        .get('/addresses')
        .set('Authorization', `Bearer ${kumarCustomerToken}`);
      expect(res.status).toBe(403);
    });

    it('REJECTS a cross-tenant token when placing an order', async () => {
      const res = await onHost(app, TENANTS.kumarstore.host)
        .post('/orders')
        .set('Authorization', `Bearer ${kickzoneCustomerToken}`)
        .send({
          shippingAddress: {
            fullName: 'Attacker',
            phone: '9800000000',
            line1: '1 Test Street',
            city: 'Bengaluru',
            state: 'Karnataka',
            postalCode: '560001',
            country: 'IN',
          },
          paymentMethod: 'COD',
          idempotencyKey: `isolation-probe-${Date.now()}`,
        });

      expect(res.status).toBe(403);
    });

    it("does not leak another tenant's order by id", async () => {
      // Take a real KickZone order id, then ask for it as a Kumar shopper.
      const kzOrders = await onHost(app, TENANTS.kickzone.host)
        .get('/orders?limit=1')
        .set('Authorization', `Bearer ${kickzoneCustomerToken}`);

      if (kzOrders.body.data.length === 0) return; // nothing seeded to probe with
      const orderId = kzOrders.body.data[0].id as string;

      const res = await onHost(app, TENANTS.kumarstore.host)
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${kumarCustomerToken}`);

      // 404 (not in this tenant's database) — never 200.
      expect(res.status).toBe(404);
    });

    it('ignores a spoofed X-Tenant-Slug that contradicts the token', async () => {
      const res = await onHost(app, TENANTS.kickzone.host)
        .get('/auth/customer/me')
        .set('X-Tenant-Slug', 'kumarstore')
        .set('Authorization', `Bearer ${kickzoneCustomerToken}`);

      // The Host still wins, so the token remains valid for its own store.
      expect(res.status).toBe(200);
      expect(res.body.data.tenantSlug).toBe('kickzone');
    });
  });

  // ===================================================================
  // Layer 4 — admin tokens are checked against live membership
  // ===================================================================
  describe('Layer 4: merchant access requires a live membership', () => {
    it('lets an owner read their own store', async () => {
      const res = await onApi(app)
        .get('/merchant/products')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .set('X-Tenant-Id', kickzoneTenantId);
      expect(res.status).toBe(200);
    });

    it('REJECTS an X-Tenant-Id naming a store the user does not belong to', async () => {
      const res = await onApi(app)
        .get('/merchant/products')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .set('X-Tenant-Id', kumarTenantId);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TENANT_MEMBERSHIP_REQUIRED');
    });

    it('REJECTS a cross-tenant header on every merchant surface', async () => {
      const surfaces = [
        '/merchant/orders',
        '/merchant/customers',
        '/merchant/inventory',
        '/merchant/dashboard',
        '/merchant/store',
        '/merchant/staff',
      ];

      for (const path of surfaces) {
        const res = await onApi(app)
          .get(path)
          .set('Authorization', `Bearer ${kickzoneOwner.token}`)
          .set('X-Tenant-Id', kumarTenantId);
        expect([403]).toContain(res.status);
      }
    });

    it('REJECTS a cross-tenant write', async () => {
      const res = await onApi(app)
        .post('/merchant/categories')
        .set('Authorization', `Bearer ${kumarOwner.token}`)
        .set('X-Tenant-Id', kickzoneTenantId)
        .send({ name: 'Injected category' });

      expect(res.status).toBe(403);
    });

    it('REJECTS a fabricated tenant id', async () => {
      const res = await onApi(app)
        .get('/merchant/products')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .set('X-Tenant-Id', '00000000-0000-4000-8000-000000000000');
      expect(res.status).toBe(403);
    });

    it('gives each owner only their own catalog', async () => {
      const [kz, km] = await Promise.all([
        onApi(app)
          .get('/merchant/products?limit=100')
          .set('Authorization', `Bearer ${kickzoneOwner.token}`)
          .set('X-Tenant-Id', kickzoneTenantId),
        onApi(app)
          .get('/merchant/products?limit=100')
          .set('Authorization', `Bearer ${kumarOwner.token}`)
          .set('X-Tenant-Id', kumarTenantId),
      ]);

      const kzIds = new Set<string>(kz.body.data.map((p: { id: string }) => p.id));
      for (const product of km.body.data as { id: string }[]) {
        expect(kzIds.has(product.id)).toBe(false);
      }
    });

    it('gives each owner only their own customers', async () => {
      const [kz, km] = await Promise.all([
        onApi(app)
          .get('/merchant/customers?limit=100')
          .set('Authorization', `Bearer ${kickzoneOwner.token}`)
          .set('X-Tenant-Id', kickzoneTenantId),
        onApi(app)
          .get('/merchant/customers?limit=100')
          .set('Authorization', `Bearer ${kumarOwner.token}`)
          .set('X-Tenant-Id', kumarTenantId),
      ]);

      const kzEmails = new Set<string>(
        kz.body.data.map((c: { email: string }) => c.email).filter(Boolean),
      );
      expect(kzEmails.has(TENANTS.kickzone.customer)).toBe(true);
      expect(kzEmails.has(TENANTS.kumarstore.customer)).toBe(false);

      const kmEmails = new Set<string>(
        km.body.data.map((c: { email: string }) => c.email).filter(Boolean),
      );
      expect(kmEmails.has(TENANTS.kumarstore.customer)).toBe(true);
      expect(kmEmails.has(TENANTS.kickzone.customer)).toBe(false);
    });
  });

  // ===================================================================
  // Layer 5 — audience separation and privilege boundaries
  // ===================================================================
  describe('Layer 5: audience and privilege boundaries', () => {
    it('REJECTS a shopper token on merchant routes', async () => {
      const res = await onApi(app)
        .get('/merchant/orders')
        .set('Authorization', `Bearer ${kickzoneCustomerToken}`)
        .set('X-Tenant-Id', kickzoneTenantId);

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('REJECTS a merchant token on shopper routes', async () => {
      const res = await onHost(app, TENANTS.kickzone.host)
        .get('/auth/customer/me')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);
      expect(res.status).toBe(403);
    });

    it('REJECTS a merchant token on platform routes', async () => {
      const res = await onApi(app)
        .get('/platform/tenants')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`);
      expect(res.status).toBe(403);
    });

    it('REJECTS an unauthenticated request to any private route', async () => {
      for (const path of ['/merchant/products', '/platform/tenants', '/orders', '/addresses']) {
        const res = await onApi(app).get(path);
        expect(res.status).toBe(401);
      }
    });

    it('REJECTS a forged or corrupted bearer token', async () => {
      const res = await onApi(app)
        .get('/merchant/products')
        .set('Authorization', 'Bearer not.a.real.token')
        .set('X-Tenant-Id', kickzoneTenantId);
      expect(res.status).toBe(401);
    });

    it('enforces RBAC within a tenant (a manager cannot manage staff)', async () => {
      const staff = await loginAdmin(app, TENANTS.kickzone.staff);
      const res = await onApi(app)
        .post('/merchant/staff')
        .set('Authorization', `Bearer ${staff.token}`)
        .set('X-Tenant-Id', kickzoneTenantId)
        .send({ email: 'intruder@example.com', firstName: 'Intruder', role: 'STAFF' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('INSUFFICIENT_PERMISSIONS');
    });

    it('lets a super admin read across tenants (and only a super admin)', async () => {
      const res = await onApi(app)
        .get('/platform/tenants')
        .set('Authorization', `Bearer ${superAdminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(3);
    });
  });

  // ===================================================================
  // Malicious input aimed specifically at the tenant boundary
  // ===================================================================
  describe('Malicious tenant_id injection attempts', () => {
    it('ignores a tenantId in the request body', async () => {
      const res = await onApi(app)
        .post('/merchant/categories')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .set('X-Tenant-Id', kickzoneTenantId)
        .send({ name: `Probe ${Date.now()}`, tenantId: kumarTenantId });

      // The category is created — but in KickZone, not Kumar Store.
      expect([200, 201]).toContain(res.status);

      const kumarCategories = await onApi(app)
        .get('/merchant/categories')
        .set('Authorization', `Bearer ${kumarOwner.token}`)
        .set('X-Tenant-Id', kumarTenantId);

      const names = (kumarCategories.body.data as { name: string }[]).map((c) => c.name);
      expect(names).not.toContain(res.body.data.name);
    });

    it('ignores a tenantId in the query string', async () => {
      const res = await onApi(app)
        .get(`/merchant/products?tenantId=${kumarTenantId}&limit=100`)
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .set('X-Tenant-Id', kickzoneTenantId);

      expect(res.status).toBe(200);

      const kumar = await onApi(app)
        .get('/merchant/products?limit=100')
        .set('Authorization', `Bearer ${kumarOwner.token}`)
        .set('X-Tenant-Id', kumarTenantId);

      const kumarIds = new Set<string>(kumar.body.data.map((p: { id: string }) => p.id));
      for (const product of res.body.data as { id: string }[]) {
        expect(kumarIds.has(product.id)).toBe(false);
      }
    });

    it('rejects a malformed tenant header without leaking anything', async () => {
      for (const value of ["'; DROP TABLE tenants; --", '../../etc/passwd', '%00', 'null']) {
        const res = await onApi(app)
          .get('/merchant/products')
          .set('Authorization', `Bearer ${kickzoneOwner.token}`)
          .set('X-Tenant-Id', value);
        expect([400, 403, 404]).toContain(res.status);
      }

      // The table is, of course, still there.
      await expect(master.tenant.count()).resolves.toBeGreaterThan(0);
    });

    it('does not accept a tenant slug header to escape membership checks', async () => {
      const res = await onApi(app)
        .get('/merchant/products')
        .set('Authorization', `Bearer ${kickzoneOwner.token}`)
        .set('X-Tenant-Slug', 'kumarstore');

      // Resolving a *storefront* by slug never grants merchant access.
      expect([403]).toContain(res.status);
    });
  });
});
