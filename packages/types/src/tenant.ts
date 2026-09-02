import { DomainType, FeatureKey, PlanCode, SubscriptionStatus, TenantStatus } from './enums';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  businessCategory: string | null;
  contactEmail: string;
  contactPhone: string | null;
  ownerUserId: string;
  primaryDomain: string | null;
  storefrontUrl: string;
  createdAt: string;
  updatedAt: string;
  activatedAt: string | null;
  suspendedAt: string | null;
  suspensionReason: string | null;
}

export interface TenantDomain {
  id: string;
  tenantId: string;
  hostname: string;
  type: DomainType;
  isPrimary: boolean;
  isVerified: boolean;
  createdAt: string;
}

/**
 * Placement metadata for a tenant's database.
 *
 * NOTE: credentials are NEVER included in any API response — the master table
 * stores an AES-256-GCM ciphertext and the API only ever hands out this
 * redacted view.
 */
export interface TenantDatabaseInfo {
  id: string;
  tenantId: string;
  clusterId: string;
  host: string;
  port: number;
  databaseName: string;
  username: string;
  schemaVersion: string | null;
  status: string;
  lastMigratedAt: string | null;
  createdAt: string;
}

export interface Plan {
  id: string;
  code: PlanCode | string;
  name: string;
  description: string | null;
  /** Minor units (paise) per billing period. */
  priceMonthly: number;
  priceYearly: number;
  currency: string;
  trialDays: number;
  isActive: boolean;
  isPublic: boolean;
  sortOrder: number;
  features: Record<string, boolean>;
  limits: Record<string, number>;
}

export interface Subscription {
  id: string;
  tenantId: string;
  planId: string;
  plan?: Plan;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
}

export interface FeatureEntitlement {
  id: string;
  tenantId: string;
  featureKey: FeatureKey | string;
  enabled: boolean;
  limitValue: number | null;
  source: 'PLAN' | 'OVERRIDE';
  expiresAt: string | null;
}

/** Flattened entitlement view the frontends use to show/hide navigation. */
export interface TenantEntitlements {
  features: Record<string, boolean>;
  limits: Record<string, number>;
  planCode: string;
  planName: string;
  subscriptionStatus: SubscriptionStatus;
}

export interface ProvisioningJob {
  id: string;
  tenantId: string;
  status: string;
  currentStep: string | null;
  completedSteps: string[];
  attempts: number;
  lastError: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}

/** What `GET /tenants/current` returns to the merchant console. */
export interface CurrentTenantResponse {
  tenant: Tenant;
  entitlements: TenantEntitlements;
  subscription: Subscription | null;
  domains: TenantDomain[];
}
