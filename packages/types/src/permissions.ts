/**
 * RBAC permission catalogue.
 *
 * Permissions are `resource.action` strings. Roles map to permission sets;
 * a membership may additionally carry explicit extra permissions, so a merchant
 * can hand one staff member a capability without promoting their whole role.
 */
import { Role } from './enums';

export const Permission = {
  // Catalog
  PRODUCTS_READ: 'products.read',
  PRODUCTS_CREATE: 'products.create',
  PRODUCTS_UPDATE: 'products.update',
  PRODUCTS_DELETE: 'products.delete',
  CATEGORIES_READ: 'categories.read',
  CATEGORIES_MANAGE: 'categories.manage',
  BRANDS_READ: 'brands.read',
  BRANDS_MANAGE: 'brands.manage',

  // Inventory
  INVENTORY_READ: 'inventory.read',
  INVENTORY_UPDATE: 'inventory.update',

  // Orders
  ORDERS_READ: 'orders.read',
  ORDERS_UPDATE: 'orders.update',
  ORDERS_CANCEL: 'orders.cancel',
  ORDERS_REFUND: 'orders.refund',

  // Customers
  CUSTOMERS_READ: 'customers.read',
  CUSTOMERS_UPDATE: 'customers.update',

  // Marketing
  COUPONS_READ: 'coupons.read',
  COUPONS_MANAGE: 'coupons.manage',

  // Reviews
  REVIEWS_READ: 'reviews.read',
  REVIEWS_MODERATE: 'reviews.moderate',

  // Reports
  REPORTS_READ: 'reports.read',

  // Store configuration
  STORE_MANAGE: 'store.manage',
  STORE_DESIGN: 'store.design',

  // Staff / RBAC
  STAFF_READ: 'staff.read',
  STAFF_MANAGE: 'staff.manage',

  // Billing
  SUBSCRIPTION_READ: 'subscription.read',
  SUBSCRIPTION_MANAGE: 'subscription.manage',

  // Files
  FILES_UPLOAD: 'files.upload',

  // Platform-only
  PLATFORM_TENANTS_READ: 'platform.tenants.read',
  PLATFORM_TENANTS_MANAGE: 'platform.tenants.manage',
  PLATFORM_PLANS_MANAGE: 'platform.plans.manage',
  PLATFORM_USERS_MANAGE: 'platform.users.manage',
  PLATFORM_AUDIT_READ: 'platform.audit.read',
  PLATFORM_SYSTEM_READ: 'platform.system.read',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);

const MERCHANT_TENANT_PERMISSIONS: readonly Permission[] = [
  Permission.PRODUCTS_READ,
  Permission.PRODUCTS_CREATE,
  Permission.PRODUCTS_UPDATE,
  Permission.PRODUCTS_DELETE,
  Permission.CATEGORIES_READ,
  Permission.CATEGORIES_MANAGE,
  Permission.BRANDS_READ,
  Permission.BRANDS_MANAGE,
  Permission.INVENTORY_READ,
  Permission.INVENTORY_UPDATE,
  Permission.ORDERS_READ,
  Permission.ORDERS_UPDATE,
  Permission.ORDERS_CANCEL,
  Permission.ORDERS_REFUND,
  Permission.CUSTOMERS_READ,
  Permission.CUSTOMERS_UPDATE,
  Permission.COUPONS_READ,
  Permission.COUPONS_MANAGE,
  Permission.REVIEWS_READ,
  Permission.REVIEWS_MODERATE,
  Permission.REPORTS_READ,
  Permission.STORE_MANAGE,
  Permission.STORE_DESIGN,
  Permission.STAFF_READ,
  Permission.STAFF_MANAGE,
  Permission.SUBSCRIPTION_READ,
  Permission.SUBSCRIPTION_MANAGE,
  Permission.FILES_UPLOAD,
];

