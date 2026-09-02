import { z } from 'zod';
import { paginationSchema, uuidSchema } from './primitives';

export const inventoryTransactionTypeSchema = z.enum([
  'PURCHASE',
  'SALE',
  'RETURN',
  'ADJUSTMENT',
  'RESERVATION',
  'RELEASE',
  'DAMAGE',
  'INITIAL',
]);

export const adjustInventorySchema = z
  .object({
    variantId: uuidSchema,
    /** Signed delta, e.g. -3 for damage. */
    quantityChange: z.number().int().min(-1_000_000).max(1_000_000).optional(),
    /** Absolute stock-take value. Mutually exclusive with `quantityChange`. */
    setQuantity: z.number().int().min(0).max(1_000_000).optional(),
    type: inventoryTransactionTypeSchema.default('ADJUSTMENT'),
    reason: z.string().trim().max(500).optional(),
    expectedVersion: z.number().int().min(0).optional(),
  })
  .refine(
    (v) =>
      (v.quantityChange !== undefined) !== (v.setQuantity !== undefined),
    { message: 'Provide either a quantity change or an absolute quantity, not both' },
  )
  .refine((v) => v.quantityChange !== 0, {
    message: 'Quantity change cannot be zero',
    path: ['quantityChange'],
  });
export type AdjustInventoryInput = z.infer<typeof adjustInventorySchema>;

export const bulkAdjustInventorySchema = z.object({
  adjustments: z.array(adjustInventorySchema).min(1).max(200),
});

export const updateLowStockThresholdSchema = z.object({
  variantId: uuidSchema,
  lowStockThreshold: z.number().int().min(0).max(100_000),
});

export const inventoryQuerySchema = paginationSchema.extend({
  lowStockOnly: z.coerce.boolean().optional(),
  outOfStockOnly: z.coerce.boolean().optional(),
  categoryId: uuidSchema.optional(),
});

export const inventoryTransactionQuerySchema = paginationSchema.extend({
  variantId: uuidSchema.optional(),
  type: inventoryTransactionTypeSchema.optional(),
});
