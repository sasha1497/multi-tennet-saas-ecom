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
