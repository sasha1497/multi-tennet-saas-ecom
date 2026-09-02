import { Money } from './common';
import { PaymentMethod, PaymentStatus } from './enums';

/** Provider-agnostic order-intent returned by `PaymentProviderAdapter.createIntent`. */
export interface PaymentIntent {
  paymentId: string;
  provider: string;
  providerOrderId: string | null;
  amount: Money;
  currency: string;
  status: PaymentStatus;
  publicKey: string | null;
  /** Local-dev mock checkout page. */
  checkoutUrl?: string | null;
  metadata?: Record<string, unknown>;
}

/** Payload the client posts back after the gateway SDK closes. */
export interface VerifyPaymentRequest {
  paymentId: string;
  providerOrderId: string;
  providerPaymentId: string;
  signature: string;
}

export interface VerifyPaymentResponse {
  paymentId: string;
  orderId: string;
  orderNumber: string;
  status: PaymentStatus;
  verified: boolean;
}

export interface Payment {
  id: string;
  orderId: string;
  provider: string;
  method: PaymentMethod;
  status: PaymentStatus;
  amount: Money;
  currency: string;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  providerSignature: string | null;
  failureReason: string | null;
  refundedAmount: Money;
  /** Guards against duplicate webhook + verify processing. */
  idempotencyKey: string;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RefundRequest {
  amount?: Money;
  reason: string;
}

/** Normalised webhook event, after signature verification. */
export interface NormalisedPaymentEvent {
  eventId: string;
  type: 'payment.captured' | 'payment.failed' | 'refund.processed' | 'unknown';
  providerOrderId: string | null;
  providerPaymentId: string | null;
  amount: Money | null;
  currency: string | null;
  failureReason?: string | null;
  raw: unknown;
}
