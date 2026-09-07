import { z } from 'zod';
import { moneySchema, shortText, uuidSchema } from './primitives';

export const verifyPaymentSchema = z.object({
  paymentId: uuidSchema,
  providerOrderId: z.string().trim().min(1).max(128),
  providerPaymentId: z.string().trim().min(1).max(128),
  /** HMAC hex digest from the gateway; length-bounded before any crypto work. */
  signature: z.string().trim().min(16).max(512),
});
export type VerifyPaymentInput = z.infer<typeof verifyPaymentSchema>;

export const refundSchema = z.object({
  amount: moneySchema.optional(),
  reason: shortText(500),
});

export const paymentProviderSchema = z.enum(['mock', 'razorpay', 'cod']);

/**
 * Webhook bodies are intentionally typed as unknown: the raw body is what gets
 * signature-verified, and each provider adapter parses its own shape after that.
 */
export const webhookEnvelopeSchema = z.object({}).passthrough();

/**
 * Merchant-supplied gateway configuration.
 *
 * Secrets are write-only: they are accepted here and never returned by any
 * endpoint. Omitting one leaves the stored value untouched, so a merchant can
 * edit their public key without re-entering credentials the API will not show
 * them again.
 */
export const upsertPaymentConfigSchema = z.object({
  provider: z.enum(['mock', 'razorpay']),
  enabled: z.boolean(),
  environment: z.enum(['test', 'live']).default('test'),
  /** Sent to the checkout SDK in the browser; public by definition. */
  publicKey: z.string().trim().max(255).nullish(),
  secretKey: z.string().trim().min(8).max(512).nullish(),
  webhookSecret: z.string().trim().min(8).max(512).nullish(),
  currency: z.string().trim().length(3).toUpperCase().optional(),
});
export type UpsertPaymentConfigInput = z.infer<typeof upsertPaymentConfigSchema>;
