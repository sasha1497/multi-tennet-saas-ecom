import { z } from 'zod';
import {
  couponCodeSchema,
  moneySchema,
  optionalText,
  paginationSchema,
  uuidSchema,
} from './primitives';

/** Hard per-line cap; stops a fat-fingered "999999" from reserving all stock. */
export const MAX_CART_ITEM_QUANTITY = 100;

export const addCartItemSchema = z.object({
  variantId: uuidSchema,
  quantity: z.number().int().min(1).max(MAX_CART_ITEM_QUANTITY).default(1),
});

export const updateCartItemSchema = z.object({
  quantity: z.number().int().min(0).max(MAX_CART_ITEM_QUANTITY),
});

export const applyCouponSchema = z.object({ code: couponCodeSchema });

export const discountTypeSchema = z.enum(['PERCENTAGE', 'FIXED']);

export const createCouponSchema = z
  .object({
    code: couponCodeSchema,
    description: optionalText(300),
    discountType: discountTypeSchema,
    discountValue: z.number().int().min(1),
    maxDiscountAmount: moneySchema.nullish(),
    minOrderAmount: moneySchema.default(0),
    usageLimit: z.number().int().min(1).max(1_000_000).nullish(),
    perCustomerLimit: z.number().int().min(1).max(1000).nullish(),
    startsAt: z.string().datetime({ offset: true }).nullish(),
    endsAt: z.string().datetime({ offset: true }).nullish(),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.discountType !== 'PERCENTAGE' || v.discountValue <= 100, {
    message: 'A percentage discount cannot exceed 100',
    path: ['discountValue'],
  })
  .refine((v) => !v.startsAt || !v.endsAt || new Date(v.startsAt) < new Date(v.endsAt), {
    message: 'The end date must be after the start date',
    path: ['endsAt'],
  });
export type CreateCouponInput = z.infer<typeof createCouponSchema>;

export const updateCouponSchema = createCouponSchema.innerType().innerType().partial();

export const couponQuerySchema = paginationSchema.extend({
  isActive: z.coerce.boolean().optional(),
});
