import { z } from 'zod';

/** UUID v4 identifier used by every entity in the system. */
export const uuidSchema = z.string().uuid('Must be a valid identifier');

/**
 * Money is always a non-negative integer in the currency's minor unit.
 * Rejecting floats here is what keeps ₹19.99 from becoming 19.989999999.
 */
export const moneySchema = z
  .number()
  .int('Amount must be a whole number of paise')
  .nonnegative('Amount cannot be negative')
  .max(1_000_000_000, 'Amount is unreasonably large');

export const positiveMoneySchema = moneySchema.refine((v) => v > 0, 'Amount must be greater than 0');

/** Percentage expressed in basis points: 1850 = 18.50 %. */
export const basisPointsSchema = z.number().int().min(0).max(10_000);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(255)
  .email('Enter a valid email address');

/**
 * Indian mobile numbers, with or without the +91 country code.
 * Stored normalised as 10 digits by `normalisePhone`.
 */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(?:\+?91[-\s]?)?[6-9]\d{9}$/, 'Enter a valid 10-digit mobile number');

export function normalisePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Password policy: 8-72 chars (bcrypt truncates past 72), with at least one
 * letter and one digit. Deliberately not demanding symbols — length beats
 * character-class theatre.
 */
export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/\d/, 'Password must contain a number');

/**
 * A tenant/product/category slug. Lowercase, hyphen-separated, no leading or
 * trailing hyphen. Tenant slugs additionally may not be a reserved subdomain —
 * that check happens server-side against RESERVED_SUBDOMAINS.
 */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Must be at least 3 characters')
  .max(63, 'Must be at most 63 characters')
  .regex(
    /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    'Use lowercase letters, numbers and hyphens only',
  )
  .refine((s) => !s.includes('--'), 'Cannot contain consecutive hyphens');

/** Strips combining diacritical marks (U+0300–U+036F) left by NFKD. */
const COMBINING_MARKS = /[̀-ͯ]/g;

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 63);
}

export const postalCodeSchema = z
  .string()
  .trim()
  .regex(/^[1-9][0-9]{5}$/, 'Enter a valid 6-digit PIN code');

export const skuSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'SKU is too short')
  .max(64, 'SKU is too long')
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'SKU may contain letters, numbers, dot, dash and underscore');

export const couponCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3)
  .max(32)
  .regex(/^[A-Z0-9_-]+$/, 'Coupon codes use letters, numbers, dash and underscore');

/**
 * Hostname validation. Written without lookbehind on purpose — Hermes (the
 * React Native engine) does not support `(?<!...)`.
 */
export const hostnameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(253)
  .regex(
    /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/,
    'Enter a valid hostname',
  );

export const sortOrderSchema = z.enum(['asc', 'desc']);

/** Query-string numbers arrive as strings; coerce then bound them. */
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.string().max(64).optional(),
  sortOrder: sortOrderSchema.default('desc'),
  search: z.string().trim().max(200).optional(),
});

export const cursorPaginationSchema = z.object({
  cursor: z.string().max(256).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const idParamSchema = z.object({ id: uuidSchema });

export const dateRangeSchema = z.object({
  dateFrom: z.string().datetime({ offset: true }).optional(),
  dateTo: z.string().datetime({ offset: true }).optional(),
});

/**
 * Idempotency keys are client-generated. We bound the length and character set
 * so they are safe to use as a database unique key and a Redis key fragment.
 */
export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/, 'Invalid idempotency key');

/** Rejects `javascript:` and other non-http(s) schemes before we ever render a link. */
export const httpUrlSchema = z
  .string()
  .trim()
  .url('Enter a valid URL')
  .max(2048)
  .refine((u) => /^https?:\/\//i.test(u), 'URL must start with http:// or https://');

export const hexColorSchema = z
  .string()
  .trim()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, 'Enter a hex colour like #2563eb');

/** Free-text fields are trimmed and length-bounded to keep payloads sane. */
export const shortText = (max = 200) => z.string().trim().min(1).max(max);
export const optionalText = (max = 2000) =>
  z.string().trim().max(max).nullish().transform((v) => (v === '' ? null : (v ?? null)));
