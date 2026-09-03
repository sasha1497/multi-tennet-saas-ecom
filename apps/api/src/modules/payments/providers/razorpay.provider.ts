import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { NormalisedPaymentEvent, PaymentMethod } from '@retailos/types';
import { AppConfigService } from '@/config/config.module';
import { Errors } from '@/common/errors/app.exception';
import { AppLogger } from '@/core/logger/logger.service';
import type {
  CreateIntentParams,
  PaymentProviderAdapter,
  ProviderIntent,
  RefundParams,
  RefundResult,
  VerifySignatureParams,
} from '../payment-provider.interface';

const RAZORPAY_API = 'https://api.razorpay.com/v1';

/**
 * Razorpay adapter.
 *
 * Implemented against the REST API with `fetch` rather than the official SDK:
 * we use four endpoints, and avoiding the dependency keeps the container small
 * and the failure modes visible.
 *
 * Two signature schemes, and they are NOT the same:
 *   • checkout callback — HMAC-SHA256 of `order_id|payment_id` keyed by the API secret
 *   • webhook           — HMAC-SHA256 of the raw body keyed by the *webhook* secret
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

  async createIntent(params: CreateIntentParams): Promise<ProviderIntent> {
    const { keyId, keySecret } = this.config.payments.razorpay;
    if (!keyId || !keySecret) {
      throw Errors.paymentFailed('Online payments are not configured for this platform');
    }

    const response = await fetch(`${RAZORPAY_API}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
      },
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
      publicKey: keyId,
      metadata: { status: body.status },
    };
  }

  verifySignature(params: VerifySignatureParams): boolean {
    const secret = this.config.payments.razorpay.keySecret;
    if (!secret) return false;

    // Checkout callback: HMAC over "order_id|payment_id".
    const expected = createHmac('sha256', secret)
      .update(`${params.providerOrderId}|${params.providerPaymentId}`)
      .digest('hex');

    return safeCompare(expected, params.signature);
  }

  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): NormalisedPaymentEvent | null {
    const secret = this.config.payments.razorpay.webhookSecret;
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

    const entity = payload.payload?.payment?.entity ?? payload.payload?.refund?.entity;

    return {
      eventId: headers['x-razorpay-event-id'] ?? `${payload.event}:${entity?.id ?? 'unknown'}`,
      type: mapEventType(payload.event),
      providerOrderId: entity?.order_id ?? null,
      providerPaymentId: entity?.payment_id ?? entity?.id ?? null,
      amount: typeof entity?.amount === 'number' ? entity.amount : null,
      currency: entity?.currency ?? null,
      failureReason: entity?.error_description ?? null,
      raw: payload,
    };
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    const { keyId, keySecret } = this.config.payments.razorpay;
    if (!keyId || !keySecret) throw Errors.paymentFailed('Refunds are not configured');

    const response = await fetch(
      `${RAZORPAY_API}/payments/${encodeURIComponent(params.providerPaymentId)}/refund`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`,
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
      status: body.status === 'processed' ? 'processed' : 'pending',
    };
  }
}

interface RazorpayWebhookPayload {
  event: string;
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

function mapEventType(event: string): NormalisedPaymentEvent['type'] {
  switch (event) {
    case 'payment.captured':
    case 'order.paid':
      return 'payment.captured';
    case 'payment.failed':
      return 'payment.failed';
    case 'refund.processed':
      return 'refund.processed';
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
