import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, forwardRef } from '@nestjs/common';
import type {
  Money,
  NormalisedPaymentEvent,
  PaymentIntent,
  PaymentMethod,
  VerifyPaymentResponse,
} from '@retailos/types';
import { AuditAction } from '@retailos/types';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import {
  TenantDatabaseService,
  type TenantTransactionClient,
} from '@/core/database/tenant-database.service';
import { AppLogger } from '@/core/logger/logger.service';
import { AuditService } from '@/modules/audit/audit.service';
import { OrdersService } from '@/modules/orders/orders.service';
import type { PaymentProviderAdapter } from './payment-provider.interface';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentConfigService, type PaymentCredentials } from './payment-config.service';

@Injectable()
export class PaymentsService {
  private readonly logger: AppLogger;

  constructor(
    private readonly providers: PaymentProviderRegistry,
    private readonly paymentConfig: PaymentConfigService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly master: MasterPrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => OrdersService)) private readonly orders: OrdersService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('PaymentsService');
  }

  /**
   * The gateway a specific tenant settles through, with that tenant's
   * credentials attached.
   *
   * Every payment operation goes through here. There is no ambient "current
   * provider" any more, so using another merchant's gateway would require
   * passing their tenant id — which the guards have already refused before any
   * of this runs.
   */
  private async gatewayFor(
    tenantId: string,
  ): Promise<{ adapter: PaymentProviderAdapter; credentials: PaymentCredentials }> {
    const credentials = await this.paymentConfig.resolve(tenantId);
    return { adapter: this.providers.get(credentials.provider), credentials };
  }

  /** Which gateway a tenant uses, by name. Safe to expose. */
  async providerNameFor(tenantId: string): Promise<string> {
    const credentials = await this.paymentConfig.resolve(tenantId);
    return credentials.provider;
  }

  /**
   * Creates the payment row and the gateway intent for a freshly placed order.
   *
   * Runs *inside* the order transaction so an order can never exist without its
   * payment record. The gateway call itself happens after commit (see
   * `attachProviderIntent`) because a slow third-party HTTP call must not hold a
   * database transaction — and therefore a stock reservation — open.
   */
  async createPaymentRecord(
    tx: TenantTransactionClient,
    params: {
      /** Whose gateway this payment belongs to. */
      tenantId: string;
      orderId: string;
      orderNumber: string;
      amount: Money;
      currency: string;
      method: PaymentMethod;
    },
  ): Promise<{ paymentId: string }> {
    // Reads the tenant's own gateway name. This is a master-database lookup,
    // not a query on the tenant transaction, so it does not extend the lock.
    const provider =
      params.method === 'COD' ? 'cod' : await this.providerNameFor(params.tenantId);

    const payment = await tx.payment.create({
      data: {
        orderId: params.orderId,
        provider,
        method: params.method,
        status: 'PENDING',
        amount: params.amount,
        currency: params.currency,
        // Deterministic per order+method: a duplicate submit collides on the
        // unique index instead of creating a second payment.
        idempotencyKey: `pay:${params.orderId}:${params.method}`,
      },
    });
    return { paymentId: payment.id };
  }

  /**
   * Calls the gateway and records the routing entry.
   *
   * The `payment_routes` row in the **master** database is what lets an
   * incoming webhook — which arrives on a shared platform URL with no tenant
   * hostname — be traced back to the right tenant database, without ever
   * trusting a tenant id from the webhook body.
   */
  async attachProviderIntent(params: {
    tenantId: string;
    tenantSlug: string;
    paymentId: string;
    orderId: string;
    orderNumber: string;
    amount: Money;
    currency: string;
    method: PaymentMethod;
    customer: { name: string; email: string | null; phone: string | null };
  }): Promise<PaymentIntent> {
    if (params.method === 'COD') {
      return {
        paymentId: params.paymentId,
        provider: 'cod',
        providerOrderId: null,
        amount: params.amount,
        currency: params.currency,
        status: 'PENDING',
        publicKey: null,
      };
    }

    // Resolved from the tenant, so the intent is created against THIS
    // merchant's gateway account and nobody else's.
    const { adapter, credentials } = await this.gatewayFor(params.tenantId);

    const intent = await adapter.createIntent(
      {
        paymentId: params.paymentId,
        orderId: params.orderId,
        orderNumber: params.orderNumber,
        amount: params.amount,
        currency: params.currency,
        method: params.method,
        customer: params.customer,
        tenantSlug: params.tenantSlug,
      },
      credentials,
    );

    await this.tenantDb.runFor(params.tenantId, (db) =>
      db.payment.update({
        where: { id: params.paymentId },
        data: {
          providerOrderId: intent.providerOrderId,
          providerPayload: (intent.metadata ?? {}) as never,
        },
      }),
    );

    if (intent.providerOrderId) {
      await this.master.paymentRoute.upsert({
        where: {
          provider_providerOrderId: {
            provider: adapter.name,
            providerOrderId: intent.providerOrderId,
          },
        },
        create: {
          provider: adapter.name,
          providerOrderId: intent.providerOrderId,
          tenantId: params.tenantId,
          paymentId: params.paymentId,
          orderId: params.orderId,
        },
        update: { paymentId: params.paymentId, orderId: params.orderId },
      });
    }

    return {
      paymentId: params.paymentId,
      provider: adapter.name,
      providerOrderId: intent.providerOrderId,
      amount: params.amount,
      currency: params.currency,
      status: 'PENDING',
      publicKey: intent.publicKey,
      checkoutUrl: intent.checkoutUrl ?? null,
      metadata: intent.metadata,
    };
  }

  /**
   * Client-side verification after the gateway SDK closes.
   *
   * Signature verification is mandatory and fails closed. Without it any shopper
   * could POST a fabricated success and get a free order — this is the single
   * most important check in the payment flow.
   */
  async verify(params: {
    paymentId: string;
    providerOrderId: string;
    providerPaymentId: string;
    signature: string;
  }): Promise<VerifyPaymentResponse> {
    const tenantId = this.tenantDb.tenantId;

    const payment = await this.tenantDb.run((db) =>
      db.payment.findUnique({
        where: { id: params.paymentId },
        include: { order: { select: { id: true, orderNumber: true, customerId: true } } },
      }),
    );
    if (!payment) throw Errors.notFound('Payment', params.paymentId);

    // Already settled — return the existing outcome rather than re-processing.
    if (payment.status === 'PAID') {
      return {
        paymentId: payment.id,
        orderId: payment.orderId,
        orderNumber: payment.order.orderNumber,
        status: 'PAID',
        verified: true,
      };
    }

    if (payment.providerOrderId && payment.providerOrderId !== params.providerOrderId) {
      throw Errors.paymentSignatureInvalid();
    }

    // Verified with the tenant's own key. A signature minted by another
    // merchant's gateway account must not settle an order here.
    const { adapter, credentials } = await this.gatewayFor(tenantId);
    const valid = adapter.verifySignature(
      {
        providerOrderId: params.providerOrderId,
        providerPaymentId: params.providerPaymentId,
        signature: params.signature,
      },
      credentials,
    );

    if (!valid) {
      await this.markFailed(tenantId, payment.id, 'Signature verification failed');
      this.logger.warn('Payment signature verification failed', {
        paymentId: payment.id,
        orderId: payment.orderId,
      });
      throw Errors.paymentSignatureInvalid();
    }

    await this.markPaid(tenantId, {
      paymentId: payment.id,
      providerPaymentId: params.providerPaymentId,
      signature: params.signature,
      source: 'client-verify',
    });

    return {
      paymentId: payment.id,
      orderId: payment.orderId,
      orderNumber: payment.order.orderNumber,
      status: 'PAID',
      verified: true,
    };
  }

  /**
   * Webhook entry point.
   *
   * Per-tenant credentials create an ordering problem worth stating plainly:
   * the signature can only be checked with the right tenant's webhook secret,
   * but the tenant is only known once the payload has been read. So the payload
   * is parsed first — WITHOUT trusting it — purely to find a payment route, and
   * only then is the signature verified with that tenant's secret.
   *
   * Nothing is authorised on the strength of the unverified read. Its only
   * output is a tenant id used to select a key; if the signature then fails,
   * the event is discarded having touched nothing.
   *
   * Five defences, all necessary:
   *   1. tenant resolution via `payment_routes`, never from the payload body
   *   2. signature verification over the raw body with THAT tenant's secret
   *   3. event de-duplication in the master `webhook_events` table
   *   4. an idempotent state transition, so a replay is a no-op
   *   5. the route also pins the payment and order, so a valid signature from
   *      one merchant cannot settle another merchant's order
   */
  async handleWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
    providerName: string,
  ): Promise<{ handled: boolean; reason?: string }> {
    if (!this.providers.has(providerName)) {
      return { handled: false, reason: 'unknown_provider' };
    }
    const adapter = this.providers.get(providerName);

    // Step 1 — untrusted read, only to find out whose webhook this is.
    const reference = adapter.extractOrderReference(rawBody);
    if (!reference) {
      this.logger.warn('Discarded webhook with no order reference', { provider: adapter.name });
      return { handled: false, reason: 'no_order_reference' };
    }

    const route = await this.master.paymentRoute.findUnique({
      where: {
        provider_providerOrderId: { provider: adapter.name, providerOrderId: reference },
      },
    });

    if (!route) {
      // Either a webhook for an order we never created, or a probe. Either way
      // there is no tenant, so there is no secret to verify against.
      this.logger.warn('Webhook for an unknown provider order', { provider: adapter.name });
      return { handled: false, reason: 'unknown_order' };
    }

    // Step 2 — NOW verify, with the credentials of the tenant that owns it.
    const credentials = await this.paymentConfig.resolve(route.tenantId);
    const event = adapter.verifyWebhook(rawBody, headers, credentials);
    if (!event) {
      // Never leak *why* it failed to an unauthenticated caller.
      this.logger.warn('Discarded unverifiable webhook', {
        provider: adapter.name,
        tenantId: route.tenantId,
      });
      return { handled: false, reason: 'invalid_signature' };
    }

    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    // De-duplicate: the unique index turns a redelivery into a cheap no-op.
    try {
      await this.master.webhookEvent.create({
        data: {
          provider: adapter.name,
          eventId: event.eventId.slice(0, 191),
          eventType: event.type,
          payloadHash,
          status: 'RECEIVED',
        },
      });
    } catch {
      this.logger.debug('Ignored duplicate webhook', { eventId: event.eventId });
      return { handled: true, reason: 'duplicate' };
    }

    try {
      const result = await this.routeAndApply(event, route);
      await this.master.webhookEvent.updateMany({
        where: { provider: adapter.name, eventId: event.eventId.slice(0, 191) },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      return result;
    } catch (err) {
      await this.master.webhookEvent.updateMany({
        where: { provider: adapter.name, eventId: event.eventId.slice(0, 191) },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 1000) },
      });
      this.logger.error('Webhook processing failed', err as Error, { eventId: event.eventId });
      throw err;
    }
  }

  /**
   * Applies a verified event to the tenant the route names.
   *
   * The route is passed in rather than looked up again, and that is deliberate:
   * it is the same row whose tenant supplied the webhook secret that verified
   * this event. Re-deriving it from the (now trusted) payload would open a gap
   * where a body could name one order while being signed for another.
   */
  private async routeAndApply(
    event: NormalisedPaymentEvent,
    route: { tenantId: string; paymentId: string; orderId: string },
  ): Promise<{ handled: boolean; reason?: string }> {
    switch (event.type) {
      case 'payment.captured':
        await this.markPaid(route.tenantId, {
          paymentId: route.paymentId,
          providerPaymentId: event.providerPaymentId ?? null,
          signature: null,
          source: 'webhook',
        });
        return { handled: true };

      case 'payment.failed':
        await this.markFailed(
          route.tenantId,
          route.paymentId,
          event.failureReason ?? 'Payment failed at the gateway',
        );
        return { handled: true };

      case 'refund.processed':
        this.logger.info('Refund confirmed by gateway', { paymentId: route.paymentId });
        return { handled: true };

      default:
        return { handled: true, reason: 'ignored_event_type' };
    }
  }

  /**
   * Transitions a payment to PAID and confirms the order.
   *
   * Idempotent by construction: the conditional UPDATE only fires when the row
   * is still unpaid, so a webhook and a client verify racing each other result
   * in exactly one confirmation.
   */
  async markPaid(
    tenantId: string,
    params: {
      paymentId: string;
      providerPaymentId: string | null;
      signature: string | null;
      source: string;
    },
  ): Promise<void> {
    const applied = await this.tenantDb.runFor(tenantId, async (db) => {
      const updated = await db.payment.updateMany({
        where: { id: params.paymentId, status: { in: ['PENDING', 'AUTHORIZED'] } },
        data: {
          status: 'PAID',
          providerPaymentId: params.providerPaymentId,
          providerSignature: params.signature,
          paidAt: new Date(),
          failureReason: null,
        },
      });
      return updated.count > 0;
    });

    if (!applied) {
      this.logger.debug('Payment was already settled; skipping', {
        paymentId: params.paymentId,
        source: params.source,
      });
      return;
    }

    const payment = await this.tenantDb.runFor(tenantId, (db) =>
      db.payment.findUnique({ where: { id: params.paymentId }, select: { orderId: true } }),
    );
    if (!payment) return;

    // Commits the stock reservation and moves the order to CONFIRMED.
    await this.orders.onPaymentSucceeded(tenantId, payment.orderId);

    this.audit.record('tenant', {
      action: AuditAction.PAYMENT_EVENT,
      tenantId,
      resourceType: 'payment',
      resourceId: params.paymentId,
      metadata: { status: 'PAID', source: params.source },
    });

    this.logger.info('Payment captured', {
      tenantId,
      paymentId: params.paymentId,
      orderId: payment.orderId,
      source: params.source,
    });
  }

  async markFailed(tenantId: string, paymentId: string, reason: string): Promise<void> {
    const applied = await this.tenantDb.runFor(tenantId, async (db) => {
      const updated = await db.payment.updateMany({
        where: { id: paymentId, status: { in: ['PENDING', 'AUTHORIZED'] } },
        data: { status: 'FAILED', failureReason: reason.slice(0, 500) },
      });
      return updated.count > 0;
    });
    if (!applied) return;

    const payment = await this.tenantDb.runFor(tenantId, (db) =>
      db.payment.findUnique({ where: { id: paymentId }, select: { orderId: true } }),
    );
    if (!payment) return;

    // Frees the reserved stock so it goes back on sale immediately.
    await this.orders.onPaymentFailed(tenantId, payment.orderId, reason);

    this.audit.record('tenant', {
      action: AuditAction.PAYMENT_EVENT,
      tenantId,
      resourceType: 'payment',
      resourceId: paymentId,
      metadata: { status: 'FAILED', reason },
    });
  }

  /** Merchant-initiated refund. */
  async refund(orderId: string, amount: Money | undefined, reason: string): Promise<void> {
    const tenantId = this.tenantDb.tenantId;

    const payment = await this.tenantDb.run((db) =>
      db.payment.findFirst({
        where: { orderId, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
        orderBy: { createdAt: 'desc' },
      }),
    );
    if (!payment) throw Errors.badRequest('There is no captured payment to refund for this order');

    const refundable = payment.amount - payment.refundedAmount;
    const requested = amount ?? refundable;
    if (requested <= 0 || requested > refundable) {
      throw Errors.badRequest(`The refundable amount for this order is ₹${(refundable / 100).toFixed(2)}`);
    }

    // COD never charged the customer, so there is nothing to send back through
    // a gateway — it is recorded and settled in person.
    if (payment.method !== 'COD' && payment.providerPaymentId) {
      const { adapter: refundAdapter, credentials: refundCreds } = await this.gatewayFor(tenantId);
      await refundAdapter.refund(
        {
          providerPaymentId: payment.providerPaymentId,
          amount: requested,
          reason,
          idempotencyKey: `refund:${payment.id}:${requested}`,
        },
        refundCreds,
      );
    }

    const totalRefunded = payment.refundedAmount + requested;
    await this.tenantDb.run((db) =>
      db.payment.update({
        where: { id: payment.id },
        data: {
          refundedAmount: totalRefunded,
          status: totalRefunded >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        },
      }),
    );

    this.audit.record('tenant', {
      action: AuditAction.PAYMENT_EVENT,
      resourceType: 'payment',
      resourceId: payment.id,
      metadata: { status: 'REFUNDED', amount: requested, reason },
    });

    this.logger.info('Refund recorded', { tenantId, paymentId: payment.id, amount: requested });
  }

  /**
   * Development-only: drives the mock gateway.
   *
   * Produces a real signature with the mock adapter's key so the normal
   * `verify()` path — including signature checking — is what actually runs.
   */
  async simulate(
    paymentId: string,
    outcome: 'success' | 'failure',
  ): Promise<VerifyPaymentResponse> {
    const tenantId = this.tenantDb.tenantId;
    const { adapter } = await this.gatewayFor(tenantId);
    if (this.config.isProd || adapter.name !== 'mock') {
      throw Errors.forbidden('Payment simulation is only available in development');
    }

    const payment = await this.tenantDb.run((db) =>
      db.payment.findUnique({
        where: { id: paymentId },
        include: { order: { select: { orderNumber: true } } },
      }),
    );
    if (!payment) throw Errors.notFound('Payment', paymentId);

    if (outcome === 'failure') {
      await this.markFailed(this.tenantDb.tenantId, paymentId, 'Simulated failure');
      return {
        paymentId,
        orderId: payment.orderId,
        orderNumber: payment.order.orderNumber,
        status: 'FAILED',
        verified: true,
      };
    }

    const providerPaymentId = `mock_pay_${randomUUID().replace(/-/g, '').slice(0, 18)}`;
    const providerOrderId = payment.providerOrderId ?? `mock_order_${paymentId.slice(0, 12)}`;
    // Only the mock adapter exposes `sign`; the guard above proves we have it.
    const signature = (adapter as unknown as { sign(payload: string): string }).sign(
      `${providerOrderId}|${providerPaymentId}`,
    );

    return this.verify({ paymentId, providerOrderId, providerPaymentId, signature });
  }
}
