import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import { CacheService } from '@/core/cache/cache.service';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { AppLogger } from '@/core/logger/logger.service';
import { CredentialCipherService } from '@/core/security/credential-cipher.service';
import { RazorpayOAuthClient } from './razorpay-oauth.client';

/** How a store is connected to its gateway. */
export type ConnectionType = 'keys' | 'oauth' | 'platform';

/** Where a store stands with online payments. Safe to show the merchant. */
export type OnboardingStatus = 'NOT_CONNECTED' | 'CONNECTED' | 'ACTION_REQUIRED' | 'REVOKED';

/**
 * Decrypted gateway credentials for ONE tenant.
 *
 * Only ever held on the stack for the duration of a call. Never cached, never
 * logged, never returned from a controller.
 */
export interface PaymentCredentials {
  provider: string;
  environment: 'test' | 'live';
  /** The key Checkout is opened with: a key id, or an OAuth `public_token`. */
  publicKey: string | null;
  /** Merchant API secret — manual-key connections only. */
  secretKey: string | null;
  webhookSecret: string | null;
  currency: string;
  /**
   * How server-to-gateway calls authenticate.
   *  • basic  — the merchant's own key id + secret (manual keys)
   *  • bearer — the store's OAuth access token (Partner OAuth)
   */
  auth:
    | { scheme: 'basic'; keyId: string; keySecret: string }
    | { scheme: 'bearer'; accessToken: string }
    | null;
  /** What Checkout callbacks are signed with: the key secret, or the OAuth app's client secret. */
  signatureSecret: string | null;
  connectionType: ConnectionType;
  /** The merchant's gateway account id (Razorpay `acc_…`), when known. */
  accountId: string | null;
}

/**
 * What a client is allowed to know about a store's payment setup.
 *
 * This is the ONLY shape that may leave the API. It is a separate type rather
 * than a hand-pruned object so that adding a secret to `PaymentCredentials`
 * cannot accidentally widen a response.
 */
export interface PublicPaymentConfig {
  provider: string;
  enabled: boolean;
  environment: 'test' | 'live';
  publicKey: string | null;
  currency: string;
  /** Whether the merchant has finished configuring it — not the value itself. */
  configured: boolean;
}

/** The merchant's Payments page, in one read. */
export interface PaymentSetupStatus {
  status: OnboardingStatus;
  connectionType: ConnectionType | null;
  provider: string | null;
  environment: 'test' | 'live';
  /** The store's own Razorpay account, so the merchant can recognise it. */
  accountId: string | null;
  connectedAt: string | null;
  /** Online payments will actually be offered at checkout right now. */
  onlinePaymentsAvailable: boolean;
  /** The store's own on/off switch in Store settings. */
  onlinePaymentsSwitchedOn: boolean;
  /** Safe, merchant-readable explanation when something needs doing. */
  reason: string | null;
  /** Whether this deployment can offer "Connect Razorpay" at all. */
  oauthAvailable: boolean;
}

export interface UpsertPaymentConfigInput {
  provider: string;
  enabled: boolean;
  environment: 'test' | 'live';
  publicKey?: string | null;
  /** Plain text on the way in; encrypted before it touches the database. */
  secretKey?: string | null;
  webhookSecret?: string | null;
  currency?: string;
}

/** Refresh an access token this long before Razorpay would expire it. */
const REFRESH_AHEAD_MS = 7 * 86_400_000;
const OAUTH_STATE_TTL_SECONDS = 600;

/**
 * Per-tenant payment gateway configuration.
 *
 * The platform used to hold one set of Razorpay keys for everybody, which meant
 * every merchant's money landed in the same account. Configuration now belongs
 * to the tenant, and the only way to obtain it is to name a tenant that the
 * caller has already been verified against.
 *
 * A store connects in one of two ways, both settling to the store's own
 * Razorpay account:
 *
 *  • **Partner OAuth** (the default): the merchant clicks Connect, approves
 *    retailos on Razorpay's own page, and we hold only revocable OAuth tokens.
 *    No merchant API secret is ever entered or stored.
 *  • **Manual keys** (the original flow, kept as a fallback): the merchant
 *    pastes their own key id and secret, stored encrypted.
 *
 * Two rules make the isolation real rather than nominal:
 *
 *  1. `resolve()` takes a tenant id and reads only that tenant's row. There is
 *     no "current provider" singleton left to borrow, so a request cannot use
 *     another merchant's credentials even by accident.
 *  2. Secrets are decrypted in memory per call and never cached.
 */
