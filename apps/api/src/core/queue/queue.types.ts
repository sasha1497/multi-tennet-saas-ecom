import type { NotificationChannel, NotificationTemplate, OrderStatus } from '@retailos/types';

/**
 * Job payload contracts.
 *
 * Every tenant-scoped job carries `tenantId` explicitly: AsyncLocalStorage does
 * not survive the hop into Redis, so the worker re-establishes tenant context
 * from the payload rather than inheriting it.
 *
 * `requestId` is propagated so a job's logs can be traced back to the HTTP
 * request that queued it.
 */
export interface BaseJobData {
  tenantId?: string;
  requestId?: string;
  enqueuedAt: string;
}

export interface SendEmailJob extends BaseJobData {
  to: string;
  subject: string;
  html: string;
  text?: string;
  template?: NotificationTemplate | string;
  /** Persist an in-app notification row alongside the email. */
  customerId?: string;
}

export interface SendSmsJob extends BaseJobData {
  to: string;
  message: string;
  template?: string;
  customerId?: string;
}

export interface SendPushJob extends BaseJobData {
  customerId: string;
  title: string;
  body: string;
  data?: Record<string, string>;
  actionUrl?: string;
}

export interface NotifyJob extends BaseJobData {
  tenantId: string;
  template: NotificationTemplate | string;
  channels: NotificationChannel[];
  /** Recipient overrides; otherwise resolved from the customer/order. */
  email?: string | null;
  phone?: string | null;
  customerId?: string | null;
  data: Record<string, unknown>;
}

export interface OrderPlacedJob extends BaseJobData {
  tenantId: string;
  orderId: string;
}

export interface OrderStatusChangedJob extends BaseJobData {
  tenantId: string;
  orderId: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
}

export interface LowStockAlertJob extends BaseJobData {
  tenantId: string;
  variantIds: string[];
}

export interface ProvisionTenantJob extends BaseJobData {
  tenantId: string;
  jobId: string;
  /** Deterministic key; a retry with the same key resumes rather than duplicates. */
  idempotencyKey: string;
}

export interface DeprovisionTenantJob extends BaseJobData {
  tenantId: string;
  /** Explicit confirmation, so a stray message can never drop a database. */
  confirm: 'DELETE_TENANT_DATA';
}

export interface GenerateReportJob extends BaseJobData {
  tenantId: string;
  reportType: 'sales' | 'inventory' | 'customers';
  dateFrom: string;
  dateTo: string;
  requestedBy: string;
}

export interface ProcessImageJob extends BaseJobData {
  tenantId: string;
  key: string;
  /** Sizes to derive, in pixels on the long edge. */
  sizes: number[];
}

export interface MaintenanceJob extends BaseJobData {
  task:
    | 'release-stale-reservations'
    | 'refresh-tenant-stats'
    | 'prune-expired-sessions'
    | 'prune-expired-carts';
}

export type AnyJobData =
  | SendEmailJob
  | SendSmsJob
  | SendPushJob
  | NotifyJob
  | OrderPlacedJob
  | OrderStatusChangedJob
  | LowStockAlertJob
  | ProvisionTenantJob
  | DeprovisionTenantJob
  | GenerateReportJob
  | ProcessImageJob
  | MaintenanceJob;
