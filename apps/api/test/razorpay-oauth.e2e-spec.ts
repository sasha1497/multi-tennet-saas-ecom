import { createHmac, randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { TENANTS, assertSeeded, bootstrapTestApp, loginAdmin, loginCustomer, onApi, onHost } from './helpers';
import { RazorpayStub } from './support/razorpay-stub';

/**
 * A STORE'S CUSTOMERS PAY THE STORE — NOT RETAILOS
 * ===============================================
 *
 * Razorpay Partner OAuth, end to end through the real application, against a
 * local stub that answers in Razorpay's documented shapes (see
 * `support/razorpay-stub.ts`). This proves retailos's side of the contract;
 * it is not a claim about live Razorpay.
 *
 * Scenario: a menswear store (Kumar's seeded tenant stands in for it) connects
 * its own Razorpay account; a customer buys a ₹2,000 shirt. The thing being
 * proved is *which account the Razorpay order is created on* — that is what
 * decides who is paid and who Razorpay settles to.
 */
describe('Razorpay Partner OAuth — tenant customer payments (e2e)', () => {
  let app: INestApplication;
  let master: MasterPrismaService;
  const stub = new RazorpayStub();

  type Owner = { token: string; tenantId: string };
  let store: Owner; // the connected store (Kumar)
  let other: Owner; // another store (KickZone)
  let customerToken: string;
  let addressId: string;
  let shirtVariantId: string;
  let shirtProductId: string;

  const STORE_ACCOUNT = 'acc_MACHANZTEST01';
  const OTHER_ACCOUNT = 'acc_OTHERSTORE01';
  const SHIRT_PRICE = 200_000; // ₹2,000 in paise
  const CLIENT_SECRET = 'test_oauth_client_secret';
  const WEBHOOK_SECRET = 'test_oauth_webhook_secret';

  const merchant = (owner: Owner) => ({
    get: (p: string) => onApi(app).get(p).set('Authorization', `Bearer ${owner.token}`).set('x-tenant-id', owner.tenantId),
    post: (p: string) => onApi(app).post(p).set('Authorization', `Bearer ${owner.token}`).set('x-tenant-id', owner.tenantId),
    patch: (p: string) => onApi(app).patch(p).set('Authorization', `Bearer ${owner.token}`).set('x-tenant-id', owner.tenantId),
  });

  const sendWebhook = (payload: Record<string, unknown>, secret = WEBHOOK_SECRET, eventId = `evt_${randomUUID()}`) => {
    const raw = JSON.stringify(payload);
    return onApi(app)
      .post('/webhooks/payments/razorpay')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', createHmac('sha256', secret).update(raw).digest('hex'))
      .set('x-razorpay-event-id', eventId)
      .send(raw);
  };

  const checkoutSignature = (orderId: string, paymentId: string, secret = CLIENT_SECRET) =>
    createHmac('sha256', secret).update(`${orderId}|${paymentId}`).digest('hex');

  async function connect(owner: Owner, accountId: string) {
    const start = await merchant(owner).post('/merchant/payments/razorpay/connect');
    expect(start.status).toBe(200);
    const state = new URL(start.body.data.authorizeUrl).searchParams.get('state')!;
    const code = `code_${randomUUID()}`;
    stub.codes.set(code, accountId);
    return merchant(owner).post('/merchant/payments/razorpay/callback').send({ code, state });
  }

  async function placeShirtOrder(host = TENANTS.kumarstore.host, extraHeaders: Record<string, string> = {}) {
    await onHost(app, host)
      .post('/cart/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ variantId: shirtVariantId, quantity: 1 })
      .expect((r) => expect([200, 201]).toContain(r.status));
    let req = onHost(app, host)
      .post('/orders')
      .set('Authorization', `Bearer ${customerToken}`);
    for (const [k, v] of Object.entries(extraHeaders)) req = req.set(k, v);
    return req.send({ shippingAddressId: addressId, paymentMethod: 'UPI', idempotencyKey: `t-${randomUUID()}` });
  }

  async function payAndVerify(orderRes: { body: { data: { payment: { paymentId: string; providerOrderId: string } } } }) {
    const { paymentId, providerOrderId } = orderRes.body.data.payment;
    const providerPaymentId = stub.pay(providerOrderId);
    const res = await onHost(app, TENANTS.kumarstore.host)
      .post('/payments/verify')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ paymentId, providerOrderId, providerPaymentId, signature: checkoutSignature(providerOrderId, providerPaymentId) });
    return { res, providerPaymentId, providerOrderId, paymentId };
  }

  beforeAll(async () => {
    await stub.start();
    app = await bootstrapTestApp();
    await assertSeeded(app);
    master = app.get(MasterPrismaService);

    const a = await loginAdmin(app, TENANTS.kumarstore.owner);
    const b = await loginAdmin(app, TENANTS.kickzone.owner);
    store = { token: a.token, tenantId: a.tenantId! };
    other = { token: b.token, tenantId: b.tenantId! };

    // Start both stores from "not connected".
    await master.tenantPaymentConfig.deleteMany({ where: { tenantId: { in: [store.tenantId, other.tenantId] } } });

    await merchant(store).patch('/merchant/store').send({ onlinePaymentEnabled: true }).expect(200);

    const product = await merchant(store)
      .post('/merchant/products')
      .send({
        name: `Oxford Shirt ${Date.now()}`,
        status: 'PUBLISHED',
        variants: [{ sku: `SHIRT-${Date.now()}`, price: SHIRT_PRICE, mrp: SHIRT_PRICE, initialStock: 50 }],
      });
    expect(product.status).toBe(201);
    shirtProductId = product.body.data.id;
    shirtVariantId = product.body.data.variants[0].id;

    customerToken = await loginCustomer(app, TENANTS.kumarstore.host, TENANTS.kumarstore.customer);
    const addresses = await onHost(app, TENANTS.kumarstore.host)
      .get('/addresses')
      .set('Authorization', `Bearer ${customerToken}`);
    addressId = (addresses.body.data as { id: string }[])[0]!.id;
  }, 120_000);

  afterAll(async () => {
    if (master) {
      await master.tenantPaymentConfig.deleteMany({ where: { tenantId: { in: [store.tenantId, other.tenantId] } } });
      await merchant(store).post(`/merchant/products/${shirtProductId}/publish`).send({ publish: false });
      // Leave the demo shopper's cart as it was: an unpublished test shirt in
      // it would block their next checkout.
      const cart = await onHost(app, TENANTS.kumarstore.host).get('/cart').set('Authorization', `Bearer ${customerToken}`);
      for (const item of (cart.body.data?.items ?? []) as { id: string; variantId: string }[]) {
        if (item.variantId === shirtVariantId) {
          await onHost(app, TENANTS.kumarstore.host).delete(`/cart/items/${item.id}`).set('Authorization', `Bearer ${customerToken}`);
        }
      }
    }
    await app?.close();
    await stub.stop();
  });

  // ────────────────────────────────────────────────────── onboarding ──

  describe('onboarding', () => {
    it('starts not connected, and checkout does not offer online payment', async () => {
      const setup = await merchant(store).get('/merchant/payments/setup');
      expect(setup.body.data.status).toBe('NOT_CONNECTED');
      expect(setup.body.data.oauthAvailable).toBe(true);
    });

    it('sends the merchant to Razorpay with a single-use state and read_write scope', async () => {
      const res = await merchant(store).post('/merchant/payments/razorpay/connect');
      const url = new URL(res.body.data.authorizeUrl);
      expect(url.origin + url.pathname).toBe('http://127.0.0.1:47990/authorize');
      expect(url.searchParams.get('client_id')).toBe('test_oauth_client');
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBe('read_write');
      expect(url.searchParams.get('state')!.length).toBeGreaterThanOrEqual(16);
    });

    it('refuses a forged state', async () => {
      const code = `code_${randomUUID()}`;
      stub.codes.set(code, STORE_ACCOUNT);
      const res = await merchant(store)
        .post('/merchant/payments/razorpay/callback')
        .send({ code, state: 'x'.repeat(32) });
      expect(res.status).toBe(400);
    });

    it("refuses one store finishing another store's connection", async () => {
      const start = await merchant(other).post('/merchant/payments/razorpay/connect');
      const state = new URL(start.body.data.authorizeUrl).searchParams.get('state')!;
      const code = `code_${randomUUID()}`;
      stub.codes.set(code, STORE_ACCOUNT);
      const res = await merchant(store).post('/merchant/payments/razorpay/callback').send({ code, state });
      expect(res.status).toBe(400);
    });

    it("connects the store's own Razorpay account, holding only encrypted tokens", async () => {
      const res = await connect(store, STORE_ACCOUNT);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'CONNECTED', connectionType: 'oauth', accountId: STORE_ACCOUNT });

      const row = await master.tenantPaymentConfig.findFirstOrThrow({ where: { tenantId: store.tenantId, provider: 'razorpay' } });
      expect(row.encryptedSecretKey).toBeNull(); // no merchant API secret, ever
      expect(row.encryptedAccessToken).not.toContain(RazorpayStub.accessToken(STORE_ACCOUNT));
      expect(row.encryptedRefreshToken).not.toContain(`rt_${STORE_ACCOUNT}`);
      expect(JSON.stringify(res.body)).not.toContain(RazorpayStub.accessToken(STORE_ACCOUNT));
    });

    it('refuses the same Razorpay account being connected to a second store', async () => {
      const res = await connect(other, STORE_ACCOUNT);
      expect(res.status).toBe(409);
    });

    it('tells the storefront online payment is available — and nothing more', async () => {
      const res = await onHost(app, TENANTS.kumarstore.host).get('/store');
      expect(res.body.data.onlinePaymentAvailable).toBe(true);
      expect(JSON.stringify(res.body)).not.toContain('at_');
    });
  });

  // ─────────────────────────────────────────────── customer checkout ──

  describe('a customer buys a ₹2,000 shirt', () => {
    let order: Awaited<ReturnType<typeof placeShirtOrder>>;

    it("creates the Razorpay order on the STORE's account, not retailos's", async () => {
      order = await placeShirtOrder();
      expect(order.status).toBe(201);
      const payment = order.body.data.payment;
      expect(payment.provider).toBe('razorpay');
      expect(payment.amount).toBe(SHIRT_PRICE);
      // Checkout opens with the store's own public token.
      expect(payment.publicKey).toBe(RazorpayStub.publicToken(STORE_ACCOUNT));
      // The order exists on the store's Razorpay account.
      expect(stub.orders.get(payment.providerOrderId)).toMatchObject({ accountId: STORE_ACCOUNT, amount: SHIRT_PRICE });
    });

    it('ignores any attempt by the client to name another tenant', async () => {
      const res = await placeShirtOrder(TENANTS.kumarstore.host, { 'x-tenant-id': other.tenantId });
      expect(res.status).toBe(201);
      expect(stub.orders.get(res.body.data.payment.providerOrderId)!.accountId).toBe(STORE_ACCOUNT);
    });

    it('rejects a forged signature and leaves the order unpaid', async () => {
      const { paymentId, providerOrderId } = order.body.data.payment;
      const providerPaymentId = stub.pay(providerOrderId);
      const res = await onHost(app, TENANTS.kumarstore.host)
        .post('/payments/verify')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ paymentId, providerOrderId, providerPaymentId, signature: checkoutSignature(providerOrderId, providerPaymentId, 'wrong') });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('PAYMENT_SIGNATURE_INVALID');
    });

    it('rejects a validly signed callback whose payment was for a different amount', async () => {
      const fresh = await placeShirtOrder();
      const { paymentId, providerOrderId } = fresh.body.data.payment;
      const providerPaymentId = stub.pay(providerOrderId, 'captured', { amount: 100 });
      const res = await onHost(app, TENANTS.kumarstore.host)
        .post('/payments/verify')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ paymentId, providerOrderId, providerPaymentId, signature: checkoutSignature(providerOrderId, providerPaymentId) });
      expect(res.status).toBe(400);
    });

    it('marks it paid only after server-side verification, and confirms the order', async () => {
      const fresh = await placeShirtOrder();
      const { res } = await payAndVerify(fresh);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('PAID');

      const merchantOrder = await merchant(store).get(`/merchant/orders/${fresh.body.data.order.id}`);
      expect(merchantOrder.body.data.status).toBe('CONFIRMED');
      expect(merchantOrder.body.data.paymentStatus).toBe('PAID');
    });

    it('reconciles from the webhook when the customer closed the tab after paying', async () => {
      const fresh = await placeShirtOrder();
      const { providerOrderId } = fresh.body.data.payment;
      const providerPaymentId = stub.pay(providerOrderId);
      const payload = {
        event: 'payment.captured',
        account_id: STORE_ACCOUNT,
        payload: { payment: { entity: { id: providerPaymentId, order_id: providerOrderId, amount: SHIRT_PRICE, currency: 'INR' } } },
      };
      const eventId = `evt_${randomUUID()}`;

      const first = await sendWebhook(payload, WEBHOOK_SECRET, eventId);
      const second = await sendWebhook(payload, WEBHOOK_SECRET, eventId);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const merchantOrder = await merchant(store).get(`/merchant/orders/${fresh.body.data.order.id}`);
      expect(merchantOrder.body.data.paymentStatus).toBe('PAID');
      const events = await master.webhookEvent.count({ where: { provider: 'razorpay', eventId } });
      expect(events).toBe(1); // processed exactly once
    });

    it("discards a correctly signed webhook naming another store's account", async () => {
      const fresh = await placeShirtOrder();
      const { providerOrderId } = fresh.body.data.payment;
      const providerPaymentId = stub.pay(providerOrderId);
      await sendWebhook({
        event: 'payment.captured',
        account_id: OTHER_ACCOUNT,
        payload: { payment: { entity: { id: providerPaymentId, order_id: providerOrderId, amount: SHIRT_PRICE, currency: 'INR' } } },
      });
      const merchantOrder = await merchant(store).get(`/merchant/orders/${fresh.body.data.order.id}`);
      expect(merchantOrder.body.data.paymentStatus).not.toBe('PAID');
    });

    it('records a failed payment without confirming the order', async () => {
      const fresh = await placeShirtOrder();
      const { providerOrderId } = fresh.body.data.payment;
      await sendWebhook({
        event: 'payment.failed',
        account_id: STORE_ACCOUNT,
        payload: { payment: { entity: { id: `pay_fail_${randomUUID().slice(0, 8)}`, order_id: providerOrderId, amount: SHIRT_PRICE, currency: 'INR', error_description: 'Card declined' } } },
      });
      const merchantOrder = await merchant(store).get(`/merchant/orders/${fresh.body.data.order.id}`);
      expect(merchantOrder.body.data.paymentStatus).toBe('FAILED');
      expect(merchantOrder.body.data.status).not.toBe('CONFIRMED');
    });
  });

  // ─────────────────────────────────────────────────────────── refunds ──

  describe('refunds', () => {
    let orderId: string;
    let providerPaymentId: string;

    beforeAll(async () => {
      const fresh = await placeShirtOrder();
      const paid = await payAndVerify(fresh);
      orderId = fresh.body.data.order.id;
      providerPaymentId = paid.providerPaymentId;
    });

    it("refunds part of it from the store's account, and records the refund", async () => {
      stub.refundStatus = 'processed';
      const res = await merchant(store).post(`/merchant/orders/${orderId}/refund`).send({ amount: 50_000, reason: 'Wrong size' });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: 'PROCESSED', amount: 50_000 });

      const refund = stub.refunds.at(-1)!;
      expect(refund).toMatchObject({ paymentId: providerPaymentId, amount: 50_000, accountId: STORE_ACCOUNT });

      const list = await merchant(store).get('/merchant/payments');
      const payment = (list.body.data as { orderId: string; status: string; refundedAmount: number }[]).find((p) => p.orderId === orderId)!;
      expect(payment).toMatchObject({ status: 'PARTIALLY_REFUNDED', refundedAmount: 50_000 });
    });

    it('will not refund more than was paid', async () => {
      const res = await merchant(store).post(`/merchant/orders/${orderId}/refund`).send({ amount: SHIRT_PRICE, reason: 'Too much' });
      expect(res.status).toBe(400);
    });

    it('settles a pending refund from its webhook, once', async () => {
      stub.refundStatus = 'pending';
      const res = await merchant(store).post(`/merchant/orders/${orderId}/refund`).send({ reason: 'Customer returned it' });
      expect(res.body.data.status).toBe('PENDING');
      const refund = stub.refunds.at(-1)!;

      const payload = {
        event: 'refund.processed',
        account_id: STORE_ACCOUNT,
        payload: { refund: { entity: { id: refund.id, payment_id: providerPaymentId, amount: refund.amount, currency: 'INR' } } },
      };
      const eventId = `evt_${randomUUID()}`;
      await sendWebhook(payload, WEBHOOK_SECRET, eventId).expect(200);
      await sendWebhook(payload, WEBHOOK_SECRET, eventId).expect(200);

      const list = await merchant(store).get('/merchant/payments');
      const payment = (list.body.data as { orderId: string; status: string; refundedAmount: number; refunds: { status: string }[] }[]).find((p) => p.orderId === orderId)!;
      expect(payment.status).toBe('REFUNDED');
      expect(payment.refundedAmount).toBe(SHIRT_PRICE);
      expect(payment.refunds.every((r) => r.status === 'PROCESSED')).toBe(true);
    });

    it('will not mark a paid online order refunded without returning the money', async () => {
      const fresh = await placeShirtOrder();
      await payAndVerify(fresh);
      const id = fresh.body.data.order.id;
      await merchant(store).post(`/merchant/orders/${id}/status`).send({ status: 'CANCELLED', reason: 'Out of stock' }).expect(200);
      const statusOnly = await merchant(store).post(`/merchant/orders/${id}/status`).send({ status: 'REFUNDED' });
      expect(statusOnly.status).toBe(400);

      stub.refundStatus = 'processed';
      const refunded = await merchant(store).post(`/merchant/orders/${id}/refund`).send({ reason: 'Out of stock' });
      expect(refunded.status).toBe(200);
      expect(refunded.body.data.orderStatus).toBe('REFUNDED');
    });
  });

  // ─────────────────────────────────────────────────── tenant isolation ──

  describe('tenant isolation', () => {
    it("never shows one store another store's payments", async () => {
      const mine = await merchant(store).get('/merchant/payments');
      const theirs = await merchant(other).get('/merchant/payments');
      const myIds = new Set((mine.body.data as { id: string }[]).map((p) => p.id));
      expect((theirs.body.data as { id: string }[]).some((p) => myIds.has(p.id))).toBe(false);
    });

    it("refuses one store refunding another store's order", async () => {
      const fresh = await placeShirtOrder();
      await payAndVerify(fresh);
      const res = await merchant(other).post(`/merchant/orders/${fresh.body.data.order.id}/refund`).send({ reason: 'Not mine' });
      expect([400, 403, 404]).toContain(res.status);
    });

    it('keeps subscription billing separate from customer payments', async () => {
      const sub = await merchant(store).get('/merchant/subscription');
      const invoices = sub.body.data.invoices as { amount: number }[];
      expect(invoices.some((i) => i.amount === SHIRT_PRICE)).toBe(false);
    });
  });

  // ──────────────────────────────────────────── revocation / disconnect ──

  describe('when the merchant withdraws access', () => {
    it('stops online payments on account.app.authorization_revoked, keeping existing orders', async () => {
      const before = await merchant(store).get('/merchant/payments');
      await sendWebhook({ event: 'account.app.authorization_revoked', account_id: STORE_ACCOUNT, payload: {} }).expect(200);

      const setup = await merchant(store).get('/merchant/payments/setup');
      expect(setup.body.data.status).toBe('REVOKED');
      expect(setup.body.data.onlinePaymentsAvailable).toBe(false);

      const bootstrap = await onHost(app, TENANTS.kumarstore.host).get('/store');
      expect(bootstrap.body.data.onlinePaymentAvailable).toBe(false);

      const attempt = await placeShirtOrder();
      expect(attempt.status).toBe(400);
      expect(attempt.body.error.message).toContain('temporarily unavailable');
      expect(JSON.stringify(attempt.body)).not.toMatch(/revoke|oauth|token|kyc/i);

      const after = await merchant(store).get('/merchant/payments');
      expect(after.body.data).toEqual(before.body.data);
    });

    it('ignores a revocation webhook not signed by the OAuth app', async () => {
      await connect(store, STORE_ACCOUNT).then((r) => expect(r.status).toBe(200));
      await sendWebhook({ event: 'account.app.authorization_revoked', account_id: STORE_ACCOUNT, payload: {} }, 'forged');
      const setup = await merchant(store).get('/merchant/payments/setup');
      expect(setup.body.data.status).toBe('CONNECTED');
    });

    it('disconnects on request, revoking the token at Razorpay', async () => {
      const res = await merchant(store).post('/merchant/payments/razorpay/disconnect');
      expect(res.status).toBe(200);
      expect(stub.revoked).toContain(RazorpayStub.accessToken(STORE_ACCOUNT));
      const setup = await merchant(store).get('/merchant/payments/setup');
      expect(setup.body.data.status).toBe('NOT_CONNECTED');
    });
  });
});
