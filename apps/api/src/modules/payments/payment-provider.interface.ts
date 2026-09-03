import type { Money, NormalisedPaymentEvent, PaymentMethod } from '@retailos/types';

export interface CreateIntentParams {
  /** Our own payment row id — becomes the provider's receipt reference. */
  paymentId: string;
  orderId: string;
  orderNumber: string;
  amount: Money;
  currency: string;
  method: PaymentMethod;
  customer: { name: string; email: string | null; phone: string | null };
  /** Tenant slug, carried into provider metadata for reconciliation. */
  tenantSlug: string;
}

export interface ProviderIntent {
  providerOrderId: string | null;
  /** Public key/config the client SDK needs. Never a secret. */
  publicKey: string | null;
  /** Local-dev only: a page that simulates the gateway. */
  checkoutUrl?: string | null;
  metadata?: Record<string, unknown>;
}

export interface VerifySignatureParams {
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface RefundParams {
  providerPaymentId: string;
  amount: Money;
  reason: string;
  /** Prevents a retried refund from paying out twice. */
  idempotencyKey: string;
}

export interface RefundResult {
  providerRefundId: string;
  amount: Money;
  status: 'processed' | 'pending' | 'failed';
}

/**
 * What every payment gateway must implement.
 *
 * Requirement §27 asks for a provider abstraction so a second gateway can be
 * added later. The important part is what is *not* in this interface: no
 * business rules, no order mutation, no inventory. An adapter translates between
 * our vocabulary and the gateway's, and nothing else — which is why adding
 * PhonePe or Cashfree later is a new file rather than a refactor.
 *
 * Signature verification lives behind `verifySignature` / `parseWebhook` so the
 * cryptography stays next to the provider that defined it.
 */
export interface PaymentProviderAdapter {
  readonly name: string;

  /** Payment methods this adapter can handle. */
  readonly supportedMethods: readonly PaymentMethod[];

  /** Creates the gateway-side order/intent. */
  createIntent(params: CreateIntentParams): Promise<ProviderIntent>;

  /**
   * Verifies the client-side callback signature.
   *
   * MUST be constant-time and MUST fail closed on any malformed input — this is
   * the check that stops a shopper from marking their own order as paid.
   */
  verifySignature(params: VerifySignatureParams): boolean;

  /**
   * Verifies and normalises a webhook.
   *
   * Receives the **raw** body, because signatures are computed over the exact
   * bytes the gateway sent; re-serialising parsed JSON changes them.
   * Returns null when the signature does not verify.
   */
  parseWebhook(rawBody: Buffer, headers: Record<string, string | undefined>): NormalisedPaymentEvent | null;

  refund(params: RefundParams): Promise<RefundResult>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
