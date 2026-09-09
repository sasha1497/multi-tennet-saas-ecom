import type {
  AuditLogEntry,
  AuditLogQuery,
  CreateTenantRequest,
  HealthStatus,
  PaginatedResult,
  Plan,
  PlatformOverview,
  PlatformTenantDetail,
  PlatformTenantListItem,
  PlatformTenantQuery,
  ProvisioningJob,
  QueueStats,
  Subscription,
  SystemHealthDetail,
  TenantDeletionResult,
  TenantStatus,
} from '@retailos/types';
import type { HttpClient } from '../http';

/** Super-admin control plane. Every route requires `platform.*` permissions. */
export class PlatformResource {
  constructor(private readonly http: HttpClient) {}

  overview(): Promise<PlatformOverview> {
    return this.http.get('/platform/overview');
  }

  tenants(query: PlatformTenantQuery = {}): Promise<PaginatedResult<PlatformTenantListItem>> {
    return this.http.get('/platform/tenants', { query: query as Record<string, unknown> });
  }

  tenant(id: string): Promise<PlatformTenantDetail> {
    return this.http.get(`/platform/tenants/${id}`);
  }

  createTenant(body: CreateTenantRequest): Promise<{
    tenant: PlatformTenantListItem;
    provisioningJobId: string;
    temporaryPassword?: string;
  }> {
    return this.http.post('/platform/tenants', body);
  }

  updateTenantStatus(
    id: string,
    status: TenantStatus,
    reason?: string,
  ): Promise<PlatformTenantListItem> {
    return this.http.post(`/platform/tenants/${id}/status`, { status, reason });
  }

  /**
   * Permanently deletes a store, its database and its files.
   *
   * `confirmation` must be the store's slug; the server checks it against the
   * tenant it loaded, so a wrong id cannot be confirmed by a right name.
   *
   * Resumable rather than transactional — deletion spans three systems that
   * cannot share a transaction. A `FAILED` result names the step that failed;
   * calling this again continues from there. Calling it after `COMPLETED`
   * returns the original outcome and deletes nothing further.
   */
  deleteTenant(id: string, confirmation: string): Promise<TenantDeletionResult> {
    return this.http.delete(`/platform/tenants/${id}`, { confirmation });
  }

  /** Deletion history, including for tenants that no longer exist. */
  tenantDeletionJobs(id: string): Promise<TenantDeletionResult[]> {
    return this.http.get(`/platform/tenants/${id}/deletion-jobs`);
  }

  /** Idempotent: re-running on an already-provisioned tenant is a no-op. */
  provisionTenant(id: string): Promise<ProvisioningJob> {
    return this.http.post(`/platform/tenants/${id}/provision`, {});
  }

  provisioningJobs(id: string): Promise<ProvisioningJob[]> {
    return this.http.get(`/platform/tenants/${id}/provisioning-jobs`);
  }

  /** Applies the newest tenant migrations to one tenant database. */
  migrateTenant(id: string): Promise<{ applied: string[]; schemaVersion: string }> {
    return this.http.post(`/platform/tenants/${id}/migrate`, {});
  }

  setEntitlement(
    id: string,
    body: { featureKey: string; enabled: boolean; limitValue?: number | null },
  ): Promise<void> {
    return this.http.post(`/platform/tenants/${id}/entitlements`, body);
  }

  changeSubscription(id: string, planCode: string): Promise<Subscription> {
    return this.http.post(`/platform/tenants/${id}/subscription`, { planCode });
  }

  // --------------------------------------------------------------- plans --

  plans(): Promise<Plan[]> {
    return this.http.get('/platform/plans');
  }
  createPlan(body: Partial<Plan> & { code: string; name: string }): Promise<Plan> {
    return this.http.post('/platform/plans', body);
  }
  updatePlan(id: string, body: Partial<Plan>): Promise<Plan> {
    return this.http.patch(`/platform/plans/${id}`, body);
  }
  deletePlan(id: string): Promise<void> {
    return this.http.delete(`/platform/plans/${id}`);
  }

  // ---------------------------------------------------------------- ops --

  auditLogs(query: AuditLogQuery = {}): Promise<PaginatedResult<AuditLogEntry>> {
    return this.http.get('/platform/audit-logs', { query: query as Record<string, unknown> });
  }

  systemHealth(): Promise<SystemHealthDetail[]> {
    return this.http.get('/platform/system/health');
  }

  queues(): Promise<QueueStats[]> {
    return this.http.get('/platform/system/queues');
  }

  /** Unauthenticated liveness/readiness probe. */
  health(): Promise<HealthStatus> {
    return this.http.get('/health', { anonymous: true, raw: true });
  }
}
