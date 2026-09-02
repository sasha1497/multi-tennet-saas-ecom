import { Money, PaginationQuery } from './common';
import { AuditAction, TenantStatus } from './enums';
import { Tenant, TenantDatabaseInfo } from './tenant';

export interface PlatformTenantListItem {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  ownerName: string;
  ownerEmail: string;
  planCode: string;
  primaryDomain: string | null;
  /** Cheap counters kept on the master record; refreshed by a periodic job. */
  productCount: number;
  orderCount: number;
  monthlyRevenue: Money;
  databaseStatus: string;
  createdAt: string;
  activatedAt: string | null;
}

export interface PlatformTenantDetail {
  tenant: Tenant;
  database: TenantDatabaseInfo;
  owner: { id: string; email: string; fullName: string; phone: string | null };
  members: { userId: string; email: string; fullName: string; role: string }[];
  subscription: import('./tenant').Subscription | null;
  entitlements: import('./tenant').TenantEntitlements;
  provisioningJobs: import('./tenant').ProvisioningJob[];
  stats: {
    products: number;
    orders: number;
    customers: number;
    revenue: Money;
  };
}

export interface CreateTenantRequest {
  name: string;
  slug?: string;
  ownerEmail: string;
  ownerFirstName: string;
  ownerLastName: string;
  ownerPhone?: string;
  /** Omit to auto-generate and email an invite. */
  ownerPassword?: string;
  businessCategory?: string;
  planCode?: string;
}

export interface UpdateTenantStatusRequest {
  status: TenantStatus;
  reason?: string;
}

export interface PlatformTenantQuery extends PaginationQuery {
  status?: TenantStatus;
  planCode?: string;
}

export interface AuditLogEntry {
  id: string;
  tenantId: string | null;
  tenantSlug: string | null;
  userId: string | null;
  userEmail: string | null;
  action: AuditAction | string;
  resourceType: string | null;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface AuditLogQuery extends PaginationQuery {
  tenantId?: string;
  userId?: string;
  action?: string;
  resourceType?: string;
  dateFrom?: string;
  dateTo?: string;
}

export interface PlatformOverview {
  tenants: {
    total: number;
    active: number;
    provisioning: number;
    suspended: number;
    newThisMonth: number;
  };
  revenue: {
    /** Aggregate GMV across all tenants this month, minor units. */
    gmvThisMonth: Money;
    gmvLastMonth: Money;
    ordersThisMonth: number;
  };
  system: {
    masterDb: 'ok' | 'error';
    redis: 'ok' | 'error';
    queues: 'ok' | 'degraded' | 'error';
    tenantDbsHealthy: number;
    tenantDbsTotal: number;
  };
  provisioning: {
    pending: number;
    running: number;
    failed24h: number;
  };
  recentTenants: PlatformTenantListItem[];
}

export interface SystemHealthDetail {
  service: string;
  status: 'ok' | 'degraded' | 'error';
  latencyMs: number | null;
  message: string | null;
  checkedAt: string;
}

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: boolean;
}