/**
 * Default permission set per role.
 *
 * SUPER_ADMIN is deliberately the only role holding `platform.*`. Note that
 * holding a platform permission still does not bypass tenant resolution — a
 * super admin acting on tenant data does so through an explicit, audited
 * impersonation path (see docs/AUTHENTICATION.md).
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  SUPER_ADMIN: ALL_PERMISSIONS,

  OWNER: MERCHANT_TENANT_PERMISSIONS,

  MANAGER: [
    Permission.PRODUCTS_READ,
    Permission.PRODUCTS_CREATE,
    Permission.PRODUCTS_UPDATE,
    Permission.CATEGORIES_READ,
    Permission.CATEGORIES_MANAGE,
    Permission.BRANDS_READ,
    Permission.BRANDS_MANAGE,
    Permission.INVENTORY_READ,
    Permission.INVENTORY_UPDATE,
    Permission.ORDERS_READ,
    Permission.ORDERS_UPDATE,
    Permission.ORDERS_CANCEL,
    Permission.CUSTOMERS_READ,
    Permission.CUSTOMERS_UPDATE,
    Permission.COUPONS_READ,
    Permission.COUPONS_MANAGE,
    Permission.REVIEWS_READ,
    Permission.REVIEWS_MODERATE,
    Permission.REPORTS_READ,
    Permission.STORE_DESIGN,
    Permission.STAFF_READ,
    Permission.FILES_UPLOAD,
  ],

  STAFF: [
    Permission.PRODUCTS_READ,
    Permission.CATEGORIES_READ,
    Permission.BRANDS_READ,
    Permission.INVENTORY_READ,
    Permission.INVENTORY_UPDATE,
    Permission.ORDERS_READ,
    Permission.ORDERS_UPDATE,
    Permission.CUSTOMERS_READ,
    Permission.FILES_UPLOAD,
  ],

  /** Shoppers hold no console permissions at all; their access is route-based. */
  CUSTOMER: [],
};

/** Roles a merchant may assign to their own staff (never OWNER or SUPER_ADMIN). */
export const ASSIGNABLE_STAFF_ROLES: readonly Role[] = [Role.MANAGER, Role.STAFF];

export function permissionsForRole(role: Role, extra: readonly string[] = []): Permission[] {
  const base = ROLE_PERMISSIONS[role] ?? [];
  const merged = new Set<string>([...base, ...extra]);
  return Array.from(merged) as Permission[];
}

export function hasPermission(
  granted: readonly string[],
  required: Permission | readonly Permission[],
): boolean {
  const list = Array.isArray(required) ? required : [required as Permission];
  return list.every((p) => granted.includes(p));
}

export function hasAnyPermission(
  granted: readonly string[],
  required: readonly Permission[],
): boolean {
  return required.some((p) => granted.includes(p));
}

/** Human labels for the merchant console's role/permission editor. */
export const PERMISSION_GROUPS: { label: string; permissions: Permission[] }[] = [
  {
    label: 'Catalog',
    permissions: [
      Permission.PRODUCTS_READ,
      Permission.PRODUCTS_CREATE,
      Permission.PRODUCTS_UPDATE,
      Permission.PRODUCTS_DELETE,
      Permission.CATEGORIES_READ,
      Permission.CATEGORIES_MANAGE,
      Permission.BRANDS_READ,
      Permission.BRANDS_MANAGE,
    ],
  },
  {
    label: 'Inventory',
    permissions: [Permission.INVENTORY_READ, Permission.INVENTORY_UPDATE],
  },
  {
    label: 'Orders',
    permissions: [
      Permission.ORDERS_READ,
      Permission.ORDERS_UPDATE,
      Permission.ORDERS_CANCEL,
      Permission.ORDERS_REFUND,
    ],
  },
  {
    label: 'Customers',
    permissions: [Permission.CUSTOMERS_READ, Permission.CUSTOMERS_UPDATE],
  },
  {
    label: 'Marketing',
    permissions: [Permission.COUPONS_READ, Permission.COUPONS_MANAGE],
  },
  {
    label: 'Store',
    permissions: [Permission.STORE_MANAGE, Permission.STORE_DESIGN, Permission.REPORTS_READ],
  },
  {
    label: 'Team',
    permissions: [Permission.STAFF_READ, Permission.STAFF_MANAGE],
  },
];
