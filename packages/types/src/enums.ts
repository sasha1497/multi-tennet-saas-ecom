/**
 * Domain enums shared by every application.
 *
 * These are declared as `const` objects rather than TS `enum`s so they are safe
 * to consume from `isolatedModules` bundlers (Next.js, Metro) and can be
 * iterated at runtime.
 */

/** Lifecycle of a tenant, mirrored by `tenants.status` in the master DB. */
export const TenantStatus = {
  PROVISIONING: 'PROVISIONING',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  DELETING: 'DELETING',
  DELETED: 'DELETED',
} as const;
export type TenantStatus = (typeof TenantStatus)[keyof typeof TenantStatus];

/** Fine-grained provisioning progress, tracked per job for operator visibility. */
export const ProvisioningStep = {
  CREATE_DATABASE: 'CREATE_DATABASE',
  CREATE_ROLE: 'CREATE_ROLE',
  RUN_MIGRATIONS: 'RUN_MIGRATIONS',
  SEED_DEFAULTS: 'SEED_DEFAULTS',
  CONFIGURE_BRANDING: 'CONFIGURE_BRANDING',
  ACTIVATE: 'ACTIVATE',
} as const;
export type ProvisioningStep = (typeof ProvisioningStep)[keyof typeof ProvisioningStep];

