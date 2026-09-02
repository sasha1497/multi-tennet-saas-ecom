/** Values shared by the API and every client. Changing one here changes it everywhere. */

export const API_VERSION = 'v1';
export const API_PREFIX = `/api/${API_VERSION}`;

/** Header names. Kept in one place so a rename can't silently break a client. */
export const HEADERS = {
  /**
   * Tenant *hint* for console calls. The API treats it as untrusted input and
   * re-verifies the caller's membership before honouring it.
   */
  TENANT_ID: 'x-tenant-id',
  /** Storefront override used by the mobile app, which has no tenant hostname. */
  TENANT_SLUG: 'x-tenant-slug',
  GUEST_TOKEN: 'x-guest-token',
  REQUEST_ID: 'x-request-id',
  IDEMPOTENCY_KEY: 'x-idempotency-key',
  INTERNAL_API_KEY: 'x-internal-api-key',
} as const;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export const CURRENCY_DEFAULT = 'INR';
export const COUNTRY_DEFAULT = 'IN';

/** Guest carts survive a month; abandoned-cart cleanup runs against this. */
export const GUEST_CART_TTL_DAYS = 30;

/** Reservation window for stock held by an unpaid online order. */
export const STOCK_RESERVATION_TTL_MINUTES = 30;

export const QUEUE_NAMES = {
  NOTIFICATIONS: 'notifications',
  PROVISIONING: 'provisioning',
  IMAGES: 'images',
  REPORTS: 'reports',
  MAINTENANCE: 'maintenance',
} as const;
export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export const JOB_NAMES = {
  SEND_EMAIL: 'send-email',
  SEND_SMS: 'send-sms',
  SEND_PUSH: 'send-push',
  ORDER_PLACED: 'order-placed',
  ORDER_STATUS_CHANGED: 'order-status-changed',
  LOW_STOCK_ALERT: 'low-stock-alert',
  PROVISION_TENANT: 'provision-tenant',
  DEPROVISION_TENANT: 'deprovision-tenant',
  GENERATE_REPORT: 'generate-report',
  PROCESS_IMAGE: 'process-image',
  RELEASE_STALE_RESERVATIONS: 'release-stale-reservations',
  REFRESH_TENANT_STATS: 'refresh-tenant-stats',
  PRUNE_EXPIRED_SESSIONS: 'prune-expired-sessions',
} as const;

/**
 * Cache key builders. Every tenant-scoped key is prefixed with the tenant id —
 * this is the mechanical guarantee against cross-tenant cache bleed.
 */
export const cacheKeys = {
  /** Not tenant-scoped: it is the *lookup* that produces the tenant. */
  domainResolution: (hostname: string) => `domain:${hostname}`,
  tenantMeta: (tenantId: string) => `tenant:${tenantId}:meta`,
  tenantDb: (tenantId: string) => `tenant:${tenantId}:db`,
  entitlements: (tenantId: string) => `tenant:${tenantId}:entitlements`,
  storeSettings: (tenantId: string) => `tenant:${tenantId}:store:settings`,
  categoryTree: (tenantId: string) => `tenant:${tenantId}:categories:tree`,
  brands: (tenantId: string) => `tenant:${tenantId}:brands`,
  featuredProducts: (tenantId: string) => `tenant:${tenantId}:products:featured`,
  popularProducts: (tenantId: string) => `tenant:${tenantId}:products:popular`,
  product: (tenantId: string, slug: string) => `tenant:${tenantId}:product:${slug}`,
  /** Wildcard used for bulk invalidation after a catalog write. */
  tenantPrefix: (tenantId: string) => `tenant:${tenantId}:*`,
  catalogPrefix: (tenantId: string) => `tenant:${tenantId}:product*`,
  membership: (userId: string, tenantId: string) => `member:${userId}:${tenantId}`,
  rateLimit: (bucket: string, identity: string) => `rl:${bucket}:${identity}`,
  idempotency: (tenantId: string, key: string) => `tenant:${tenantId}:idem:${key}`,
} as const;

/** Order-tracking timeline the storefront and mobile app both render. */
export const ORDER_TIMELINE_STEPS = [
  { status: 'PENDING', label: 'Order placed' },
  { status: 'CONFIRMED', label: 'Confirmed' },
  { status: 'PROCESSING', label: 'Packed' },
  { status: 'SHIPPED', label: 'Shipped' },
  { status: 'OUT_FOR_DELIVERY', label: 'Out for delivery' },
  { status: 'DELIVERED', label: 'Delivered' },
] as const;

export const BUSINESS_CATEGORIES = [
  'Footwear',
  'Menswear',
  'Womenswear',
  'Kidswear',
  'Fancy Store',
  'Mobile Shop',
  'Electronics',
  'Cosmetics',
  'Grocery',
  'Stationery',
  'Sports',
  'Home & Kitchen',
  'General Retail',
] as const;

export const INDIAN_STATES = [
  'Andhra Pradesh',
  'Arunachal Pradesh',
  'Assam',
  'Bihar',
  'Chhattisgarh',
  'Delhi',
  'Goa',
  'Gujarat',
  'Haryana',
  'Himachal Pradesh',
  'Jharkhand',
  'Karnataka',
  'Kerala',
  'Madhya Pradesh',
  'Maharashtra',
  'Manipur',
  'Meghalaya',
  'Mizoram',
  'Nagaland',
  'Odisha',
  'Puducherry',
  'Punjab',
  'Rajasthan',
  'Sikkim',
  'Tamil Nadu',
  'Telangana',
  'Tripura',
  'Uttar Pradesh',
  'Uttarakhand',
  'West Bengal',
] as const;
