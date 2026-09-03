import { Module, forwardRef } from '@nestjs/common';
import { CartController } from './cart/cart.controller';
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
import { MockPaymentProvider } from './payments/providers/mock.provider';
import { RazorpayProvider } from './payments/providers/razorpay.provider';
import { PAYMENT_PROVIDER } from './payments/payment-provider.interface';
import { PlatformController } from './platform/platform.controller';
import { PlatformService } from './platform/platform.service';
import { ReportsService } from './reports/reports.service';
import { ReviewsService } from './reviews/reviews.service';
import { StaffService } from './staff/staff.service';
import { StorefrontController } from './storefront/storefront.controller';
import { StoreService } from './store/store.service';
import { AppConfigService } from '@/config/config.module';
import { AppLogger } from '@/core/logger/logger.service';

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
  providers: [StoreService],
  exports: [StoreService],
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
 * depends on the `PAYMENT_PROVIDER` token and never on a concrete adapter, which
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
    MockPaymentProvider,
    RazorpayProvider,
    {
      provide: PAYMENT_PROVIDER,
      inject: [AppConfigService, MockPaymentProvider, RazorpayProvider, AppLogger],
      useFactory: (
        config: AppConfigService,
        mock: MockPaymentProvider,
        razorpay: RazorpayProvider,
        logger: AppLogger,
      ) => {
        if (config.payments.provider === 'razorpay') return razorpay;

        if (config.isProd) {
          throw new Error(
            'PAYMENT_PROVIDER=mock is not permitted in production. Configure a real gateway.',
          );
        }
        logger.withContext('PaymentsModule').warn(
          'Using the MOCK payment provider — no real money will move.',
        );
        return mock;
      },
    },
  ],
  exports: [PaymentsService, PAYMENT_PROVIDER],
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

/** Merchant console. One controller composing the domain services. */
@Module({
  imports: [
    CatalogModule,
    InventoryModule,
    OrdersModule,
    CustomersModule,
    CouponsModule,
    ReviewsModule,
    StoreModule,
    StaffModule,
    ReportsModule,
  ],
  controllers: [MerchantController],
})
export class MerchantModule {}

/** Platform super-admin console. */
@Module({
  controllers: [PlatformController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformModule {}
