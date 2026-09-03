import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppConfigModule } from '@/config/config.module';
import { AllExceptionsFilter } from '@/common/filters/all-exceptions.filter';
import { JwtAuthGuard } from '@/common/guards/jwt-auth.guard';
import { PermissionsGuard } from '@/common/guards/permissions.guard';
import { RateLimitGuard } from '@/common/guards/rate-limit.guard';
import { TenantGuard } from '@/common/guards/tenant.guard';
import { FeatureGuard } from '@/common/guards/feature.guard';
import { LoggingInterceptor } from '@/common/interceptors/logging.interceptor';
import { TransformInterceptor } from '@/common/interceptors/transform.interceptor';
import { RequestContextMiddleware } from '@/common/middleware/request-context.middleware';
import { CacheModule } from '@/core/cache/cache.service';
import { DatabaseModule } from '@/core/database/database.module';
import { LoggerModule } from '@/core/logger/logger.service';
import { ObservabilityModule } from '@/core/observability/metrics.service';
import { QueueModule } from '@/core/queue/queue.module';
import { SecurityModule } from '@/core/security/security.module';
import { StorageModule } from '@/core/storage/storage.service';
import { TenantModule } from '@/core/tenant/tenant.module';
import { TenantResolverMiddleware } from '@/core/tenant/tenant-resolver.middleware';
import { AuditModule } from '@/modules/audit/audit.service';
import { AuthModule } from '@/modules/auth/auth.module';
import { EntitlementsModule } from '@/modules/entitlements/entitlements.module';
import { HealthModule } from '@/modules/health/health.controller';
import { TenantsModule } from '@/modules/tenants/tenants.module';
import {
  CartModule,
  CatalogModule,
  CouponsModule,
  CustomersModule,
  InventoryModule,
  MerchantModule,
  NotificationsModule,
  OrdersModule,
  PaymentsModule,
  PlatformModule,
  ReportsModule,
  ReviewsModule,
  StaffModule,
  StoreModule,
  StorefrontModule,
} from '@/modules/feature.modules';

/**
 * Application root.
 *
 * The global provider list below is the whole security posture in one place, and
 * **the order matters**. Nest runs global guards in registration order:
 *
 *   1. RateLimitGuard  — cheapest rejection first; an abusive client never
 *                        reaches token verification
 *   2. JwtAuthGuard    — establishes *who* is calling (deny-by-default)
 *   3. TenantGuard     — establishes and verifies *which tenant* they may act on
 *   4. PermissionsGuard— checks live RBAC for that tenant
 *   5. FeatureGuard    — checks the plan entitlement
 *
 * Each stage depends on the previous one having run, which is why they are
 * listed rather than scattered across controllers.
 */
@Module({
  imports: [
    // --- infrastructure (all @Global) ---
    AppConfigModule,
    LoggerModule,
    ObservabilityModule,
    SecurityModule,
    CacheModule,
    DatabaseModule,
    TenantModule,
    QueueModule,
    StorageModule,
    AuditModule,
    EntitlementsModule,
    TenantsModule,
    AuthModule,

    // --- domain ---
    CatalogModule,
    InventoryModule,
    StoreModule,
    CouponsModule,
    CartModule,
    CustomersModule,
    ReviewsModule,
    StaffModule,
    NotificationsModule,
    OrdersModule,
    PaymentsModule,
    ReportsModule,

    // --- HTTP surfaces ---
    StorefrontModule,
    MerchantModule,
    PlatformModule,
    HealthModule,
  ],
  providers: [

    // Validation: every DTO is a Zod schema shared with the frontends.
    { provide: APP_PIPE, useClass: ZodValidationPipe },

    { provide: APP_GUARD, useClass: RateLimitGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: TenantGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_GUARD, useClass: FeatureGuard },

    // Interceptors run outermost-first on the way in, so logging wraps the
    // envelope and therefore captures the true handler duration.
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },

    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  /**
   * Middleware order is load-bearing:
   *   RequestContextMiddleware opens the AsyncLocalStorage scope that everything
   *   downstream — including the tenant resolver — reads from and writes to.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestContextMiddleware, TenantResolverMiddleware).forRoutes('*');
  }
}
