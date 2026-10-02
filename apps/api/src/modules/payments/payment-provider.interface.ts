import type { Money, NormalisedPaymentEvent, PaymentMethod } from '@retailos/types';
import type { PaymentCredentials } from './payment-config.service';

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

/** Untrusted identifiers read from a webhook body, used only to pick a verification key. */
export interface WebhookReference {
  event: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  accountId: string | null;
}

export interface GatewayPayment {
  id: string;
  /** e.g. created | authorized | captured | refunded | failed. */
  status: string;
  orderId: string | null;
  amount: number;
  currency: string;
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

  /** Creates the gateway-side order/intent, using THIS tenant's credentials. */
  createIntent(params: CreateIntentParams, credentials: PaymentCredentials): Promise<ProviderIntent>;

  /**
   * Verifies the client-side callback signature.
   *
   * MUST be constant-time and MUST fail closed on any malformed input — this is
   * the check that stops a shopper from marking their own order as paid.
   */
  verifySignature(params: VerifySignatureParams, credentials: PaymentCredentials): boolean;

  /**
   * Reads the gateway's order reference out of a webhook body WITHOUT trusting
   * it.
   *
   * This exists because of a chicken-and-egg problem created by per-tenant
   * credentials: the signature can only be checked with the right tenant's
   * webhook secret, but the tenant is only known once the payload has been
   * read. So parsing and verification are separate steps.
   *
   * The value returned here is untrusted input. Its ONLY legitimate use is to
   * look up a payment route and thereby learn which tenant's secret to verify
   * with — never to authorise anything on its own.
   */
  extractReference(rawBody: Buffer): WebhookReference | null;

  /**
   * Reads a payment back from the gateway, server to server.
   *
   * Used after a Checkout callback as a second, independent check: the payment
   * must exist on THIS store's account, belong to the order we created, and be
   * for the amount we charged. Optional — the mock gateway has no server.
   */
  fetchPayment?(providerPaymentId: string, credentials: PaymentCredentials): Promise<GatewayPayment>;

  /**
   * Verifies and normalises a webhook against one tenant's webhook secret.
   *
   * Receives the **raw** body, because signatures are computed over the exact
   * bytes the gateway sent; re-serialising parsed JSON changes them.
   * Returns null when the signature does not verify.
   */
  verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string | undefined>,
    credentials: PaymentCredentials,
  ): NormalisedPaymentEvent | null;

  refund(params: RefundParams, credentials: PaymentCredentials): Promise<RefundResult>;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
