import { z } from 'zod';
import { emailSchema, passwordSchema, phoneSchema, shortText, slugSchema } from './primitives';

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Password is required').max(72),
  tenantSlug: slugSchema.optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

/**
 * Customers may sign in with either an email or a phone number, so the
 * identifier is validated loosely here and disambiguated server-side.
 */
export const customerLoginSchema = z.object({
  identifier: z.string().trim().min(3, 'Enter your email or mobile number').max(255),
  password: z.string().min(1, 'Password is required').max(72),
});
export type CustomerLoginInput = z.infer<typeof customerLoginSchema>;

export const registerMerchantSchema = z.object({
  firstName: shortText(80),
  lastName: shortText(80),
  email: emailSchema,
  phone: phoneSchema,
  password: passwordSchema,
  storeName: shortText(120),
  storeSlug: slugSchema.optional(),
  businessCategory: z.string().trim().max(80).optional(),
  planCode: z.string().trim().max(32).optional(),
});
export type RegisterMerchantInput = z.infer<typeof registerMerchantSchema>;

export const registerCustomerSchema = z
  .object({
    firstName: shortText(80),
    lastName: z.string().trim().max(80).default(''),
    email: emailSchema.optional(),
    phone: phoneSchema.optional(),
    password: passwordSchema,
  })
  .refine((v) => Boolean(v.email || v.phone), {
    message: 'Provide an email address or a mobile number',
    path: ['email'],
  });
export type RegisterCustomerInput = z.infer<typeof registerCustomerSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(10).max(4096),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(72),
    newPassword: passwordSchema,
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: 'New password must differ from the current one',
    path: ['newPassword'],
  });

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(512),
  newPassword: passwordSchema,
});

export const checkSlugSchema = z.object({ slug: slugSchema });

export const verifyEmailSchema = z.object({ token: z.string().min(10).max(512) });

/** Sent by the console when the user switches which store they are managing. */
export const switchTenantSchema = z.object({ tenantId: z.string().uuid() });

export const inviteStaffSchema = z.object({
  email: emailSchema,
  firstName: shortText(80),
  lastName: z.string().trim().max(80).default(''),
  phone: phoneSchema.optional(),
  role: z.enum(['MANAGER', 'STAFF']),
  extraPermissions: z.array(z.string().max(64)).max(50).default([]),
});
export type InviteStaffInput = z.infer<typeof inviteStaffSchema>;

export const updateStaffSchema = z.object({
  role: z.enum(['MANAGER', 'STAFF']).optional(),
  extraPermissions: z.array(z.string().max(64)).max(50).optional(),
  isActive: z.boolean().optional(),
});
