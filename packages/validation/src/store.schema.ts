import { z } from 'zod';
import {
  basisPointsSchema,
  hexColorSchema,
  httpUrlSchema,
  moneySchema,
  optionalText,
  phoneSchema,
  postalCodeSchema,
  shortText,
} from './primitives';

export const storeThemeSchema = z.object({
  primaryColor: hexColorSchema.default('#2563eb'),
  accentColor: hexColorSchema.default('#f97316'),
  radius: z.enum(['none', 'sm', 'md', 'lg', 'full']).default('md'),
  fontFamily: z.string().trim().max(80).default('Inter'),
  colorMode: z.enum(['light', 'dark', 'system']).default('light'),
});

export const storeBannerSchema = z.object({
  id: z.string().max(64).optional(),
  title: shortText(120),
  subtitle: z.string().trim().max(200).nullish(),
  imageUrl: httpUrlSchema,
  mobileImageUrl: httpUrlSchema.nullish(),
  ctaLabel: z.string().trim().max(40).nullish(),
  ctaHref: z.string().trim().max(500).nullish(),
  sortOrder: z.number().int().min(0).max(99).default(0),
  isActive: z.boolean().default(true),
});

export const businessHoursSchema = z.object({
  day: z.number().int().min(0).max(6),
  open: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
    .nullish(),
  close: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM')
    .nullish(),
  closed: z.boolean().default(false),
});

export const updateStoreSettingsSchema = z
  .object({
    storeName: shortText(120).optional(),
    tagline: optionalText(160),
    description: optionalText(5000),
    logoUrl: httpUrlSchema.nullish(),
    faviconUrl: httpUrlSchema.nullish(),
    theme: storeThemeSchema.partial().optional(),
    banners: z.array(storeBannerSchema).max(8).optional(),

    contactEmail: z.string().trim().email().nullish(),
    contactPhone: phoneSchema.nullish(),
    whatsappNumber: phoneSchema.nullish(),
    addressLine1: z.string().trim().max(200).nullish(),
    addressLine2: z.string().trim().max(200).nullish(),
    city: z.string().trim().max(80).nullish(),
    state: z.string().trim().max(80).nullish(),
    postalCode: postalCodeSchema.nullish(),
    country: z.string().trim().length(2).optional(),

    currency: z.string().trim().length(3).optional(),
    currencySymbol: z.string().trim().max(4).optional(),
    defaultTaxRateBps: basisPointsSchema.optional(),
    taxInclusivePricing: z.boolean().optional(),

    minOrderAmount: moneySchema.optional(),
    shippingFee: moneySchema.optional(),
    freeShippingThreshold: moneySchema.optional(),

    codEnabled: z.boolean().optional(),
    onlinePaymentEnabled: z.boolean().optional(),
    allowBackorder: z.boolean().optional(),

    businessHours: z.array(businessHoursSchema).length(7).optional(),
    socialLinks: z.record(z.string().max(30), z.string().max(300)).optional(),
    isPublished: z.boolean().optional(),
    maintenanceMessage: optionalText(500),
  })
  // A store with no payment method at all cannot take a single order.
  .refine((v) => v.codEnabled !== false || v.onlinePaymentEnabled !== false, {
    message: 'Enable at least one payment method',
    path: ['codEnabled'],
  });
export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>;
