import { Injectable } from '@nestjs/common';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import { AppLogger } from '@/core/logger/logger.service';

/**
 * Razorpay Partner OAuth, as documented for Technology Partners:
 * https://razorpay.com/docs/partners/technology-partners/onboard-businesses/integrate-oauth/integration-steps/
 *
 *   GET  {auth}/authorize   client_id, response_type=code, redirect_uri, scope, state
 *   POST {auth}/token       grant_type=authorization_code | refresh_token
 *   POST {auth}/revoke      token, token_type_hint
 *
 * A store's merchant authorises retailos on Razorpay's own page; Razorpay
 * redirects back with a `code`, which is exchanged here for an access token
 * (90 days), a refresh token (180 days), a `public_token` for Checkout and the
 * merchant's `razorpay_account_id`. Payments are then created with the store's
 * access token, so they belong to — and settle to — the store's own account.
 *
 * Pure HTTP. Persistence and tenant scoping live in `PaymentConfigService`.
 */
export interface RazorpayTokenSet {
  accessToken: string;
  refreshToken: string;
  publicToken: string;
  accountId: string;
  accessTokenExpiresAt: Date;
  /** Documented as 180 days from issue. */
  refreshTokenExpiresAt: Date;
}

const REFRESH_TOKEN_TTL_MS = 180 * 86_400_000;

@Injectable()
export class RazorpayOAuthClient {
  private readonly logger: AppLogger;

  constructor(
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('RazorpayOAuth');
  }

  /** Whether this deployment has an OAuth app to connect stores with. */
  get configured(): boolean {
    const o = this.config.payments.razorpay.oauth;
    return Boolean(o.clientId && o.clientSecret && o.redirectUri);
  }

  /** The app's client secret: what Razorpay signs connected stores' Checkout callbacks with. */
  get clientSecret(): string | null {
    return this.config.payments.razorpay.oauth.clientSecret ?? null;
  }

  /** The secret of the webhook configured on the OAuth app. */
  get webhookSecret(): string | null {
    return this.config.payments.razorpay.oauth.webhookSecret ?? null;
  }

  authorizeUrl(state: string): string {
    const o = this.requireApp();
    const url = new URL(`${this.config.payments.razorpay.authBase}/authorize`);
    url.searchParams.set('client_id', o.clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', o.redirectUri);
    // read_write: create orders and refunds on the store's account. Nothing
    // from RazorpayX (payouts) is requested — retailos never moves the money.
    url.searchParams.set('scope', 'read_write');
    url.searchParams.set('state', state);
    return url.toString();
  }

  exchangeCode(code: string): Promise<RazorpayTokenSet> {
    const o = this.requireApp();
    return this.tokenRequest({
      grant_type: 'authorization_code',
      code,
      redirect_uri: o.redirectUri,
    });
  }

  refresh(refreshToken: string): Promise<RazorpayTokenSet> {
    return this.tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  /** Best effort: the connection is removed locally whatever Razorpay answers. */
  async revoke(accessToken: string): Promise<void> {
    const o = this.requireApp();
    try {
      const res = await fetch(`${this.config.payments.razorpay.authBase}/revoke`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: o.clientId,
          client_secret: o.clientSecret,
          token_type_hint: 'access_token',
          token: accessToken,
        }),
      });
      if (!res.ok) this.logger.warn('Razorpay token revoke was not accepted', { status: res.status });
    } catch (err) {
      this.logger.warn('Razorpay token revoke failed', { error: (err as Error).message });
    }
  }

  private async tokenRequest(grant: Record<string, string>): Promise<RazorpayTokenSet> {
    const o = this.requireApp();
    let res: Response;
    try {
      res = await fetch(`${this.config.payments.razorpay.authBase}/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: o.clientId,
          client_secret: o.clientSecret,
          mode: this.config.payments.razorpay.oauth.mode,
          ...grant,
        }),
      });
    } catch (err) {
      this.logger.error('Razorpay token endpoint unreachable', err as Error);
      throw Errors.serviceUnavailable('Razorpay could not be reached. Please try again.');
    }

    if (!res.ok) {
      // The body can carry token fragments on some errors; log status only.
      this.logger.warn('Razorpay token request rejected', {
        status: res.status,
        grant: grant.grant_type,
      });
      throw Errors.badRequest('Razorpay did not accept the connection. Please try connecting again.');
    }

    const body = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      public_token?: string;
      razorpay_account_id?: string;
      expires_in?: number;
    };
    if (!body.access_token || !body.refresh_token || !body.public_token || !body.razorpay_account_id) {
      throw Errors.serviceUnavailable('Razorpay returned an incomplete connection. Please try again.');
    }

    const now = Date.now();
    return {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      publicToken: body.public_token,
      accountId: body.razorpay_account_id,
      accessTokenExpiresAt: new Date(now + (body.expires_in ?? 90 * 86_400) * 1000),
      refreshTokenExpiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    };
  }

  private requireApp(): { clientId: string; clientSecret: string; redirectUri: string } {
    const o = this.config.payments.razorpay.oauth;
    if (!o.clientId || !o.clientSecret || !o.redirectUri) {
      throw Errors.badRequest('Connecting Razorpay is not available on this deployment yet.');
    }
    return { clientId: o.clientId, clientSecret: o.clientSecret, redirectUri: o.redirectUri };
  }
}
