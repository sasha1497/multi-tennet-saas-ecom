import { Injectable } from '@nestjs/common';
import type { TenantPrismaClient } from '@retailos/database';
import { RequestContextService } from '@/core/context/request-context';
import { TenantConnectionManager } from './tenant-connection.manager';

/**
 * The tenant-aware database accessor every business service depends on.
 *
 * Services never take a tenant id as a parameter and never construct a client.
 * They call `tenantDb.run(db => ...)` and the tenant comes from the
 * AsyncLocalStorage context that the tenant middleware/guard established from
 * the request Host or a verified token claim.
 *
 * That is the crux of the isolation model: **there is no code path where a
 * service can be talked into using another tenant's database**, because the
 * tenant id is never an argument a caller controls.
 */
@Injectable()
export class TenantDatabaseService {
  constructor(
    private readonly context: RequestContextService,
    private readonly connections: TenantConnectionManager,
  ) {}

  /** Tenant id for the current request. Throws if no tenant is in context. */
  get tenantId(): string {
    return this.context.requireTenantId();
  }

  get tenantSlug(): string {
    return this.context.requireTenant().slug;
  }

  /** Runs a unit of work against the current request's tenant database. */
  async run<T>(fn: (db: TenantPrismaClient) => Promise<T>): Promise<T> {
    return this.connections.run(this.tenantId, fn);
  }

  /**
   * Runs against an explicitly named tenant.
   *
   * Reserved for callers that legitimately have no request context — queue
   * workers, the migration runner, the seeder and cron jobs. Application
   * request handlers must use `run()` so the tenant can only come from the
   * verified context.
   */
  async runFor<T>(tenantId: string, fn: (db: TenantPrismaClient) => Promise<T>): Promise<T> {
    return this.connections.run(tenantId, fn);
  }

  /**
   * Interactive transaction against the current tenant.
   *
   * `timeout` is generous by default because order placement does stock
   * reservation, order creation and coupon redemption in one transaction.
   */
  async transaction<T>(
    fn: (tx: TenantTransactionClient) => Promise<T>,
    options: { timeout?: number; maxWait?: number; isolationLevel?: 'ReadCommitted' | 'Serializable' } = {},
  ): Promise<T> {
    return this.run((db) =>
      db.$transaction(fn, {
        timeout: options.timeout ?? 15_000,
        maxWait: options.maxWait ?? 5_000,
        isolationLevel: options.isolationLevel ?? 'ReadCommitted',
      }),
    );
  }

  async transactionFor<T>(
    tenantId: string,
    fn: (tx: TenantTransactionClient) => Promise<T>,
    options: { timeout?: number; maxWait?: number } = {},
  ): Promise<T> {
    return this.runFor(tenantId, (db) =>
      db.$transaction(fn, {
        timeout: options.timeout ?? 15_000,
        maxWait: options.maxWait ?? 5_000,
      }),
    );
  }

  /** Evicts the pooled client — call after DDL or a status change. */
  async evict(tenantId: string): Promise<void> {
    await this.connections.evict(tenantId);
  }
}

/** The client shape inside `$transaction` (no nested transactions or $connect). */
export type TenantTransactionClient = Omit<
  TenantPrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;