export const ProvisioningJobStatus = {
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProvisioningJobStatus =
  (typeof ProvisioningJobStatus)[keyof typeof ProvisioningJobStatus];

/**
 * Platform-level actor kinds. A single human may hold a platform user record
 * and be a member of several tenants; the *role* lives on the membership.
 */
export const UserType = {
  PLATFORM: 'PLATFORM',
  MERCHANT: 'MERCHANT',
} as const;
export type UserType = (typeof UserType)[keyof typeof UserType];

export const Role = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  OWNER: 'OWNER',
  MANAGER: 'MANAGER',
  STAFF: 'STAFF',
  CUSTOMER: 'CUSTOMER',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

/** Which audience a token was minted for. Guards refuse cross-audience tokens. */
export const TokenAudience = {
  /** Merchant console + platform console users (identity lives in master DB). */
  ADMIN: 'admin',
  /** Storefront/mobile shoppers (identity lives in the tenant DB). */
  CUSTOMER: 'customer',
} as const;
export type TokenAudience = (typeof TokenAudience)[keyof typeof TokenAudience];

export const SubscriptionStatus = {
  TRIALING: 'TRIALING',
  ACTIVE: 'ACTIVE',
  PAST_DUE: 'PAST_DUE',
  CANCELLED: 'CANCELLED',
  EXPIRED: 'EXPIRED',
} as const;
export type SubscriptionStatus = (typeof SubscriptionStatus)[keyof typeof SubscriptionStatus];

export const PlanCode = {
  FREE: 'FREE',
  STARTER: 'STARTER',
  PRO: 'PRO',
  ENTERPRISE: 'ENTERPRISE',
} as const;
export type PlanCode = (typeof PlanCode)[keyof typeof PlanCode];

export const ProductStatus = {
  DRAFT: 'DRAFT',
  PUBLISHED: 'PUBLISHED',
  ARCHIVED: 'ARCHIVED',
} as const;
export type ProductStatus = (typeof ProductStatus)[keyof typeof ProductStatus];

export const OrderStatus = {
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  PROCESSING: 'PROCESSING',
  SHIPPED: 'SHIPPED',
  OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
  CANCELLED: 'CANCELLED',
  REFUNDED: 'REFUNDED',
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

/**
 * Legal forward transitions. The API validates every status change against this
 * map so an order can never jump from PENDING straight to DELIVERED.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: ['REFUNDED'],
  REFUNDED: [],
} as const;

/** Statuses at which stock reservations are released back to available. */
export const ORDER_STOCK_RELEASING_STATUSES: readonly OrderStatus[] = ['CANCELLED', 'REFUNDED'];

/** Statuses a customer is still allowed to cancel from. */
export const CUSTOMER_CANCELLABLE_STATUSES: readonly OrderStatus[] = [
  'PENDING',
  'CONFIRMED',
  'PROCESSING',
];

export const PaymentStatus = {
  PENDING: 'PENDING',
  AUTHORIZED: 'AUTHORIZED',
  PAID: 'PAID',
  FAILED: 'FAILED',
  REFUNDED: 'REFUNDED',
  PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
} as const;
export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export const PaymentMethod = {
  COD: 'COD',
  UPI: 'UPI',
  CARD: 'CARD',
  NETBANKING: 'NETBANKING',
  WALLET: 'WALLET',
} as const;
export type PaymentMethod = (typeof PaymentMethod)[keyof typeof PaymentMethod];

export const PaymentProvider = {
  MOCK: 'mock',
  RAZORPAY: 'razorpay',
  COD: 'cod',
} as const;
export type PaymentProvider = (typeof PaymentProvider)[keyof typeof PaymentProvider];

export const DiscountType = {
  PERCENTAGE: 'PERCENTAGE',
  FIXED: 'FIXED',
} as const;
export type DiscountType = (typeof DiscountType)[keyof typeof DiscountType];

export const InventoryTransactionType = {
  PURCHASE: 'PURCHASE',
  SALE: 'SALE',
  RETURN: 'RETURN',
  ADJUSTMENT: 'ADJUSTMENT',
  RESERVATION: 'RESERVATION',
  RELEASE: 'RELEASE',
  DAMAGE: 'DAMAGE',
  INITIAL: 'INITIAL',
} as const;
export type InventoryTransactionType =
  (typeof InventoryTransactionType)[keyof typeof InventoryTransactionType];

export const AddressType = {
  HOME: 'HOME',
  WORK: 'WORK',
  OTHER: 'OTHER',
} as const;
export type AddressType = (typeof AddressType)[keyof typeof AddressType];

export const NotificationChannel = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  PUSH: 'PUSH',
  IN_APP: 'IN_APP',
} as const;
export type NotificationChannel = (typeof NotificationChannel)[keyof typeof NotificationChannel];

export const NotificationStatus = {
  QUEUED: 'QUEUED',
  SENT: 'SENT',
  FAILED: 'FAILED',
  READ: 'READ',
} as const;
export type NotificationStatus = (typeof NotificationStatus)[keyof typeof NotificationStatus];

/** Feature flags an entitlement can toggle per tenant. */
export const FeatureKey = {
  PRODUCTS: 'products',
  ORDERS: 'orders',
  STAFF: 'staff',
  COUPONS: 'coupons',
  REPORTS: 'reports',
  ADVANCED_ANALYTICS: 'advanced_analytics',
  CUSTOM_DOMAIN: 'custom_domain',
  DELIVERY: 'delivery',
  LOYALTY: 'loyalty',
  MARKETING: 'marketing',
  POS: 'pos',
  MULTI_BRANCH: 'multi_branch',
  WHITE_LABEL_APP: 'white_label_app',
} as const;
export type FeatureKey = (typeof FeatureKey)[keyof typeof FeatureKey];

/** Quota keys — numeric limits enforced by `PlanLimitGuard`. */
export const LimitKey = {
  MAX_PRODUCTS: 'max_products',
  MAX_STAFF: 'max_staff',
  MAX_ORDERS_PER_MONTH: 'max_orders_per_month',
  MAX_STORAGE_MB: 'max_storage_mb',
} as const;
export type LimitKey = (typeof LimitKey)[keyof typeof LimitKey];

export const DomainType = {
  SUBDOMAIN: 'SUBDOMAIN',
  CUSTOM: 'CUSTOM',
} as const;
export type DomainType = (typeof DomainType)[keyof typeof DomainType];

export const AuditAction = {
  LOGIN: 'LOGIN',
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGOUT: 'LOGOUT',
  TENANT_CREATED: 'TENANT_CREATED',
  TENANT_ACTIVATED: 'TENANT_ACTIVATED',
  TENANT_SUSPENDED: 'TENANT_SUSPENDED',
  TENANT_DELETED: 'TENANT_DELETED',
  TENANT_PROVISION_STARTED: 'TENANT_PROVISION_STARTED',
  TENANT_PROVISION_COMPLETED: 'TENANT_PROVISION_COMPLETED',
  TENANT_PROVISION_FAILED: 'TENANT_PROVISION_FAILED',
  PRODUCT_CREATED: 'PRODUCT_CREATED',
  PRODUCT_UPDATED: 'PRODUCT_UPDATED',
  PRODUCT_DELETED: 'PRODUCT_DELETED',
  INVENTORY_ADJUSTED: 'INVENTORY_ADJUSTED',
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_STATUS_CHANGED: 'ORDER_STATUS_CHANGED',
  PAYMENT_EVENT: 'PAYMENT_EVENT',
  STAFF_INVITED: 'STAFF_INVITED',
  STAFF_UPDATED: 'STAFF_UPDATED',
  STAFF_REMOVED: 'STAFF_REMOVED',
  PERMISSIONS_CHANGED: 'PERMISSIONS_CHANGED',
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
  SUBSCRIPTION_CHANGED: 'SUBSCRIPTION_CHANGED',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];
