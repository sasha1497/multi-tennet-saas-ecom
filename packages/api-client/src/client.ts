import { HttpClient, HttpClientConfig } from './http';
import { AuthResource } from './resources/auth';
import { MerchantResource } from './resources/merchant';
import { PlatformResource } from './resources/platform';
import { StorefrontResource } from './resources/storefront';

/**
 * The single typed API surface shared by storefront-web, merchant-web and the
 * mobile app. Business logic lives in the API; this is only transport + types.
 */
export class RetailOSClient {
  readonly http: HttpClient;
  readonly auth: AuthResource;
  readonly storefront: StorefrontResource;
  readonly merchant: MerchantResource;
  readonly platform: PlatformResource;

  constructor(config: HttpClientConfig) {
    this.http = new HttpClient(config);
    this.auth = new AuthResource(this.http);
    this.storefront = new StorefrontResource(this.http);
    this.merchant = new MerchantResource(this.http);
    this.platform = new PlatformResource(this.http);
  }
}

export function createClient(config: HttpClientConfig): RetailOSClient {
  return new RetailOSClient(config);
}
