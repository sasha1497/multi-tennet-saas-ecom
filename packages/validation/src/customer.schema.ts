import { z } from 'zod';
import {
  emailSchema,
  httpUrlSchema,
  optionalText,
  paginationSchema,
  phoneSchema,
  postalCodeSchema,
  shortText,
  uuidSchema,
} from './primitives';

export const addressTypeSchema = z.enum(['HOME', 'WORK', 'OTHER']);

export const addressBodySchema = z.object({
  type: addressTypeSchema.default('HOME'),
  label: z.string().trim().max(40).nullish(),
  fullName: shortText(120),
  phone: phoneSchema,
  line1: shortText(200),
  line2: z.string().trim().max(200).nullish(),
  landmark: z.string().trim().max(120).nullish(),
  city: shortText(80),
  state: shortText(80),
  postalCode: postalCodeSchema,
  country: z.string().trim().length(2).default('IN'),
  isDefault: z.boolean().default(false),
});
export type AddressInput = z.infer<typeof addressBodySchema>;

export const createAddressSchema = addressBodySchema;
export const updateAddressSchema = addressBodySchema.partial();

/** Address snapshot embedded in an order — same fields, minus the book metadata. */
export const addressSnapshotSchema = addressBodySchema.omit({
  type: true,
  label: true,
  isDefault: true,
});

export const updateCustomerProfileSchema = z.object({
  firstName: shortText(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  avatarUrl: httpUrlSchema.nullish(),
});

/** Merchant-side edit — deliberately cannot change credentials. */
export const merchantUpdateCustomerSchema = z.object({
  notes: optionalText(2000),
  isActive: z.boolean().optional(),
});

export const customerQuerySchema = paginationSchema.extend({
  isActive: z.coerce.boolean().optional(),
  hasOrders: z.coerce.boolean().optional(),
});

export const wishlistItemSchema = z.object({ productId: uuidSchema });
