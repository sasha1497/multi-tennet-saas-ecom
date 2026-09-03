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
import { PAYMENT_PROVIDER, type PaymentProviderAdapter } from './payment-provider.interface';

@Injectable()
export class PaymentsService {
  private readonly logger: AppLogger;

  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProviderAdapter,
    private readonly tenantDb: TenantDatabaseService,
    private readonly master: MasterPrismaService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
    @Inject(forwardRef(() => OrdersService)) private readonly orders: OrdersService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('PaymentsService');
  }

  get providerName(): string {
    return this.provider.name;
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
      orderId: string;
      orderNumber: string;
      amount: Money;
      currency: string;
      method: PaymentMethod;
    },
  ): Promise<{ paymentId: string }> {
    const payment = await tx.payment.create({
      data: {
        orderId: params.orderId,
        provider: params.method === 'COD' ? 'cod' : this.provider.name,
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

    const intent = await this.provider.createIntent({
      paymentId: params.paymentId,
      orderId: params.orderId,
      orderNumber: params.orderNumber,
      amount: params.amount,
      currency: params.currency,
      method: params.method,
      customer: params.customer,
      tenantSlug: params.tenantSlug,
    });

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
            provider: this.provider.name,
            providerOrderId: intent.providerOrderId,
          },
        },
        create: {
          provider: this.provider.name,
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
      provider: this.provider.name,
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

    const valid = this.provider.verifySignature({
      providerOrderId: params.providerOrderId,
      providerPaymentId: params.providerPaymentId,
      signature: params.signature,
    });

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
   * Four defences, all necessary:
   *   1. signature verification over the raw body (in the adapter)
   *   2. event de-duplication in the master `webhook_events` table
   *   3. tenant resolution via `payment_routes`, never from the payload
   *   4. an idempotent state transition, so a replay is a no-op
   */
  async handleWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): Promise<{ handled: boolean; reason?: string }> {
    const event = this.provider.parseWebhook(rawBody, headers);
    if (!event) {
      // Never leak *why* it failed to an unauthenticated caller.
      this.logger.warn('Discarded unverifiable webhook', { provider: this.provider.name });
      return { handled: false, reason: 'invalid_signature' };
    }

    const payloadHash = createHash('sha256').update(rawBody).digest('hex');

    // De-duplicate: the unique index turns a redelivery into a cheap no-op.
    try {
      await this.master.webhookEvent.create({
        data: {
          provider: this.provider.name,
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
      const result = await this.routeAndApply(event);
      await this.master.webhookEvent.updateMany({
        where: { provider: this.provider.name, eventId: event.eventId.slice(0, 191) },
        data: { status: 'PROCESSED', processedAt: new Date() },
      });
      return result;
    } catch (err) {
      await this.master.webhookEvent.updateMany({
        where: { provider: this.provider.name, eventId: event.eventId.slice(0, 191) },
        data: { status: 'FAILED', error: (err as Error).message.slice(0, 1000) },
      });
      this.logger.error('Webhook processing failed', err as Error, { eventId: event.eventId });
      throw err;
    }
  }

  private async routeAndApply(
    event: NormalisedPaymentEvent,
  ): Promise<{ handled: boolean; reason?: string }> {
    if (!event.providerOrderId) return { handled: false, reason: 'no_order_reference' };

    const route = await this.master.paymentRoute.findUnique({
      where: {
        provider_providerOrderId: {
          provider: this.provider.name,
          providerOrderId: event.providerOrderId,
        },
      },
    });

    if (!route) {
      this.logger.warn('Webhook for an unknown provider order', {
        providerOrderId: event.providerOrderId,
      });
      return { handled: false, reason: 'unknown_order' };
    }

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
      await this.provider.refund({
        providerPaymentId: payment.providerPaymentId,
        amount: requested,
        reason,
        idempotencyKey: `refund:${payment.id}:${requested}`,
      });
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
    if (this.config.isProd || this.provider.name !== 'mock') {
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
    const signature = (this.provider as unknown as { sign(payload: string): string }).sign(
      `${providerOrderId}|${providerPaymentId}`,
    );

    return this.verify({ paymentId, providerOrderId, providerPaymentId, signature });
  }
}
