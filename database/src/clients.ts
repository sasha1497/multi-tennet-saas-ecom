/* eslint-disable @typescript-eslint/no-var-requires */
import {
  PrismaClient as GeneratedMasterClient,
  Prisma as GeneratedMasterPrisma,
} from '../generated/master';
import {
  PrismaClient as GeneratedTenantClient,
  Prisma as GeneratedTenantPrisma,
} from '../generated/tenant';

/** Control-plane client. Exactly one instance per process. */
export const MasterPrismaClient = GeneratedMasterClient;
export type MasterPrismaClient = GeneratedMasterClient;
export const MasterPrisma = GeneratedMasterPrisma;
export type MasterPrisma = typeof GeneratedMasterPrisma;

/**
 * Tenant client. One instance per *active* tenant, created on demand by
 * TenantConnectionManager with the datasource URL overridden — never a global.
 */
export const TenantPrismaClient = GeneratedTenantClient;
export type TenantPrismaClient = GeneratedTenantClient;
export const TenantPrisma = GeneratedTenantPrisma;
export type TenantPrisma = typeof GeneratedTenantPrisma;

// Re-export the generated enums so services can use them without importing from
// `generated/` and without duplicating the string unions in @retailos/types.
export {
  TenantStatus as DbTenantStatus,
  UserType as DbUserType,
  MemberRole as DbMemberRole,
  DomainType as DbDomainType,
  SubscriptionStatus as DbSubscriptionStatus,
  ProvisioningJobStatus as DbProvisioningJobStatus,
  TenantDatabaseStatus as DbTenantDatabaseStatus,
  EntitlementSource as DbEntitlementSource,
  TokenAudience as DbTokenAudience,
  VerificationTokenType as DbVerificationTokenType,
} from '../generated/master';

export {
  ProductStatus as DbProductStatus,
  OrderStatus as DbOrderStatus,
  PaymentStatus as DbPaymentStatus,
  PaymentMethod as DbPaymentMethod,
  DiscountType as DbDiscountType,
  AddressType as DbAddressType,
  InventoryTransactionType as DbInventoryTransactionType,
  NotificationChannel as DbNotificationChannel,
  NotificationStatus as DbNotificationStatus,
  ActorType as DbActorType,
} from '../generated/tenant';

/** Model row types, handy for service signatures. */
export type {
  User as MasterUser,
  Tenant as MasterTenant,
  TenantUser as MasterTenantUser,
  Domain as MasterDomain,
  TenantDatabase as MasterTenantDatabase,
  Plan as MasterPlan,
  Subscription as MasterSubscription,
  FeatureEntitlement as MasterFeatureEntitlement,
  TenantProvisioningJob as MasterProvisioningJob,
  Session as MasterSession,
  PlatformAuditLog as MasterAuditLog,
  PaymentRoute as MasterPaymentRoute,
} from '../generated/master';

export type {
  Customer as TenantCustomer,
  Address as TenantAddress,
  Category as TenantCategory,
  Brand as TenantBrand,
  Product as TenantProduct,
  ProductImage as TenantProductImage,
  ProductVariant as TenantProductVariant,
  Inventory as TenantInventory,
  InventoryTransaction as TenantInventoryTransaction,
  Cart as TenantCart,
  CartItem as TenantCartItem,
  Coupon as TenantCoupon,
  Order as TenantOrder,
  OrderItem as TenantOrderItem,
  OrderStatusHistory as TenantOrderStatusHistory,
  Payment as TenantPayment,
  Review as TenantReview,
  StoreSettings as TenantStoreSettings,
  Notification as TenantNotification,
  StaffProfile as TenantStaffProfile,
} from '../generated/tenant';

/**
 * Builds a tenant datasource URL.
 *
 * `connection_limit` is intentionally small: with database-per-tenant we may
 * hold clients for dozens of tenants in one process, so each pool has to be
 * modest or we exhaust PostgreSQL's `max_connections`.
 */
export function buildTenantDatabaseUrl(params: {
  host: string;
  port: number;
  database: string;
  username: string;
  password: string;
  connectionLimit?: number;
  poolTimeoutSeconds?: number;
  schema?: string;
  ssl?: boolean;
}): string {
  const {
    host,
    port,
    database,
    username,
    password,
    connectionLimit = 5,
    poolTimeoutSeconds = 15,
    schema = 'public',
    ssl = false,
  } = params;

  const search = new URLSearchParams({
    schema,
    connection_limit: String(connectionLimit),
    pool_timeout: String(poolTimeoutSeconds),
  });
  if (ssl) search.set('sslmode', 'require');

  return `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(
    password,
  )}@${host}:${port}/${encodeURIComponent(database)}?${search.toString()}`;
}

/** Strips credentials so a connection string is safe to log. */
export function redactDatabaseUrl(url: string): string {
  return url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}
