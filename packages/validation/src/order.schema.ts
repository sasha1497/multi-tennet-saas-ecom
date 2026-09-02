import { z } from 'zod';
import { addressSnapshotSchema } from './customer.schema';
import {
  dateRangeSchema,
  idempotencyKeySchema,
  paginationSchema,
  shortText,
  uuidSchema,
} from './primitives';

export const orderStatusSchema = z.enum([
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
]);

export const paymentStatusSchema = z.enum([
  'PENDING',
  'AUTHORIZED',
  'PAID',
  'FAILED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
]);

export const paymentMethodSchema = z.enum(['COD', 'UPI', 'CARD', 'NETBANKING', 'WALLET']);

export const createOrderSchema = z
  .object({
    shippingAddressId: uuidSchema.optional(),
    shippingAddress: addressSnapshotSchema.optional(),
    billingAddressId: uuidSchema.optional(),
    billingAddress: addressSnapshotSchema.nullish(),
    paymentMethod: paymentMethodSchema,
    notes: z.string().trim().max(1000).nullish(),
    idempotencyKey: idempotencyKeySchema,
  })
  .refine((v) => Boolean(v.shippingAddressId || v.shippingAddress), {
    message: 'A shipping address is required',
    path: ['shippingAddress'],
  });
export type CreateOrderInput = z.infer<typeof createOrderSchema>;

export const updateOrderStatusSchema = z
  .object({
    status: orderStatusSchema,
    note: z.string().trim().max(500).optional(),
    reason: z.string().trim().max(500).optional(),
  })
  // Cancelling without a recorded reason makes support impossible later.
  .refine((v) => v.status !== 'CANCELLED' || Boolean(v.reason), {
    message: 'A reason is required when cancelling an order',
    path: ['reason'],
  });

export const cancelOrderSchema = z.object({ reason: shortText(500) });

export const orderQuerySchema = paginationSchema.merge(dateRangeSchema).extend({
  status: z
    .union([orderStatusSchema, z.array(orderStatusSchema), z.string()])
    .transform((v) =>
      typeof v === 'string' && v.includes(',') ? (v.split(',') as string[]) : v,
    )
    .optional(),
  paymentStatus: paymentStatusSchema.optional(),
  paymentMethod: paymentMethodSchema.optional(),
  customerId: uuidSchema.optional(),
  minAmount: z.coerce.number().int().min(0).optional(),
  maxAmount: z.coerce.number().int().min(0).optional(),
});
export type OrderQueryInput = z.infer<typeof orderQuerySchema>;

export const updateInternalNotesSchema = z.object({
  internalNotes: z.string().trim().max(4000).nullable(),
});
