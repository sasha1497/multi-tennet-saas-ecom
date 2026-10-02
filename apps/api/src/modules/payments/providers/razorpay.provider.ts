import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { PaymentCredentials } from '../payment-config.service';
import type { NormalisedPaymentEvent, PaymentMethod } from '@retailos/types';
import { AppConfigService } from '@/config/config.module';
import { Errors } from '@/common/errors/app.exception';
import { AppLogger } from '@/core/logger/logger.service';
import type {
  CreateIntentParams,
  GatewayPayment,
  PaymentProviderAdapter,
  ProviderIntent,
  RefundParams,
  RefundResult,
  VerifySignatureParams,
  WebhookReference,
} from '../payment-provider.interface';

/**
 * Razorpay adapter.
 *
 * Implemented against the REST API with `fetch` rather than the official SDK:
 * we use a handful of endpoints, and avoiding the dependency keeps the
 * container small and the failure modes visible.
 *
 * Every call is made **as the store**, never as retailos:
 *   • Partner OAuth store → `Authorization: Bearer <store access token>`
 *   • manual-key store    → `Authorization: Basic <store key id:secret>`
 * so the order, the payment and the settlement all belong to the store's own
 * Razorpay account.
 *
 * Two signature schemes, and they are NOT the same:
 *   • checkout callback — HMAC-SHA256 of `order_id|payment_id`, keyed by the
 *     store's key secret, or for an OAuth store by the partner app's client
 *     secret (as Razorpay documents for OAuth partners)
 *   • webhook — HMAC-SHA256 of the raw body, keyed by the *webhook* secret
 * Mixing them up is the classic way to ship a payment bypass.
 */
@Injectable()
export class RazorpayProvider implements PaymentProviderAdapter {
  readonly name = 'razorpay';
  readonly supportedMethods: readonly PaymentMethod[] = ['UPI', 'CARD', 'NETBANKING', 'WALLET'];

  private readonly logger: AppLogger;

  constructor(
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('RazorpayProvider');
  }

  private get api(): string {
    return this.config.payments.razorpay.apiBase;
  }

  async createIntent(
    params: CreateIntentParams,
    credentials: PaymentCredentials,
  ): Promise<ProviderIntent> {
    if (!credentials.auth || !credentials.publicKey) {
      throw Errors.paymentFailed('Online payment is temporarily unavailable.');
    }

    const response = await fetch(`${this.api}/orders`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader(credentials) },
      body: JSON.stringify({
        amount: params.amount, // Razorpay also works in paise.
        currency: params.currency,
        // Our payment id — the join key when reconciling a settlement report.
        receipt: params.paymentId,
        notes: {
          orderNumber: params.orderNumber,
          tenant: params.tenantSlug,
          paymentId: params.paymentId,
        },
      }),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error('Razorpay order creation failed', undefined, {
        status: response.status,
        detail: detail.slice(0, 500),
      });
      throw Errors.paymentFailed('Could not start the payment. Please try again.');
    }

    const body = (await response.json()) as { id: string; status: string };

