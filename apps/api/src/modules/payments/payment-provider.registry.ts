import { Injectable } from '@nestjs/common';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import { AppLogger } from '@/core/logger/logger.service';
import type { PaymentProviderAdapter } from './payment-provider.interface';
import { MockPaymentProvider } from './providers/mock.provider';
import { RazorpayProvider } from './providers/razorpay.provider';

/**
 * Every gateway adapter the platform knows how to speak to.
 *
 * This replaces the single `PAYMENT_PROVIDER` singleton. That singleton was
 * chosen once from platform configuration, which is precisely why every
 * merchant shared one Razorpay account: there was only ever one adapter, bound
 * to one set of keys.
 *
 * Adapters are stateless with respect to credentials — those arrive per call —
 * so they can remain plain singletons. There are no per-tenant adapter
 * instances to cache, and therefore no cache that could hand Tenant A an object
 * still holding Tenant B's keys.
 *
 * Adding PhonePe or Cashfree is a new adapter plus one line here.
 */
@Injectable()
export class PaymentProviderRegistry {
  private readonly adapters = new Map<string, PaymentProviderAdapter>();
  private readonly logger: AppLogger;

  constructor(
    mock: MockPaymentProvider,
    razorpay: RazorpayProvider,
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('PaymentProviders');
    this.adapters.set(mock.name, mock);
    this.adapters.set(razorpay.name, razorpay);
  }

  /** Names of every gateway a merchant may configure. */
  available(): string[] {
    return [...this.adapters.keys()].filter((name) => name !== 'mock' || !this.config.isProd);
  }

  has(name: string): boolean {
    return this.adapters.has(name);
  }

  /**
   * The adapter for a provider name.
   *
   * The mock gateway is refused in production even if a tenant row somehow asks
   * for it: a fake gateway that marks orders paid must never be reachable with
   * real customers, and a stale database row is not a good enough reason.
   */
  get(name: string): PaymentProviderAdapter {
    const adapter = this.adapters.get(name);
    if (!adapter) {
      this.logger.error(`No payment adapter registered for "${name}"`);
      throw Errors.paymentFailed('This store’s payment gateway is not supported');
    }
    if (adapter.name === 'mock' && this.config.isProd) {
      this.logger.error('Refused to use the mock gateway in production');
      throw Errors.paymentFailed('This store’s payment gateway is not configured');
    }
    return adapter;
  }
}