@Injectable()
export class PaymentConfigService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly cipher: CredentialCipherService,
    private readonly config: AppConfigService,
    private readonly cache: CacheService,
    private readonly oauth: RazorpayOAuthClient,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('PaymentConfig');
  }

  /**
   * Credentials for a tenant's active gateway.
   *
   * Falls back to the platform-level configuration when the tenant has none of
   * its own. That fallback is what keeps the mock gateway usable in development
   * — but it is refused in production for a real gateway, where a merchant
   * silently settling into the platform's account would be worse than a failed
   * checkout.
   */
  async resolve(tenantId: string): Promise<PaymentCredentials> {
    const row = await this.master.tenantPaymentConfig.findFirst({
      where: { tenantId, enabled: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!row) {
      // A store that has EVER configured its own gateway — and has since
      // disconnected, been revoked or switched it off — must never fall back
      // to the platform's account. Its customers' money is not retailos's.
      if (await this.hasOwnGateway(tenantId)) {
        throw Errors.paymentFailed('Online payment is temporarily unavailable.');
      }
      return this.platformFallback(tenantId);
    }

    if (row.connectionType === 'oauth') {
      if (row.onboardingStatus !== 'CONNECTED') {
        throw Errors.paymentFailed('Online payment is temporarily unavailable.');
      }
      const accessToken = await this.currentAccessToken(row);
      return {
        provider: row.provider,
        environment: row.environment === 'live' ? 'live' : 'test',
        publicKey: row.publicKey,
        secretKey: null,
        webhookSecret: this.oauth.webhookSecret,
        currency: row.currency,
        auth: { scheme: 'bearer', accessToken },
        signatureSecret: this.oauth.clientSecret,
        connectionType: 'oauth',
        accountId: row.providerAccountId,
      };
    }

    const secretKey = row.encryptedSecretKey ? this.cipher.decrypt(row.encryptedSecretKey) : null;
    return {
      provider: row.provider,
      environment: row.environment === 'live' ? 'live' : 'test',
      publicKey: row.publicKey,
      secretKey,
      webhookSecret: row.encryptedWebhookSecret
        ? this.cipher.decrypt(row.encryptedWebhookSecret)
        : null,
      currency: row.currency,
      auth: row.publicKey && secretKey ? { scheme: 'basic', keyId: row.publicKey, keySecret: secretKey } : null,
      signatureSecret: secretKey,
      connectionType: 'keys',
      accountId: row.providerAccountId,
    };
  }

  /**
   * Just enough to *verify* a webhook for a tenant, whatever state its
   * connection is in now.
   *
   * A store that disconnects, or whose token lapses, still has payments and
   * refunds in flight; their webhooks must keep reconciling. Verification
   * needs only the webhook secret and the account id — never a token that can
   * move money — so this does not require the connection to be live.
   */
  async webhookCredentials(tenantId: string): Promise<PaymentCredentials> {
    const row = await this.master.tenantPaymentConfig.findFirst({
      where: { tenantId, provider: { not: 'mock' } },
      orderBy: { updatedAt: 'desc' },
    });
    if (row?.connectionType === 'oauth') {
      return {
        provider: row.provider,
        environment: row.environment === 'live' ? 'live' : 'test',
        publicKey: null,
        secretKey: null,
        webhookSecret: this.oauth.webhookSecret,
        currency: row.currency,
        auth: null,
        signatureSecret: null,
        connectionType: 'oauth',
        accountId: row.providerAccountId,
      };
    }
    if (row) {
      return {
        provider: row.provider,
        environment: row.environment === 'live' ? 'live' : 'test',
        publicKey: null,
        secretKey: null,
        webhookSecret: row.encryptedWebhookSecret ? this.cipher.decrypt(row.encryptedWebhookSecret) : null,
        currency: row.currency,
        auth: null,
        signatureSecret: null,
        connectionType: 'keys',
        accountId: row.providerAccountId,
      };
    }
    return this.resolve(tenantId);
  }

  /** Credentials carrying only the OAuth app's webhook secret — for account-level events. */
  oauthAppWebhookCredentials(): PaymentCredentials {
    return {
      provider: 'razorpay',
      environment: this.config.payments.razorpay.oauth.mode,
      publicKey: null,
      secretKey: null,
      webhookSecret: this.oauth.webhookSecret,
      currency: this.config.payments.currency,
      auth: null,
      signatureSecret: null,
      connectionType: 'oauth',
      accountId: null,
    };
  }

  /**
   * Whether a store can take an online payment right now — the one answer
   * checkout, order placement and the storefront all use.
   *
   * Never throws and never says *why* to a shopper: the reason is for the
   * merchant's Payments page.
   */
  async onlineReady(tenantId: string): Promise<boolean> {
    const row = await this.master.tenantPaymentConfig.findFirst({
      where: { tenantId, enabled: true },
      orderBy: { updatedAt: 'desc' },
      select: { onboardingStatus: true, connectionType: true, provider: true, encryptedSecretKey: true },
    });
    if (row) {
      if (row.connectionType === 'oauth') return row.onboardingStatus === 'CONNECTED';
      return row.provider === 'mock' || Boolean(row.encryptedSecretKey);
    }
    // Platform fallback: development and the mock gateway only, and never for
    // a store that has had a gateway of its own.
    if (await this.hasOwnGateway(tenantId)) return false;
    return this.platformFallback(tenantId).then(
      () => true,
      () => false,
    );
  }

  /** The merchant's Payments page. */
  async setupStatus(tenantId: string, onlineSwitchedOn: boolean): Promise<PaymentSetupStatus> {
    const row = await this.master.tenantPaymentConfig.findFirst({
      where: { tenantId, provider: { not: 'mock' } },
      orderBy: { updatedAt: 'desc' },
    });
    const ready = await this.onlineReady(tenantId);

    const status: OnboardingStatus = !row
      ? 'NOT_CONNECTED'
      : row.connectionType === 'keys'
        ? row.encryptedSecretKey && row.enabled
          ? 'CONNECTED'
          : 'ACTION_REQUIRED'
        : (row.onboardingStatus as OnboardingStatus);

    return {
      status,
      connectionType: row ? (row.connectionType as ConnectionType) : ready ? 'platform' : null,
      provider: row?.provider ?? null,
      environment: row?.environment === 'live' ? 'live' : 'test',
      accountId: row?.providerAccountId ?? null,
      connectedAt: row?.connectedAt?.toISOString() ?? null,
      onlinePaymentsAvailable: ready && onlineSwitchedOn,
      onlinePaymentsSwitchedOn: onlineSwitchedOn,
      reason:
        row?.statusReason ??
        (row && status === 'ACTION_REQUIRED' ? 'Finish entering your gateway keys, or connect with Razorpay.' : null),
      oauthAvailable: this.oauth.configured,
    };
  }

  // ─────────────────────────────────────────────────────── Partner OAuth ──

  /**
   * Starts "Connect Razorpay": a single-use `state` bound to this tenant AND
   * this user, then Razorpay's own authorisation page.
   */
  async startOAuth(tenantId: string, userId: string): Promise<{ authorizeUrl: string }> {
    const state = randomBytes(24).toString('base64url');
    await this.cache.set(stateKey(state), { tenantId, userId }, OAUTH_STATE_TTL_SECONDS);
    return { authorizeUrl: this.oauth.authorizeUrl(state) };
  }

  /**
   * Finishes the connection from Razorpay's redirect.
   *
   * The tenant is taken from the stored `state`, and must equal the tenant the
   * caller is authenticated against — so a code obtained by one store cannot
   * be attached to another, and a forged or replayed `state` attaches nothing.
   */
  async completeOAuth(
    tenantId: string,
    userId: string,
    input: { code: string; state: string },
  ): Promise<PaymentSetupStatus> {
    const key = stateKey(input.state);
    const pending = await this.cache.get<{ tenantId: string; userId: string }>(key);
    await this.cache.del(key); // single use, whatever happens next
    if (!pending || pending.tenantId !== tenantId || pending.userId !== userId) {
      throw Errors.badRequest('This connection link has expired. Start again from Payments.');
    }

    const tokens = await this.oauth.exchangeCode(input.code);

    const claimed = await this.master.tenantPaymentConfig.findFirst({
      where: { provider: 'razorpay', providerAccountId: tokens.accountId, tenantId: { not: tenantId } },
      select: { id: true },
    });
    if (claimed) {
      await this.oauth.revoke(tokens.accessToken);
      throw Errors.conflict('This Razorpay account is already connected to another store.');
    }

    const data = {
      enabled: true,
      environment: this.config.payments.razorpay.oauth.mode,
      connectionType: 'oauth',
      onboardingStatus: 'CONNECTED',
      providerAccountId: tokens.accountId,
      publicKey: tokens.publicToken,
      encryptedAccessToken: this.cipher.encrypt(tokens.accessToken),
      encryptedRefreshToken: this.cipher.encrypt(tokens.refreshToken),
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
      connectedAt: new Date(),
      statusReason: null,
      // A store moving from manual keys to OAuth stops holding its secret.
      encryptedSecretKey: null,
      encryptedWebhookSecret: null,
    };
    await this.master.tenantPaymentConfig.upsert({
      where: { tenantId_provider: { tenantId, provider: 'razorpay' } },
      create: { tenantId, provider: 'razorpay', currency: this.config.payments.currency, ...data },
      update: data,
    });
    // Any other gateway (e.g. the dev mock) steps aside for the real one.
    await this.master.tenantPaymentConfig.updateMany({
      where: { tenantId, provider: { not: 'razorpay' } },
      data: { enabled: false },
    });

    this.logger.info('Store connected Razorpay via OAuth', { tenantId, accountId: tokens.accountId });
    return this.setupStatus(tenantId, true);
  }

  /** Disconnects the store: revokes the token at Razorpay and stops taking online payments. */
  async disconnectOAuth(tenantId: string): Promise<void> {
    const row = await this.master.tenantPaymentConfig.findUnique({
      where: { tenantId_provider: { tenantId, provider: 'razorpay' } },
    });
    if (!row || row.connectionType !== 'oauth') return;
    if (row.encryptedAccessToken) await this.oauth.revoke(this.cipher.decrypt(row.encryptedAccessToken));
    await this.clearOAuth(tenantId, 'NOT_CONNECTED', null);
    this.logger.info('Store disconnected Razorpay', { tenantId });
  }

  /**
   * The merchant revoked retailos from their Razorpay dashboard
   * (`account.app.authorization_revoked`). Online payments stop at once;
   * orders and payments already taken are untouched.
   */
  async markRevokedByAccount(accountId: string): Promise<string | null> {
    const row = await this.master.tenantPaymentConfig.findFirst({
      where: { provider: 'razorpay', providerAccountId: accountId, connectionType: 'oauth' },
      select: { tenantId: true },
    });
    if (!row) return null;
    await this.clearOAuth(
      row.tenantId,
      'REVOKED',
      'Access was removed from your Razorpay dashboard. Connect again to take online payments.',
    );
    this.logger.warn('Razorpay access revoked by merchant', { tenantId: row.tenantId });
    return row.tenantId;
  }

  /** The OAuth-connected store that owns a Razorpay account, for webhook cross-checks. */
  async tenantForAccount(accountId: string): Promise<string | null> {
    const row = await this.master.tenantPaymentConfig.findFirst({
      where: { provider: 'razorpay', providerAccountId: accountId },
      select: { tenantId: true },
    });
    return row?.tenantId ?? null;
  }

  // ───────────────────────────────────────────── manual keys (fallback) ──

  /** The safe view. Everything here may be sent to a browser. */
  async publicConfig(tenantId: string): Promise<PublicPaymentConfig> {
    const row = await this.master.tenantPaymentConfig.findFirst({
      where: { tenantId, enabled: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (!row) {
      const fallback = await this.platformFallback(tenantId).catch(() => null);
      return {
        provider: fallback?.provider ?? this.config.payments.provider,
        enabled: Boolean(fallback),
        environment: fallback?.environment ?? 'test',
        publicKey: fallback?.publicKey ?? null,
        currency: fallback?.currency ?? this.config.payments.currency,
        configured: false,
      };
    }

    return toPublic(row);
  }

  /** Every gateway the merchant has configured, safe view only. */
  async listForTenant(tenantId: string): Promise<PublicPaymentConfig[]> {
    const rows = await this.master.tenantPaymentConfig.findMany({
      where: { tenantId },
      orderBy: { provider: 'asc' },
    });
    return rows.map(toPublic);
  }

  /**
   * Creates or updates one gateway's manual-key configuration.
   *
   * Secrets are write-only: omitting `secretKey` keeps whatever is stored, so a
   * merchant editing their public key does not have to re-enter credentials the
   * API will never show them again.
   */
  async upsert(tenantId: string, input: UpsertPaymentConfigInput): Promise<PublicPaymentConfig> {
    const existing = await this.master.tenantPaymentConfig.findUnique({
      where: { tenantId_provider: { tenantId, provider: input.provider } },
    });

    // Pasting keys over a live OAuth connection would silently swap whose
    // account is paid. Disconnect first, deliberately.
    if (existing?.connectionType === 'oauth' && existing.onboardingStatus === 'CONNECTED') {
      throw Errors.conflict('This store is connected through Razorpay. Disconnect it before entering keys.');
    }

    const encryptedSecretKey =
      input.secretKey === undefined
        ? existing?.encryptedSecretKey ?? null
        : input.secretKey
          ? this.cipher.encrypt(input.secretKey)
          : null;

    const encryptedWebhookSecret =
      input.webhookSecret === undefined
        ? existing?.encryptedWebhookSecret ?? null
        : input.webhookSecret
          ? this.cipher.encrypt(input.webhookSecret)
          : null;

    // Enabling a gateway that cannot actually take a payment would fail at
    // checkout, in front of a customer. Refuse it here instead.
    if (input.enabled && input.provider !== 'mock' && !encryptedSecretKey) {
      throw Errors.badRequest('Add the gateway secret key before enabling payments');
    }

    const ready = input.provider === 'mock' || Boolean(encryptedSecretKey);
    const row = await this.master.tenantPaymentConfig.upsert({
      where: { tenantId_provider: { tenantId, provider: input.provider } },
      create: {
        tenantId,
        provider: input.provider,
        enabled: input.enabled,
        environment: input.environment,
        publicKey: input.publicKey ?? null,
        encryptedSecretKey,
        encryptedWebhookSecret,
        currency: input.currency ?? this.config.payments.currency,
        connectionType: 'keys',
        onboardingStatus: ready ? 'CONNECTED' : 'ACTION_REQUIRED',
        connectedAt: ready ? new Date() : null,
      },
      update: {
        enabled: input.enabled,
        environment: input.environment,
        publicKey: input.publicKey ?? existing?.publicKey ?? null,
        encryptedSecretKey,
        encryptedWebhookSecret,
        currency: input.currency ?? existing?.currency ?? this.config.payments.currency,
        connectionType: 'keys',
        onboardingStatus: ready ? 'CONNECTED' : 'ACTION_REQUIRED',
        statusReason: null,
      },
    });

    // Deliberately records that credentials changed, never what they are.
    this.logger.info('Tenant payment configuration updated', {
      tenantId,
      provider: row.provider,
      enabled: row.enabled,
      environment: row.environment,
      secretRotated: input.secretKey !== undefined,
    });

    return toPublic(row);
  }

  async disable(tenantId: string, provider: string): Promise<void> {
    await this.master.tenantPaymentConfig.updateMany({
      where: { tenantId, provider },
      data: { enabled: false },
    });
    this.logger.info('Tenant payment gateway disabled', { tenantId, provider });
  }

  // ------------------------------------------------------------ internals --

  /**
   * The store's access token, refreshed ahead of expiry.
   *
   * A refresh that Razorpay refuses (refresh token expired or revoked) moves
   * the store to ACTION_REQUIRED rather than failing every checkout silently:
   * the merchant is told to reconnect, and shoppers see the ordinary "online
   * payment is unavailable" message.
   */
  private async currentAccessToken(row: {
    tenantId: string;
    encryptedAccessToken: string | null;
    encryptedRefreshToken: string | null;
    accessTokenExpiresAt: Date | null;
  }): Promise<string> {
    if (!row.encryptedAccessToken || !row.encryptedRefreshToken) {
      throw Errors.paymentFailed('Online payment is temporarily unavailable.');
    }
    const fresh = row.accessTokenExpiresAt && row.accessTokenExpiresAt.getTime() - Date.now() > REFRESH_AHEAD_MS;
    if (fresh) return this.cipher.decrypt(row.encryptedAccessToken);

    const lockToken = await this.cache.acquireLock(`razorpay-refresh:${row.tenantId}`, 15_000);
    if (!lockToken) {
      // Another request is refreshing; the current token is still valid for days.
      return this.cipher.decrypt(row.encryptedAccessToken);
    }
    try {
      const tokens = await this.oauth.refresh(this.cipher.decrypt(row.encryptedRefreshToken));
      await this.master.tenantPaymentConfig.update({
        where: { tenantId_provider: { tenantId: row.tenantId, provider: 'razorpay' } },
        data: {
          encryptedAccessToken: this.cipher.encrypt(tokens.accessToken),
          encryptedRefreshToken: this.cipher.encrypt(tokens.refreshToken),
          accessTokenExpiresAt: tokens.accessTokenExpiresAt,
          refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
          publicKey: tokens.publicToken,
        },
      });
      return tokens.accessToken;
    } catch (err) {
      await this.master.tenantPaymentConfig.update({
        where: { tenantId_provider: { tenantId: row.tenantId, provider: 'razorpay' } },
        data: {
          onboardingStatus: 'ACTION_REQUIRED',
          statusReason: 'Your Razorpay connection needs to be renewed. Connect again to keep taking online payments.',
        },
      });
      this.logger.warn('Razorpay token refresh failed; store needs to reconnect', {
        tenantId: row.tenantId,
        error: (err as Error).message,
      });
      throw Errors.paymentFailed('Online payment is temporarily unavailable.');
    } finally {
      await this.cache.releaseLock(`razorpay-refresh:${row.tenantId}`, lockToken);
    }
  }

  /** Whether this store has ever had a real gateway configuration of its own. */
  private async hasOwnGateway(tenantId: string): Promise<boolean> {
    const count = await this.master.tenantPaymentConfig.count({
      where: { tenantId, provider: { not: 'mock' } },
    });
    return count > 0;
  }

  private async clearOAuth(tenantId: string, status: OnboardingStatus, reason: string | null) {
    await this.master.tenantPaymentConfig.updateMany({
      where: { tenantId, provider: 'razorpay', connectionType: 'oauth' },
      data: {
        enabled: false,
        onboardingStatus: status,
        statusReason: reason,
        encryptedAccessToken: null,
        encryptedRefreshToken: null,
        accessTokenExpiresAt: null,
        refreshTokenExpiresAt: null,
        publicKey: null,
      },
    });
  }

  /**
   * Platform-level credentials, for tenants that have not configured their own.
   *
   * Kept for development (the mock gateway) and for a single-account deployment
   * that predates per-tenant configuration. Refused in production for a real
   * gateway: money must not land in the platform's account because a merchant
   * forgot to finish setup.
   */
  private async platformFallback(tenantId: string): Promise<PaymentCredentials> {
    const provider = this.config.payments.provider;

    if (this.config.isProd && provider !== 'mock') {
      this.logger.warn('Tenant has no payment configuration of its own', { tenantId, provider });
      throw Errors.paymentFailed('Online payment is temporarily unavailable.');
    }

    const keyId = this.config.payments.razorpay.keyId ?? null;
    const keySecret = this.config.payments.razorpay.keySecret ?? null;
    return {
      provider,
      environment: 'test',
      publicKey: keyId,
      secretKey: keySecret,
      webhookSecret: this.config.payments.razorpay.webhookSecret ?? null,
      currency: this.config.payments.currency,
      auth: keyId && keySecret ? { scheme: 'basic', keyId, keySecret } : null,
      signatureSecret: keySecret,
      connectionType: 'platform',
      accountId: null,
    };
  }
}

function stateKey(state: string): string {
  return `oauth:razorpay:state:${state}`;
}

function toPublic(row: {
  provider: string;
  enabled: boolean;
  environment: string;
  publicKey: string | null;
  currency: string;
  encryptedSecretKey: string | null;
  connectionType: string;
  onboardingStatus: string;
}): PublicPaymentConfig {
  return {
    provider: row.provider,
    enabled: row.enabled,
    environment: row.environment === 'live' ? 'live' : 'test',
    publicKey: row.publicKey,
    currency: row.currency,
    configured:
      row.connectionType === 'oauth' ? row.onboardingStatus === 'CONNECTED' : Boolean(row.encryptedSecretKey),
  };
}
