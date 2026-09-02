import { z } from 'zod';
import {
  basisPointsSchema,
  httpUrlSchema,
  moneySchema,
  optionalText,
  paginationSchema,
  shortText,
  skuSchema,
  uuidSchema,
} from './primitives';

export const productStatusSchema = z.enum(['DRAFT', 'PUBLISHED', 'ARCHIVED']);

export const productOptionSchema = z.object({
  name: shortText(40),
  values: z.array(shortText(60)).min(1, 'Add at least one value').max(50),
});

export const productImageInputSchema = z.object({
  url: httpUrlSchema,
  alt: z.string().trim().max(200).nullish(),
  isPrimary: z.boolean().default(false),
});

export const upsertVariantSchema = z
  .object({
    id: uuidSchema.optional(),
    sku: skuSchema,
    barcode: z.string().trim().max(64).nullish(),
    options: z.record(z.string().max(40), z.string().max(60)).default({}),
    price: moneySchema,
    mrp: moneySchema,
    imageUrl: httpUrlSchema.nullish(),
    weightGrams: z.number().int().min(0).max(1_000_000).nullish(),
    isActive: z.boolean().default(true),
    initialStock: z.number().int().min(0).max(1_000_000).default(0),
    lowStockThreshold: z.number().int().min(0).max(100_000).default(5),
  })
  // A selling price above MRP would render a negative discount in the UI.
  .refine((v) => v.mrp >= v.price, {
    message: 'MRP must be greater than or equal to the selling price',
    path: ['mrp'],
  });

export const createProductSchema = z
  .object({
    name: shortText(200),
    description: optionalText(20_000),
    shortDescription: optionalText(500),
    status: productStatusSchema.default('DRAFT'),
    categoryId: uuidSchema.nullish(),
    brandId: uuidSchema.nullish(),
    images: z.array(productImageInputSchema).max(12).default([]),
    options: z.array(productOptionSchema).max(3).default([]),
    variants: z.array(upsertVariantSchema).min(1, 'A product needs at least one variant').max(200),
    taxRateBps: basisPointsSchema.nullish(),
    hsnCode: z.string().trim().max(16).nullish(),
    isFeatured: z.boolean().default(false),
    metaTitle: z.string().trim().max(160).nullish(),
    metaDescription: z.string().trim().max(320).nullish(),
    tags: z.array(z.string().trim().min(1).max(40)).max(25).default([]),
  })
  // Duplicate SKUs inside one payload would fail at the DB unique index with a
  // much less helpful message.
  .refine(
    (v) => new Set(v.variants.map((x) => x.sku)).size === v.variants.length,
    { message: 'Every variant needs a unique SKU', path: ['variants'] },
  );
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = createProductSchema.innerType().partial().extend({
  variants: z.array(upsertVariantSchema).max(200).optional(),
});
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

export const productQuerySchema = paginationSchema.extend({
  categoryId: uuidSchema.optional(),
  categorySlug: z.string().trim().max(80).optional(),
  brandId: uuidSchema.optional(),
  status: productStatusSchema.optional(),
  isFeatured: z.coerce.boolean().optional(),
  inStock: z.coerce.boolean().optional(),
  lowStockOnly: z.coerce.boolean().optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  tags: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (typeof v === 'string' ? v.split(',').filter(Boolean) : v))
    .optional(),
});
export type ProductQueryInput = z.infer<typeof productQuerySchema>;

export const createCategorySchema = z.object({
  name: shortText(120),
  description: optionalText(1000),
  imageUrl: httpUrlSchema.nullish(),
  iconName: z.string().trim().max(60).nullish(),
  parentId: uuidSchema.nullish(),
  sortOrder: z.number().int().min(0).max(9999).default(0),
  isActive: z.boolean().default(true),
});
export const updateCategorySchema = createCategorySchema.partial();

export const createBrandSchema = z.object({
  name: shortText(120),
  description: optionalText(1000),
  logoUrl: httpUrlSchema.nullish(),
  isActive: z.boolean().default(true),
});
export const updateBrandSchema = createBrandSchema.partial();

export const createReviewSchema = z.object({
  productId: uuidSchema,
  rating: z.number().int().min(1, 'Pick a rating').max(5),
  title: z.string().trim().max(120).nullish(),
  comment: z.string().trim().max(2000).nullish(),
  orderId: uuidSchema.nullish(),
});

export const moderateReviewSchema = z.object({ isApproved: z.boolean() });

export const reviewQuerySchema = paginationSchema.extend({
  productId: uuidSchema.optional(),
  isApproved: z.coerce.boolean().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
});
