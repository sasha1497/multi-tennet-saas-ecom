import { z } from 'zod';
import {
  dateRangeSchema,
  emailSchema,
  hostnameSchema,
  paginationSchema,
  passwordSchema,
  phoneSchema,
  shortText,
  slugSchema,
  uuidSchema,
} from './primitives';

export const tenantStatusSchema = z.enum([
  'PROVISIONING',
  'ACTIVE',
  'SUSPENDED',
  'DELETING',
  'DELETED',
]);

export const createTenantSchema = z.object({
  name: shortText(120),
  slug: slugSchema.optional(),
  ownerEmail: emailSchema,
  ownerFirstName: shortText(80),
  ownerLastName: z.string().trim().max(80).default(''),
  ownerPhone: phoneSchema.optional(),
  /** Omitted in production: the owner receives an invite link instead. */
  ownerPassword: passwordSchema.optional(),
  businessCategory: z.string().trim().max(80).optional(),
  planCode: z.string().trim().max(32).default('FREE'),
});
export type CreateTenantInput = z.infer<typeof createTenantSchema>;

export const updateTenantStatusSchema = z
  .object({
    status: tenantStatusSchema,
    reason: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status !== 'SUSPENDED' || Boolean(v.reason), {
    message: 'A reason is required when suspending a tenant',
    path: ['reason'],
  });

export const platformTenantQuerySchema = paginationSchema.extend({
  status: tenantStatusSchema.optional(),
  planCode: z.string().trim().max(32).optional(),
});

export const auditLogQuerySchema = paginationSchema.merge(dateRangeSchema).extend({
  tenantId: uuidSchema.optional(),
  userId: uuidSchema.optional(),
  action: z.string().trim().max(64).optional(),
  resourceType: z.string().trim().max(64).optional(),
});

export const addDomainSchema = z.object({
  hostname: hostnameSchema,
  isPrimary: z.boolean().default(false),
});

export const planFeaturesSchema = z.record(z.string().max(64), z.boolean());
export const planLimitsSchema = z.record(z.string().max(64), z.number().int().min(-1));

export const upsertPlanSchema = z.object({
  code: z.string().trim().toUpperCase().min(2).max(32),
  name: shortText(80),
  description: z.string().trim().max(500).nullish(),
  priceMonthly: z.number().int().min(0),
  priceYearly: z.number().int().min(0),
  currency: z.string().trim().length(3).default('INR'),
  trialDays: z.number().int().min(0).max(365).default(0),
  isActive: z.boolean().default(true),
  isPublic: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
  features: planFeaturesSchema.default({}),
  /** `-1` means unlimited. */
  limits: planLimitsSchema.default({}),
});

export const setEntitlementSchema = z.object({
  featureKey: z.string().trim().max(64),
  enabled: z.boolean(),
  limitValue: z.number().int().min(-1).nullish(),
  expiresAt: z.string().datetime({ offset: true }).nullish(),
});

export const changeSubscriptionSchema = z.object({
  planCode: z.string().trim().toUpperCase().min(2).max(32),
  /** Skip the trial when moving an existing paying tenant. */
  skipTrial: z.boolean().default(false),
});

export const reportQuerySchema = z
  .object({
    range: z.enum(['7d', '30d', '90d', 'mtd', 'ytd', 'custom']).default('30d'),
  })
  .merge(dateRangeSchema)
  .refine((v) => v.range !== 'custom' || (Boolean(v.dateFrom) && Boolean(v.dateTo)), {
    message: 'A custom range needs both a start and an end date',
    path: ['dateFrom'],
  });
export type ReportQueryInput = z.infer<typeof reportQuerySchema>;
