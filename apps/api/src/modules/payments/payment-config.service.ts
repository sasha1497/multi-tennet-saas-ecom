import { Injectable } from '@nestjs/common';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import { MasterPrismaService } from '@/core/database/master-prisma.service';
import { AppLogger } from '@/core/logger/logger.service';
import { CredentialCipherService } from '@/core/security/credential-cipher.service';

/**
 * Decrypted gateway credentials for ONE tenant.
 *
 * Only ever held on the stack for the duration of a call. Never cached, never
 * logged, never returned from a controller.
 */
export interface PaymentCredentials {
  provider: string;
  environment: 'test' | 'live';
  publicKey: string | null;
  secretKey: string | null;
  webhookSecret: string | null;
  currency: string;
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

/**
 * Per-tenant payment gateway configuration.
 *
 * The platform used to hold one set of Razorpay keys for everybody, which meant
 * every merchant's money landed in the same account. Configuration now belongs
 * to the tenant, and the only way to obtain it is to name a tenant that the
 * caller has already been verified against.
 *
 * Two rules make the isolation real rather than nominal:
 *
 *  1. `resolve()` takes a tenant id and reads only that tenant's row. There is
 *     no "current provider" singleton left to borrow, so a request cannot use
 *     another merchant's credentials even by accident.
 *  2. Secrets are decrypted in memory per call and never cached. The cost of a
 *     decrypt is nothing next to a network round trip to a gateway, and a cache
 *     of plaintext keys is exactly the thing worth not having.
 */
@Injectable()
export class PaymentConfigService {
  private readonly logger: AppLogger;

  constructor(
    private readonly master: MasterPrismaService,
    private readonly cipher: CredentialCipherService,
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('PaymentConfig');
  }

  /**
   * Credentials for a tenant's active gateway.
   *
   * Falls back to the platform-level configuration when the tenant has none of
   * its own. That fallback is what keeps the mock gateway usable in development
   * and lets an existing single-account deployment keep working — but it is
   * refused in production, where a merchant silently settling into the
   * platform's account would be worse than a failed checkout.
   */
  async resolve(tenantId: string): Promise<PaymentCredentials> {
    const row = await this.master.tenantPaymentConfig.findFirst({
      where: { tenantId, enabled: true },
      orderBy: { updatedAt: 'desc' },
    });

    if (row) {
      return {
        provider: row.provider,
        environment: row.environment === 'live' ? 'live' : 'test',
        publicKey: row.publicKey,
        secretKey: row.encryptedSecretKey ? this.cipher.decrypt(row.encryptedSecretKey) : null,
        webhookSecret: row.encryptedWebhookSecret
          ? this.cipher.decrypt(row.encryptedWebhookSecret)
          : null,
        currency: row.currency,
      };
    }

    return this.platformFallback(tenantId);
  }

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

    return {
      provider: row.provider,
      enabled: row.enabled,
      environment: row.environment === 'live' ? 'live' : 'test',
      publicKey: row.publicKey,
      currency: row.currency,
      configured: Boolean(row.encryptedSecretKey),
    };
  }

  /** Every gateway the merchant has configured, safe view only. */
  async listForTenant(tenantId: string): Promise<PublicPaymentConfig[]> {
    const rows = await this.master.tenantPaymentConfig.findMany({
      where: { tenantId },
      orderBy: { provider: 'asc' },
    });
    return rows.map((row) => ({
      provider: row.provider,
      enabled: row.enabled,
      environment: row.environment === 'live' ? 'live' : 'test',
      publicKey: row.publicKey,
      currency: row.currency,
      configured: Boolean(row.encryptedSecretKey),
    }));
  }

  /**
   * Creates or updates one gateway's configuration.
   *
   * Secrets are write-only: omitting `secretKey` keeps whatever is stored, so a
   * merchant editing their public key does not have to re-enter credentials the
   * API will never show them again.
   */
  async upsert(tenantId: string, input: UpsertPaymentConfigInput): Promise<PublicPaymentConfig> {
    const existing = await this.master.tenantPaymentConfig.findUnique({
      where: { tenantId_provider: { tenantId, provider: input.provider } },
    });

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
      },
      update: {
        enabled: input.enabled,
        environment: input.environment,
        publicKey: input.publicKey ?? existing?.publicKey ?? null,
        encryptedSecretKey,
        encryptedWebhookSecret,
        currency: input.currency ?? existing?.currency ?? this.config.payments.currency,
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

    return {
      provider: row.provider,
      enabled: row.enabled,
      environment: row.environment === 'live' ? 'live' : 'test',
      publicKey: row.publicKey,
      currency: row.currency,
      configured: Boolean(row.encryptedSecretKey),
    };
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
      throw Errors.paymentFailed('This store has not finished setting up payments');
    }

    return {
      provider,
      environment: 'test',
      publicKey: this.config.payments.razorpay.keyId ?? null,
      secretKey: this.config.payments.razorpay.keySecret ?? null,
      webhookSecret: this.config.payments.razorpay.webhookSecret ?? null,
      currency: this.config.payments.currency,
    };
  }
}