    return {
      providerOrderId: body.id,
      // A key id, or the store's OAuth public_token — both are public by design.
      publicKey: credentials.publicKey,
      metadata: { status: body.status },
    };
  }

  verifySignature(params: VerifySignatureParams, credentials: PaymentCredentials): boolean {
    const secret = credentials.signatureSecret;
    if (!secret) return false;

    // Checkout callback: HMAC over "order_id|payment_id".
    const expected = createHmac('sha256', secret)
      .update(`${params.providerOrderId}|${params.providerPaymentId}`)
      .digest('hex');

    return safeCompare(expected, params.signature);
  }

  async fetchPayment(providerPaymentId: string, credentials: PaymentCredentials): Promise<GatewayPayment> {
    if (!credentials.auth) throw Errors.paymentFailed('Online payment is temporarily unavailable.');
    const response = await fetch(`${this.api}/payments/${encodeURIComponent(providerPaymentId)}`, {
      headers: { Authorization: authHeader(credentials) },
    });
    if (!response.ok) {
      this.logger.warn('Razorpay payment fetch failed', { status: response.status });
      throw Errors.paymentSignatureInvalid();
    }
    const body = (await response.json()) as {
      id: string;
      status: string;
      order_id?: string | null;
      amount: number;
      currency: string;
    };
    return {
      id: body.id,
      status: body.status,
      orderId: body.order_id ?? null,
      amount: body.amount,
      currency: body.currency,
    };
  }

  /**
   * Reads the identifiers out of a webhook WITHOUT verifying anything.
   *
   * Used only to find which tenant this webhook belongs to, so the right
   * webhook secret can then be used to verify it. Treat the result as hostile.
   * Refund events carry the payment id, not the order id, so both are read.
   */
  extractReference(rawBody: Buffer): WebhookReference | null {
    try {
      const payload = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhookPayload;
      const payment = payload.payload?.payment?.entity;
      const refund = payload.payload?.refund?.entity;
      return {
        event: payload.event ?? null,
        providerOrderId: payment?.order_id ?? null,
        providerPaymentId: payment?.id ?? refund?.payment_id ?? null,
        accountId: payload.account_id ?? null,
      };
    } catch {
      return null;
    }
  }

  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
    credentials: PaymentCredentials,
  ): NormalisedPaymentEvent | null {
    const secret = credentials.webhookSecret;
    const signature = headers['x-razorpay-signature'];
    if (!secret || !signature) return null;

    // Webhook: HMAC over the exact raw body with the webhook secret.
    const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
    if (!safeCompare(expected, signature)) {
      this.logger.warn('Rejected Razorpay webhook with an invalid signature');
      return null;
    }

    let payload: RazorpayWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhookPayload;
    } catch {
      return null;
    }

    const payment = payload.payload?.payment?.entity;
    const refund = payload.payload?.refund?.entity;
    const isRefund = payload.event?.startsWith('refund.') ?? false;
    const entity = isRefund ? refund : payment;

    return {
      eventId:
        headers['x-razorpay-event-id'] ?? `${payload.event}:${entity?.id ?? payload.account_id ?? 'unknown'}`,
      type: mapEventType(payload.event),
      providerOrderId: payment?.order_id ?? null,
      providerPaymentId: isRefund ? (refund?.payment_id ?? payment?.id ?? null) : (payment?.id ?? null),
      providerRefundId: isRefund ? (refund?.id ?? null) : null,
      accountId: payload.account_id ?? null,
      amount: typeof entity?.amount === 'number' ? entity.amount : null,
      currency: entity?.currency ?? null,
      failureReason: entity?.error_description ?? null,
      raw: payload,
    };
  }

  async refund(params: RefundParams, credentials: PaymentCredentials): Promise<RefundResult> {
    if (!credentials.auth) throw Errors.paymentFailed('Refunds are not available for this store right now');

    const response = await fetch(
      `${this.api}/payments/${encodeURIComponent(params.providerPaymentId)}/refund`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authHeader(credentials),
          // Razorpay honours this header, so a retried refund does not pay twice.
          'X-Payment-Idempotency-Key': params.idempotencyKey,
        },
        body: JSON.stringify({
          amount: params.amount,
          notes: { reason: params.reason.slice(0, 200) },
        }),
      },
    );

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      this.logger.error('Razorpay refund failed', undefined, {
        status: response.status,
        detail: detail.slice(0, 500),
      });
      throw Errors.paymentFailed('The refund could not be processed');
    }

    const body = (await response.json()) as { id: string; amount: number; status: string };
    return {
      providerRefundId: body.id,
      amount: body.amount,
      status: body.status === 'processed' ? 'processed' : body.status === 'failed' ? 'failed' : 'pending',
    };
  }
}

interface RazorpayWebhookPayload {
  event: string;
  /** Present on events for an OAuth-connected (partner) account. */
  account_id?: string;
  payload?: {
    payment?: { entity?: RazorpayEntity };
    refund?: { entity?: RazorpayEntity };
  };
}

interface RazorpayEntity {
  id?: string;
  order_id?: string;
  payment_id?: string;
  amount?: number;
  currency?: string;
  error_description?: string;
}

function authHeader(credentials: PaymentCredentials): string {
  const auth = credentials.auth!;
  return auth.scheme === 'bearer'
    ? `Bearer ${auth.accessToken}`
    : `Basic ${Buffer.from(`${auth.keyId}:${auth.keySecret}`).toString('base64')}`;
}

function mapEventType(event: string): NormalisedPaymentEvent['type'] {
  switch (event) {
    case 'payment.captured':
    case 'order.paid':
      return 'payment.captured';
    case 'payment.failed':
      return 'payment.failed';
    case 'refund.processed':
      return 'refund.processed';
    case 'refund.failed':
      return 'refund.failed';
    case 'account.app.authorization_revoked':
      return 'account.revoked';
    default:
      return 'unknown';
  }
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
