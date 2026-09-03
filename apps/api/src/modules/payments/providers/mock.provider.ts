import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { NormalisedPaymentEvent, PaymentMethod } from '@retailos/types';
import { AppConfigService } from '@/config/config.module';
import { AppLogger } from '@/core/logger/logger.service';
import type {
  CreateIntentParams,
  PaymentProviderAdapter,
  ProviderIntent,
  RefundParams,
  RefundResult,
  VerifySignatureParams,
} from '../payment-provider.interface';

/**
 * Local-development payment gateway.
 *
 * Exists so the entire checkout → payment → order-confirmed → notification flow
 * is genuinely exercisable without Razorpay credentials — `docker compose up`
 * gives you a working end-to-end purchase, which is what makes the integration
 * tests and the demo real rather than mocked at the HTTP boundary.
 *
 * It implements the *same* HMAC signature scheme as the real adapter, so the
 * verification path under test is the production path, not a stub that always
 * returns true. `POST /payments/mock/:paymentId/success|failure` stands in for
 * the hosted checkout page.
 *
 * Refuses to run in production — see `PaymentsModule`.
 */
@Injectable()
export class MockPaymentProvider implements PaymentProviderAdapter {
  readonly name = 'mock';
  readonly supportedMethods: readonly PaymentMethod[] = ['UPI', 'CARD', 'NETBANKING', 'WALLET'];

  private readonly logger: AppLogger;

  constructor(
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('MockPaymentProvider');
  }

  async createIntent(params: CreateIntentParams): Promise<ProviderIntent> {
    const providerOrderId = `mock_order_${randomUUID().replace(/-/g, '').slice(0, 20)}`;

    this.logger.info('Created mock payment intent', {
      providerOrderId,
      amount: params.amount,
      orderNumber: params.orderNumber,
    });

    return {
      providerOrderId,
      publicKey: 'mock_key_local_development',
      // The storefront renders its own simulated gateway screen at this route.
      checkoutUrl: `/checkout/mock-gateway?paymentId=${params.paymentId}&orderId=${providerOrderId}`,
      metadata: { simulated: true },
    };
  }

  verifySignature(params: VerifySignatureParams): boolean {
    const expected = this.sign(`${params.providerOrderId}|${params.providerPaymentId}`);
    return safeCompare(expected, params.signature);
  }

  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
  ): NormalisedPaymentEvent | null {
    const signature = headers['x-mock-signature'];
    if (!signature) return null;

    const expected = createHmac('sha256', this.config.payments.mock.webhookSecret)
      .update(rawBody)
      .digest('hex');
    if (!safeCompare(expected, signature)) {
      this.logger.warn('Rejected mock webhook with an invalid signature');
      return null;
    }

    try {
      const payload = JSON.parse(rawBody.toString('utf8')) as {
        event: string;
        eventId?: string;
        providerOrderId?: string;
        providerPaymentId?: string;
        amount?: number;
        currency?: string;
        failureReason?: string;
      };

      return {
        eventId: payload.eventId ?? `mock:${payload.providerPaymentId ?? randomUUID()}`,
        type:
          payload.event === 'payment.captured'
            ? 'payment.captured'
            : payload.event === 'payment.failed'
              ? 'payment.failed'
              : payload.event === 'refund.processed'
                ? 'refund.processed'
                : 'unknown',
        providerOrderId: payload.providerOrderId ?? null,
        providerPaymentId: payload.providerPaymentId ?? null,
        amount: payload.amount ?? null,
        currency: payload.currency ?? null,
        failureReason: payload.failureReason ?? null,
        raw: payload,
      };
    } catch {
      return null;
    }
  }

  async refund(params: RefundParams): Promise<RefundResult> {
    this.logger.info('Simulated refund', {
      providerPaymentId: params.providerPaymentId,
      amount: params.amount,
    });
    return {
      providerRefundId: `mock_rfnd_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
      amount: params.amount,
      status: 'processed',
    };
  }

  /**
   * Produces the signature a real gateway would return to the client.
   * Used by the simulate endpoint so the verify path can be exercised for real.
   */
  sign(payload: string): string {
    return createHmac('sha256', this.config.payments.mock.webhookSecret)
      .update(payload)
      .digest('hex');
  }
}

function safeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
