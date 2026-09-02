import type {
  AdminSessionResponse,
  AuthTokens,
  ChangePasswordRequest,
  CustomerLoginRequest,
  CustomerProfile,
  CustomerSessionResponse,
  LoginRequest,
  RegisterCustomerRequest,
  RegisterMerchantRequest,
  RegisterMerchantResponse,
  SlugAvailabilityResponse,
} from '@retailos/types';
import type { HttpClient } from '../http';

/** Auth endpoints. Merchant/platform and customer identities are separate audiences. */
export class AuthResource {
  constructor(private readonly http: HttpClient) {}

  // ------------------------------------------------- merchant / platform --

  /** Merchant self-signup: creates the user, the tenant and kicks off provisioning. */
  registerMerchant(body: RegisterMerchantRequest): Promise<RegisterMerchantResponse> {
    return this.http.post('/auth/register', body, { anonymous: true });
  }

  login(body: LoginRequest): Promise<{ tokens: AuthTokens; session: AdminSessionResponse }> {
    return this.http.post('/auth/login', body, { anonymous: true });
  }

  me(): Promise<AdminSessionResponse> {
    return this.http.get('/auth/me');
  }

  /** Re-mints an access token scoped to a different tenant the user belongs to. */
  switchTenant(tenantId: string): Promise<{ tokens: AuthTokens; session: AdminSessionResponse }> {
    return this.http.post('/auth/switch-tenant', { tenantId });
  }

  checkSlug(slug: string): Promise<SlugAvailabilityResponse> {
    return this.http.get('/auth/check-slug', { query: { slug }, anonymous: true });
  }

  // ------------------------------------------------------------ customer --

  registerCustomer(
    body: RegisterCustomerRequest,
  ): Promise<{ tokens: AuthTokens; customer: CustomerProfile }> {
    return this.http.post('/auth/customer/register', body, { anonymous: true });
  }

  customerLogin(
    body: CustomerLoginRequest,
  ): Promise<{ tokens: AuthTokens; customer: CustomerProfile }> {
    return this.http.post('/auth/customer/login', body, { anonymous: true });
  }

  customerMe(): Promise<CustomerSessionResponse> {
    return this.http.get('/auth/customer/me');
  }

  // -------------------------------------------------------------- shared --

  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.http.post('/auth/refresh', { refreshToken }, { anonymous: true });
  }

  logout(): Promise<void> {
    return this.http.post('/auth/logout');
  }

  changePassword(body: ChangePasswordRequest): Promise<void> {
    return this.http.post('/auth/change-password', body);
  }
}
