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
import { RequestContextService } from '@/core/context/request-context';
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
    private readonly context: RequestContextService,
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

    // Second, independent check: read the payment back from the gateway as
    // this store. The signature proves the callback came from Checkout; this
    // proves the payment exists on THIS store's account, belongs to the order
    // we created, is for the amount we charged, and was actually captured.
    if (adapter.fetchPayment) {
      const remote = await adapter.fetchPayment(params.providerPaymentId, credentials);
      const matches =
        remote.orderId === params.providerOrderId &&
        remote.amount === payment.amount &&
        remote.currency.toUpperCase() === payment.currency.toUpperCase();
      if (!matches) {
        this.logger.warn('Gateway payment does not match the order it claims to pay', {
          paymentId: payment.id,
        });
        throw Errors.paymentSignatureInvalid();
      }
      if (remote.status === 'failed') {
        await this.markFailed(tenantId, payment.id, 'Payment failed at the gateway');
        return {
          paymentId: payment.id,
          orderId: payment.orderId,
          orderNumber: payment.order.orderNumber,
          status: 'FAILED',
          verified: true,
        };
      }
      if (remote.status !== 'captured') {
        // Authorised but not yet captured: genuine, but no money has moved.
        // The `payment.captured` webhook completes it — the order is not
        // confirmed on a promise.
        await this.tenantDb.run((db) =>
          db.payment.updateMany({
            where: { id: payment.id, status: 'PENDING' },
            data: { status: 'AUTHORIZED', providerPaymentId: params.providerPaymentId },
          }),
        );
        return {
          paymentId: payment.id,
          orderId: payment.orderId,
          orderNumber: payment.order.orderNumber,
          status: 'AUTHORIZED',
          verified: true,
        };
      }
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
    const reference = adapter.extractReference(rawBody);
    if (!reference) {
      this.logger.warn('Discarded webhook with no usable reference', { provider: adapter.name });
      return { handled: false, reason: 'no_reference' };
    }

    // The merchant removed retailos from their Razorpay dashboard. There is no
    // order to route by: it is an account event, signed with the OAuth app's
    // own webhook secret, and it only ever turns a store's online payments OFF.
    if (reference.event === 'account.app.authorization_revoked') {
      const appCreds = this.paymentConfig.oauthAppWebhookCredentials();
      const event = adapter.verifyWebhook(rawBody, headers, appCreds);
      if (!event || !event.accountId) return { handled: false, reason: 'invalid_signature' };
      if (!(await this.recordWebhookEvent(adapter.name, event, rawBody))) {
        return { handled: true, reason: 'duplicate' };
      }
      await this.paymentConfig.markRevokedByAccount(event.accountId);
      await this.markWebhookProcessed(adapter.name, event.eventId);
      return { handled: true };
    }

    // Payment events carry the gateway order id; refund events only the
    // payment id. Either way the tenant comes from OUR routing table.
    const route = reference.providerOrderId
      ? await this.master.paymentRoute.findUnique({
          where: {
            provider_providerOrderId: {
              provider: adapter.name,
              providerOrderId: reference.providerOrderId,
            },
          },
        })
      : reference.providerPaymentId
        ? await this.master.paymentRoute.findFirst({
            where: { provider: adapter.name, providerPaymentId: reference.providerPaymentId },
          })
        : null;

    if (!route) {
      // Either a webhook for an order we never created, or a probe. Either way
      // there is no tenant, so there is no secret to verify against.
      this.logger.warn('Webhook for an unknown provider order', { provider: adapter.name });
      return { handled: false, reason: 'unknown_order' };
    }

    // Step 2 — NOW verify, with the webhook key of the tenant that owns it.
    const credentials = await this.paymentConfig.webhookCredentials(route.tenantId);
    const event = adapter.verifyWebhook(rawBody, headers, credentials);
    if (!event) {
      // Never leak *why* it failed to an unauthenticated caller.
      this.logger.warn('Discarded unverifiable webhook', {
        provider: adapter.name,
        tenantId: route.tenantId,
      });
      return { handled: false, reason: 'invalid_signature' };
    }

    // An OAuth webhook is signed with one app-wide secret, so the signature
    // alone does not say which store sent it. The account it names must be the
    // account this order was created on.
    if (credentials.connectionType === 'oauth' && event.accountId !== credentials.accountId) {
      this.logger.warn('Webhook account does not own this order', {
        provider: adapter.name,
        tenantId: route.tenantId,
      });
      return { handled: false, reason: 'account_mismatch' };
    }

    // De-duplicate: the unique index turns a redelivery into a cheap no-op.
    if (!(await this.recordWebhookEvent(adapter.name, event, rawBody))) {
      return { handled: true, reason: 'duplicate' };
    }

    try {
      const result = await this.routeAndApply(event, route);
      await this.markWebhookProcessed(adapter.name, event.eventId);
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

  /** False when this event id was already received — the caller stops there. */
  private async recordWebhookEvent(
    provider: string,
    event: NormalisedPaymentEvent,
    rawBody: Buffer,
  ): Promise<boolean> {
    try {
      await this.master.webhookEvent.create({
        data: {
          provider,
          eventId: event.eventId.slice(0, 191),
          eventType: event.type,
          payloadHash: createHash('sha256').update(rawBody).digest('hex'),
          status: 'RECEIVED',
        },
      });
      return true;
    } catch {
      this.logger.debug('Ignored duplicate webhook', { eventId: event.eventId });
      return false;
    }
  }

  private async markWebhookProcessed(provider: string, eventId: string): Promise<void> {
    await this.master.webhookEvent.updateMany({
      where: { provider, eventId: eventId.slice(0, 191) },
      data: { status: 'PROCESSED', processedAt: new Date() },
    });
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
      case 'refund.failed':
        await this.settleRefund(route.tenantId, route.paymentId, event);
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

    // Lets refund webhooks — which name the payment, not the order — find
    // their way back to this tenant.
    if (params.providerPaymentId) {
      await this.master.paymentRoute.updateMany({
        where: { tenantId, paymentId: params.paymentId },
        data: { providerPaymentId: params.providerPaymentId },
      });
    }

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

  /**
   * Merchant-initiated refund, through the gateway the order was paid on.
   *
   * The refund row is written PENDING *before* the gateway is called, with an
   * idempotency key Razorpay honours — so a timeout, a crash or a double click
   * can never refund twice or leave money moving with no record of it. The
   * gateway's `refund.processed` / `refund.failed` webhook settles the row.
   *
   * Money goes back from the store's own Razorpay account, because that is the
   * account that was paid. A full refund also moves the order to REFUNDED
   * (and restocks) where the order's lifecycle allows it.
   */
  async refund(
    orderId: string,
    amount: Money | undefined,
    reason: string,
  ): Promise<{ refundId: string; status: string; amount: Money; orderStatus: string }> {
    const tenantId = this.tenantDb.tenantId;

    const payment = await this.tenantDb.run((db) =>
      db.payment.findFirst({
        where: { orderId, status: { in: ['PAID', 'PARTIALLY_REFUNDED'] } },
        orderBy: { createdAt: 'desc' },
        include: { refunds: { where: { status: { in: ['PENDING', 'PROCESSED'] } } } },
      }),
    );
    if (!payment) throw Errors.badRequest('There is no captured payment to refund for this order');

    // Pending refunds count against what is left, so two clicks cannot both
    // refund the full amount while the first is still in flight.
    const committed = payment.refunds.reduce((sum, r) => sum + r.amount, 0);
    const refundable = payment.amount - Math.max(committed, payment.refundedAmount);
    const requested = amount ?? refundable;
    if (requested <= 0 || requested > refundable) {
      throw Errors.badRequest(`The refundable amount for this order is ₹${(refundable / 100).toFixed(2)}`);
    }

    const sequence = payment.refunds.length + 1;
    const refund = await this.tenantDb.run((db) =>
      db.paymentRefund.create({
        data: {
          paymentId: payment.id,
          amount: requested,
          reason: reason.slice(0, 300),
          idempotencyKey: `refund:${payment.id}:${sequence}:${requested}`,
          createdBy: this.context.userId,
        },
      }),
    );

    let status: 'PENDING' | 'PROCESSED' | 'FAILED' = 'PENDING';
    // COD never charged the customer, so there is nothing to send back through
    // a gateway — it is recorded and settled in person.
    if (payment.method === 'COD' || !payment.providerPaymentId) {
      status = 'PROCESSED';
    } else {
      const { adapter, credentials } = await this.gatewayFor(tenantId);
      try {
        const result = await adapter.refund(
          {
            providerPaymentId: payment.providerPaymentId,
            amount: requested,
            reason,
            idempotencyKey: refund.idempotencyKey,
          },
          credentials,
        );
        status = result.status === 'processed' ? 'PROCESSED' : result.status === 'failed' ? 'FAILED' : 'PENDING';
        await this.tenantDb.run((db) =>
          db.paymentRefund.update({
            where: { id: refund.id },
            data: { providerRefundId: result.providerRefundId },
          }),
        );
      } catch (err) {
        await this.tenantDb.run((db) =>
          db.paymentRefund.update({
            where: { id: refund.id },
            data: { status: 'FAILED', failureReason: (err as Error).message.slice(0, 500) },
          }),
        );
        throw err;
      }
    }

    if (status !== 'FAILED') await this.applyRefund(tenantId, refund.id, status);

    // A full refund closes the order where its lifecycle allows it.
    let orderStatus = (await this.tenantDb.run((db) =>
      db.order.findUnique({ where: { id: orderId }, select: { status: true } }),
    ))?.status ?? 'UNKNOWN';
    const fullyRefunded = requested === refundable && committed === 0 && payment.refundedAmount === 0;
    if (fullyRefunded && (orderStatus === 'DELIVERED' || orderStatus === 'CANCELLED')) {
      const updated = await this.orders.updateStatus(orderId, 'REFUNDED', { reason });
      orderStatus = updated.status;
    }

    this.audit.record('tenant', {
      action: AuditAction.PAYMENT_EVENT,
      resourceType: 'payment',
      resourceId: payment.id,
      metadata: { refundId: refund.id, status, amount: requested, reason },
    });
    this.logger.info('Refund issued', { tenantId, paymentId: payment.id, amount: requested, status });

    return { refundId: refund.id, status, amount: requested, orderStatus };
  }

  /**
   * Moves a refund to its final state and reflects it on the payment, once.
   *
   * The conditional update is the idempotency: a webhook redelivered, or one
   * racing the synchronous response, finds the refund already settled and
   * changes nothing.
   */
  private async applyRefund(
    tenantId: string,
    refundId: string,
    status: 'PENDING' | 'PROCESSED',
  ): Promise<void> {
    await this.tenantDb.transactionFor(tenantId, async (tx) => {
      const refund = await tx.paymentRefund.findUnique({ where: { id: refundId } });
      if (!refund) return;
      if (status === 'PROCESSED') {
        const moved = await tx.paymentRefund.updateMany({
          where: { id: refundId, status: 'PENDING' },
          data: { status: 'PROCESSED', processedAt: new Date() },
        });
        if (moved.count === 0 && refund.status !== 'PENDING') return;
      }
      // The payment's refunded total counts refunds once they are accepted by
      // the gateway (pending or processed); a refund that later fails is
      // subtracted again in `settleRefund`.
      const accepted = await tx.paymentRefund.aggregate({
        where: { paymentId: refund.paymentId, status: { in: ['PENDING', 'PROCESSED'] } },
        _sum: { amount: true },
      });
      const payment = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
      const total = Math.min(accepted._sum.amount ?? 0, payment.amount);
      await tx.payment.update({
        where: { id: payment.id },
        data: {
          refundedAmount: total,
          status: total <= 0 ? 'PAID' : total >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
        },
      });
      await tx.order.updateMany({
        where: { id: payment.orderId },
        data: { paymentStatus: total >= payment.amount ? 'REFUNDED' : total > 0 ? 'PARTIALLY_REFUNDED' : 'PAID' },
      });
    });
  }

  /** `refund.processed` / `refund.failed` from the gateway, matched by its refund id. */
  private async settleRefund(
    tenantId: string,
    paymentId: string,
    event: NormalisedPaymentEvent,
  ): Promise<void> {
    if (!event.providerRefundId) return;
    const refund = await this.tenantDb.runFor(tenantId, (db) =>
      db.paymentRefund.findFirst({
        // Pinned to the payment the route names: a refund id from one payment
        // cannot settle a refund on another.
        where: { providerRefundId: event.providerRefundId!, paymentId },
      }),
    );
    if (!refund) {
      // Issued from the merchant's Razorpay dashboard rather than retailos.
      // Recorded so the books agree with the gateway.
      if (event.type !== 'refund.processed' || !event.amount) return;
      const created = await this.tenantDb.runFor(tenantId, (db) =>
        db.paymentRefund.create({
          data: {
            paymentId,
            amount: event.amount!,
            reason: 'Issued from the Razorpay dashboard',
            providerRefundId: event.providerRefundId!,
            idempotencyKey: `gateway:${event.providerRefundId}`,
          },
        }),
      );
      await this.applyRefund(tenantId, created.id, 'PROCESSED');
      return;
    }

    if (event.type === 'refund.processed') {
      await this.applyRefund(tenantId, refund.id, 'PROCESSED');
      return;
    }

    const failed = await this.tenantDb.runFor(tenantId, (db) =>
      db.paymentRefund.updateMany({
        where: { id: refund.id, status: { in: ['PENDING', 'PROCESSED'] } },
        data: { status: 'FAILED', failureReason: (event.failureReason ?? 'Refund failed at the gateway').slice(0, 500) },
      }),
    );
    if (failed.count > 0) {
      // Recompute the payment's refunded total without the failed refund.
      await this.tenantDb.transactionFor(tenantId, async (tx) => {
        const accepted = await tx.paymentRefund.aggregate({
          where: { paymentId, status: { in: ['PENDING', 'PROCESSED'] } },
          _sum: { amount: true },
        });
        const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
        const total = accepted._sum.amount ?? 0;
        await tx.payment.update({
          where: { id: paymentId },
          data: {
            refundedAmount: total,
            status: total <= 0 ? 'PAID' : total >= payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED',
          },
        });
      });
      this.logger.warn('Refund failed at the gateway', { tenantId, paymentId, refundId: refund.id });
    }
  }

  /** Recent payments for the merchant's Payments page — this store only. */
  async recentPayments(limit = 20) {
    const rows = await this.tenantDb.run((db) =>
      db.payment.findMany({
        where: { method: { not: 'COD' } },
        orderBy: { createdAt: 'desc' },
        take: Math.min(Math.max(limit, 1), 100),
        include: {
          order: { select: { orderNumber: true, customerName: true } },
          refunds: { orderBy: { createdAt: 'desc' } },
        },
      }),
    );
    return rows.map((p) => ({
      id: p.id,
      orderId: p.orderId,
      orderNumber: p.order.orderNumber,
      customerName: p.order.customerName,
      provider: p.provider,
      method: p.method,
      status: p.status,
      amount: p.amount,
      refundedAmount: p.refundedAmount,
      currency: p.currency,
      providerPaymentId: p.providerPaymentId,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      refunds: p.refunds.map((r) => ({
        id: r.id,
        status: r.status,
        amount: r.amount,
        providerRefundId: r.providerRefundId,
        createdAt: r.createdAt.toISOString(),
      })),
    }));
  }

  /**
   * Refuses an online order before anything is reserved when the store cannot
   * take the payment — with the message a shopper should see, never the
   * gateway's or the merchant's internal reason.
   */
  async assertOnlineReady(tenantId: string): Promise<void> {
    if (!(await this.paymentConfig.onlineReady(tenantId))) {
      throw Errors.badRequest(
        'Online payment is temporarily unavailable. Please choose another payment method.',
      );
    }
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
