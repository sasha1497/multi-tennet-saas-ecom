import { Role, TokenAudience, UserType } from './enums';

/**
 * Claims carried by an access token.
 *
 * `tid` is the ONLY place a client-supplied tenant hint is trusted, and only
 * because the token is signed by us and `TenantGuard` re-verifies the
 * membership against the master DB on every request.
 */
export interface AccessTokenClaims {
  /** Subject — platform user id (admin audience) or customer id (customer audience). */
  sub: string;
  /** Token audience; guards refuse a customer token on merchant routes and vice versa. */
  aud: TokenAudience;
  /** Tenant the token is scoped to. Null only for platform super-admin tokens. */
  tid: string | null;
  /** Role held *within* `tid` (or SUPER_ADMIN at platform scope). */
  role: Role;
  /** Effective permission list, precomputed at mint time for fast guard checks. */
  perms: string[];
  /** Session id — lets us revoke a single device. */
  sid: string;
  email?: string;
  iat?: number;
  exp?: number;
  iss?: string;
}

export interface RefreshTokenClaims {
  sub: string;
  aud: TokenAudience;
  tid: string | null;
  sid: string;
  /** Rotation counter — a replayed older token trips reuse detection. */
  ver: number;
  iat?: number;
  exp?: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  /** Access-token lifetime in seconds. */
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface PlatformUserProfile {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string | null;
  userType: UserType;
  isSuperAdmin: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
}

export interface TenantMembershipSummary {
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  tenantStatus: string;
  storefrontUrl: string;
  logoUrl: string | null;
  role: Role;
  permissions: string[];
  isDefault: boolean;
}

/** Response of `GET /auth/me` for the merchant/platform console. */
export interface AdminSessionResponse {
  user: PlatformUserProfile;
  memberships: TenantMembershipSummary[];
  activeTenantId: string | null;
  permissions: string[];
  role: Role;
}

export interface CustomerProfile {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  fullName: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  createdAt: string;
}

/** Response of `GET /auth/me` on a storefront/mobile session. */
export interface CustomerSessionResponse {
  customer: CustomerProfile;
  tenantId: string;
  tenantSlug: string;
}

// ---------------------------------------------------------------- requests --

export interface LoginRequest {
  email: string;
  password: string;
  /** Optional: log straight into a specific tenant console. */
  tenantSlug?: string;
}

export interface CustomerLoginRequest {
  /** Either email or phone plus password. */
  identifier: string;
  password: string;
}

export interface RegisterMerchantRequest {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  password: string;
  storeName: string;
  /** Desired subdomain; the API normalises + guarantees uniqueness. */
  storeSlug?: string;
  businessCategory?: string;
  planCode?: string;
}

export interface RegisterMerchantResponse {
  user: PlatformUserProfile;
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
    storefrontUrl: string;
  };
  provisioningJobId: string;
  tokens: AuthTokens;
}

export interface RegisterCustomerRequest {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  password: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface ChangePasswordRequest {
  currentPassword: string;
  newPassword: string;
}

export interface SlugAvailabilityResponse {
  slug: string;
  available: boolean;
  suggestion?: string;
  storefrontUrl: string;
}
