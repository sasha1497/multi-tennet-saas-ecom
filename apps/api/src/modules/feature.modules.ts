import { Module, forwardRef } from '@nestjs/common';
import { CartController } from './cart/cart.controller';
import { BillingService } from './billing/billing.service';
import { PublicPlansController } from './billing/public-plans.controller';
import { AiService } from './ai/ai.service';
import { PRODUCT_SUGGESTION_PROVIDER } from './ai/ai-provider';
import { AnthropicProductProvider } from './ai/anthropic.provider';
import { MockProductProvider } from './ai/mock.provider';
import { AppConfigService } from '@/config/config.module';
import { CartService } from './cart/cart.service';
import { PricingService } from './cart/pricing.service';
import { CategoriesService } from './catalog/categories.service';
import { ProductsService } from './catalog/products.service';
import { CouponsService } from './coupons/coupons.service';
import { AccountController } from './customers/account.controller';
import { CustomersService } from './customers/customers.service';
import { InventoryService } from './inventory/inventory.service';
import { MerchantController } from './merchant/merchant.controller';
import { NotificationsService } from './notifications/notifications.service';
import { CustomerOrdersController } from './orders/customer-orders.controller';
import { OrdersService } from './orders/orders.service';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsService } from './payments/payments.service';
import { PaymentConfigService } from './payments/payment-config.service';
import { RazorpayOAuthClient } from './payments/razorpay-oauth.client';
import { PaymentProviderRegistry } from './payments/payment-provider.registry';
import { MockPaymentProvider } from './payments/providers/mock.provider';
import { RazorpayProvider } from './payments/providers/razorpay.provider';
import { PlatformController } from './platform/platform.controller';
import { PlatformService } from './platform/platform.service';
import { ReportsService } from './reports/reports.service';
import { ReviewsService } from './reviews/reviews.service';
import { StaffService } from './staff/staff.service';
import { StorefrontController } from './storefront/storefront.controller';
import { StoreService } from './store/store.service';
import { TemplateCatalogService } from './store/template-catalog.service';

/**
 * Catalog: products, variants, categories and brands.
 * Exported rather than controller-owning, because both the storefront and the
 * merchant console read through the same services with different scopes.
 */
@Module({
  providers: [ProductsService, CategoriesService],
  exports: [ProductsService, CategoriesService],
})
export class CatalogModule {}

@Module({
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}

@Module({
  imports: [CatalogModule],
  // PaymentConfigService is stateless; the storefront bootstrap asks it one
  // question — can this store take an online payment right now?
  providers: [StoreService, TemplateCatalogService, PaymentConfigService, RazorpayOAuthClient],
  exports: [StoreService, TemplateCatalogService],
})
export class StoreModule {}

@Module({
  providers: [CouponsService],
  exports: [CouponsService],
})
export class CouponsModule {}

@Module({
  imports: [StoreModule, CouponsModule],
  controllers: [CartController],
  providers: [CartService, PricingService],
  exports: [CartService, PricingService],
})
export class CartModule {}

@Module({
  providers: [CustomersService],
  exports: [CustomersService],
})
export class CustomersModule {}

@Module({
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}

@Module({
  providers: [StaffService],
  exports: [StaffService],
})
export class StaffModule {}

@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}

/**
 * Payments.
 *
 * The active provider is chosen once, here, from configuration — every consumer
 * resolves its gateway per tenant and never on a concrete adapter, which
 * is what keeps adding a gateway to a one-file change.
 *
 * The mock provider is refused outright in production: shipping a build where a
 * fake gateway could mark orders paid is not a risk worth taking.
 */
@Module({
  imports: [forwardRef(() => OrdersModule)],
  controllers: [PaymentsController],
  providers: [
    PaymentsService,
    PaymentConfigService,
    RazorpayOAuthClient,
    PaymentProviderRegistry,
    MockPaymentProvider,
    RazorpayProvider,
  ],
  exports: [PaymentsService, PaymentConfigService, PaymentProviderRegistry],
})
export class PaymentsModule {}

@Module({
  imports: [
    CatalogModule,
    InventoryModule,
    StoreModule,
    CouponsModule,
    CartModule,
    forwardRef(() => PaymentsModule),
  ],
  controllers: [CustomerOrdersController],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}

@Module({
  imports: [InventoryModule, StoreModule, OrdersModule],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}

/** Public storefront + signed-in shopper account. */
@Module({
  imports: [
    CatalogModule,
    StoreModule,
    ReviewsModule,
    CouponsModule,
    CustomersModule,
    NotificationsModule,
  ],
  controllers: [StorefrontController, AccountController],
})
export class StorefrontModule {}

/**
 * Platform billing: what a shop owner pays RetailOS.
 *
 * Separate from `PaymentsModule`, which is what a shopper pays a merchant.
 * Two different money flows, two different gateway accounts.
 */
@Module({
  controllers: [PublicPlansController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}

/**
 * AI tools. The provider is chosen once, from configuration, behind
 * `PRODUCT_SUGGESTION_PROVIDER`; metering and quotas live in `AiService` and
 * do not change when the provider does.
 */
@Module({
  imports: [CatalogModule, StoreModule],
  providers: [
    AiService,
    AnthropicProductProvider,
    MockProductProvider,
    {
      provide: PRODUCT_SUGGESTION_PROVIDER,
      inject: [AppConfigService, AnthropicProductProvider, MockProductProvider],
      useFactory: (
        config: AppConfigService,
        anthropic: AnthropicProductProvider,
        mock: MockProductProvider,
      ) => (config.ai.provider === 'anthropic' ? anthropic : mock),
    },
  ],
  exports: [AiService],
})
export class AiModule {}

/** Merchant console. One controller composing the domain services. */
@Module({
  imports: [
    AiModule,
    BillingModule,
    CatalogModule,
    InventoryModule,
    OrdersModule,
    CustomersModule,
    CouponsModule,
    ReviewsModule,
    StoreModule,
    StaffModule,
    ReportsModule,
    // For the payment-gateway settings endpoints.
    forwardRef(() => PaymentsModule),
  ],
  controllers: [MerchantController],
})
export class MerchantModule {}

/** Platform super-admin console. */
@Module({
  imports: [StoreModule, BillingModule],
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
