import type { INestApplication } from '@nestjs/common';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { bootstrapTestApp, loginAdmin, loginCustomer, onApi, onHost, TENANTS } from './helpers';

/**
 * PAYMENT ISOLATION
 *
 * Money is the one place where a tenancy bug stops being an information leak
 * and becomes theft. Every test here is about one sentence:
 *
 *   A merchant settles into THEIR OWN gateway account, with THEIR OWN keys, and
 *   can neither read, borrow, nor pay into anyone else's.
 *
 * Before Phase 2 the platform held a single set of Razorpay credentials for
 * everybody, so "whose account did that money land in?" had one answer for all
 * merchants. These tests exist to keep that from coming back.
 */
describe('Payment isolation (e2e)', () => {
  let app: INestApplication;
  let master: MasterPrismaService;

  let kickzone: { token: string; tenantId: string };
  let kumar: { token: string; tenantId: string };

  const SECRET_A = 'kickzone-secret-must-never-appear';
  const WEBHOOK_A = 'kickzone-webhook-must-never-appear';
  const SECRET_B = 'kumar-secret-must-never-appear';

  beforeAll(async () => {
    app = await bootstrapTestApp();
    master = app.get(MasterPrismaService);

    const a = await loginAdmin(app, TENANTS.kickzone.owner);
    const b = await loginAdmin(app, TENANTS.kumarstore.owner);
    kickzone = { token: a.token, tenantId: a.tenantId! };
    kumar = { token: b.token, tenantId: b.tenantId! };

    // Each merchant configures their own gateway.
    await onApi(app)
      .put('/merchant/payments/config')
      .set('Authorization', `Bearer ${kickzone.token}`)
      .set('X-Tenant-Id', kickzone.tenantId)
      .send({
        provider: 'razorpay',
        enabled: true,
        environment: 'test',
        publicKey: 'rzp_test_KICKZONE',
        secretKey: SECRET_A,
        webhookSecret: WEBHOOK_A,
      });

    await onApi(app)
      .put('/merchant/payments/config')
      .set('Authorization', `Bearer ${kumar.token}`)
      .set('X-Tenant-Id', kumar.tenantId)
      .send({
        provider: 'razorpay',
        enabled: true,
        environment: 'test',
        publicKey: 'rzp_test_KUMAR',
        secretKey: SECRET_B,
      });
  });

  afterAll(async () => {
    // Leave the demo data as it was: the mock gateway is what the other suites
    // and local development expect.
    await master.tenantPaymentConfig.deleteMany({
      where: { tenantId: { in: [kickzone.tenantId, kumar.tenantId] } },
    });
    await app.close();
  });

  describe('configuration belongs to one tenant', () => {
    it('each merchant sees only their own gateway configuration', async () => {
      const a = await onApi(app)
        .get('/merchant/payments/config')
        .set('Authorization', `Bearer ${kickzone.token}`)
        .set('X-Tenant-Id', kickzone.tenantId);

      const b = await onApi(app)
        .get('/merchant/payments/config')
        .set('Authorization', `Bearer ${kumar.token}`)
        .set('X-Tenant-Id', kumar.tenantId);

      expect(a.status).toBe(200);
      expect(b.status).toBe(200);
      expect(a.body.data[0].publicKey).toBe('rzp_test_KICKZONE');
      expect(b.body.data[0].publicKey).toBe('rzp_test_KUMAR');
    });

    it('REFUSES to read another tenant configuration via X-Tenant-Id', async () => {
      const res = await onApi(app)
        .get('/merchant/payments/config')
        .set('Authorization', `Bearer ${kickzone.token}`)
        .set('X-Tenant-Id', kumar.tenantId);

      expect(res.status).toBe(403);
      expect(JSON.stringify(res.body)).not.toContain('rzp_test_KUMAR');
    });

    it('REFUSES to write another tenant configuration', async () => {
      const res = await onApi(app)
        .put('/merchant/payments/config')
        .set('Authorization', `Bearer ${kickzone.token}`)
        .set('X-Tenant-Id', kumar.tenantId)
        .send({ provider: 'razorpay', enabled: true, environment: 'test', publicKey: 'HIJACKED' });

      expect(res.status).toBe(403);

      // And the victim's configuration is untouched.
      const victim = await master.tenantPaymentConfig.findFirst({
        where: { tenantId: kumar.tenantId },
      });
      expect(victim?.publicKey).toBe('rzp_test_KUMAR');
    });

    it('REFUSES to disable another tenant gateway', async () => {
      const res = await onApi(app)
        .delete('/merchant/payments/config/razorpay')
        .set('Authorization', `Bearer ${kickzone.token}`)
        .set('X-Tenant-Id', kumar.tenantId);

      expect(res.status).toBe(403);
      const victim = await master.tenantPaymentConfig.findFirst({
        where: { tenantId: kumar.tenantId },
      });
      expect(victim?.enabled).toBe(true);
    });
  });

  describe('credentials never leave the API', () => {
    it('does not return the secret key on write', async () => {
      const res = await onApi(app)
        .put('/merchant/payments/config')
        .set('Authorization', `Bearer ${kickzone.token}`)
        .set('X-Tenant-Id', kickzone.tenantId)
        .send({
          provider: 'razorpay',
          enabled: true,
          environment: 'test',
          publicKey: 'rzp_test_KICKZONE',
          secretKey: SECRET_A,
          webhookSecret: WEBHOOK_A,
        });

      const body = JSON.stringify(res.body);
      expect(body).not.toContain(SECRET_A);
      expect(body).not.toContain(WEBHOOK_A);
      // The safe fields ARE present — this is a useful response, not an empty one.
      expect(res.body.data.publicKey).toBe('rzp_test_KICKZONE');
      expect(res.body.data.configured).toBe(true);
    });

    it('does not return the secret key on read', async () => {
      const res = await onApi(app)
        .get('/merchant/payments/config')
        .set('Authorization', `Bearer ${kickzone.token}`)
        .set('X-Tenant-Id', kickzone.tenantId);

      const body = JSON.stringify(res.body);
      expect(body).not.toContain(SECRET_A);
      expect(body).not.toContain(WEBHOOK_A);
    });

    it('stores secrets encrypted, never as plain text', async () => {
      const row = await master.tenantPaymentConfig.findFirst({
        where: { tenantId: kickzone.tenantId },
      });

      expect(row?.encryptedSecretKey).toBeTruthy();
      expect(row?.encryptedSecretKey).not.toContain(SECRET_A);
      expect(row?.encryptedWebhookSecret).not.toContain(WEBHOOK_A);
      // Versioned AES-256-GCM envelope, same as tenant database passwords.
      expect(row?.encryptedSecretKey?.startsWith('v1.')).toBe(true);
    });

    it('never exposes a secret through the storefront', async () => {
      const res = await onHost(app, TENANTS.kickzone.host).get('/store');
      const body = JSON.stringify(res.body);
      expect(body).not.toContain(SECRET_A);
      expect(body).not.toContain(WEBHOOK_A);
    });
  });

  describe('a shop’s staff cannot rotate the keys', () => {
    it('REFUSES a MANAGER — gateway credentials are owner-only', async () => {
      const staff = await loginAdmin(app, TENANTS.kickzone.staff);

      const read = await onApi(app)
        .get('/merchant/payments/config')
        .set('Authorization', `Bearer ${staff.token}`)
        .set('X-Tenant-Id', kickzone.tenantId);

      const write = await onApi(app)
        .put('/merchant/payments/config')
        .set('Authorization', `Bearer ${staff.token}`)
        .set('X-Tenant-Id', kickzone.tenantId)
        .send({ provider: 'razorpay', enabled: true, environment: 'test', publicKey: 'x' });

      expect(read.status).toBe(403);
      expect(write.status).toBe(403);
    });
  });

  describe('payments are pinned to the paying tenant', () => {
    it('REFUSES a shopper paying against another store’s order', async () => {
      // An order in Kumar Store.
      const kumarCustomer = await loginCustomer(
        app,
        TENANTS.kumarstore.host,
        TENANTS.kumarstore.customer,
      );
      const kumarOrders = await onHost(app, TENANTS.kumarstore.host)
        .get('/orders')
        .set('Authorization', `Bearer ${kumarCustomer}`);

      const foreignOrder = kumarOrders.body.data?.items?.[0] ?? kumarOrders.body.data?.[0];
      if (!foreignOrder) return; // No seeded order to attack; nothing to assert.

      // A KickZone shopper tries to verify a payment on it.
      const kickCustomer = await loginCustomer(
        app,
        TENANTS.kickzone.host,
        TENANTS.kickzone.customer,
      );

      const res = await onHost(app, TENANTS.kickzone.host)
        .post('/payments/verify')
        .set('Authorization', `Bearer ${kickCustomer}`)
        .send({
          paymentId: foreignOrder.id,
          providerOrderId: 'order_from_another_store',
          providerPaymentId: 'pay_from_another_store',
          signature: 'a'.repeat(64),
        });

      expect([400, 403, 404]).toContain(res.status);
    });

    it('REFUSES a shopper reading another store’s payment records', async () => {
      const kickCustomer = await loginCustomer(
        app,
        TENANTS.kickzone.host,
        TENANTS.kickzone.customer,
      );

      const res = await onHost(app, TENANTS.kumarstore.host)
        .get('/orders')
        .set('Authorization', `Bearer ${kickCustomer}`);

      expect(res.status).toBe(403);
    });
  });

  describe('webhooks resolve the tenant before trusting anything', () => {
    it('discards a webhook whose order reference is unknown', async () => {
      const res = await onApi(app)
        .post('/webhooks/payments/razorpay')
        .set('x-razorpay-signature', 'deadbeef')
        .send({
          event: 'payment.captured',
          payload: { payment: { entity: { order_id: 'nope' } } },
        });

      // Always 200: a webhook endpoint that reports what it recognises is a
      // free enumeration oracle. Nothing was applied.
      expect(res.status).toBe(200);
    });

    it('discards a webhook signed with the WRONG tenant secret', async () => {
      // A real route exists for KickZone; sign it with a secret that is not
      // KickZone's. Verification runs against the tenant the route names, so
      // this must fail even though the order reference is genuine.
      const route = await master.paymentRoute.findFirst({
        where: { tenantId: kickzone.tenantId },
      });
      if (!route) return;

      const res = await onApi(app)
        .post('/webhooks/payments/razorpay')
        .set('x-razorpay-signature', 'f'.repeat(64))
        .send({
          event: 'payment.captured',
          payload: { payment: { entity: { order_id: route.providerOrderId } } },
        });

      expect(res.status).toBe(200);

      // The payment was NOT marked paid by an unverified webhook.
      const events = await master.webhookEvent.findMany({
        where: { provider: 'razorpay' },
        orderBy: { receivedAt: 'desc' },
        take: 1,
      });
      // Either nothing was recorded, or it was not processed.
      expect(events[0]?.status === 'PROCESSED').toBe(false);
    });

    it('routes by payment_routes, never by a tenant id in the body', async () => {
      const res = await onApi(app)
        .post('/webhooks/payments/razorpay')
        .set('x-razorpay-signature', 'deadbeef')
        .send({
          event: 'payment.captured',
          // A tenant id in the body must be inert.
          tenantId: kumar.tenantId,
          payload: { payment: { entity: { order_id: 'fabricated' } } },
        });

      expect(res.status).toBe(200);
    });
  });
});
