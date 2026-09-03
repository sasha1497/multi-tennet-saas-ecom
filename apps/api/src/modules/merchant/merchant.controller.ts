import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { FeatureKey, Permission, TokenAudience } from '@retailos/types';
import {
  adjustInventorySchema,
  bulkAdjustInventorySchema,
  createBrandSchema,
  createCategorySchema,
  createCouponSchema,
  createProductSchema,
  customerQuerySchema,
  inventoryQuerySchema,
  inventoryTransactionQuerySchema,
  merchantUpdateCustomerSchema,
  moderateReviewSchema,
  orderQuerySchema,
  productQuerySchema,
  reportQuerySchema,
  updateBrandSchema,
  updateCategorySchema,
  updateCouponSchema,
  updateInternalNotesSchema,
  updateOrderStatusSchema,
  updateProductSchema,
  updateStoreSettingsSchema,
  inviteStaffSchema,
  updateStaffSchema,
  reviewQuerySchema,
} from '@retailos/validation';
import {
  Audience,
  RequireAnyPermission,
  RequireFeature,
  RequirePermissions,
  RequireTenant,
} from '@/common/decorators';
import { RateLimit } from '@/common/guards/rate-limit.guard';
import { Errors } from '@/common/errors/app.exception';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { StorageService } from '@/core/storage/storage.service';
import { CategoriesService } from '@/modules/catalog/categories.service';
import { ProductsService } from '@/modules/catalog/products.service';
import { CouponsService } from '@/modules/coupons/coupons.service';
import { CustomersService } from '@/modules/customers/customers.service';
import { InventoryService } from '@/modules/inventory/inventory.service';
import { OrdersService } from '@/modules/orders/orders.service';
import { ReportsService } from '@/modules/reports/reports.service';
import { ReviewsService } from '@/modules/reviews/reviews.service';
import { StaffService } from '@/modules/staff/staff.service';
import { StoreService } from '@/modules/store/store.service';
import { TenantsService } from '@/modules/tenants/tenants.service';
import { EntitlementsService } from '@/modules/entitlements/entitlements.service';
import { MembershipService } from '@/core/tenant/membership.service';
import { RequestContextService } from '@/core/context/request-context';

/**
 * Minimal shape of a Multer file. Declared locally rather than pulling in
 * `@types/multer` purely to name one parameter.
 */
interface UploadedImage {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

class ProductQueryDto extends createZodDto(productQuerySchema) {}
class CreateProductDto extends createZodDto(createProductSchema) {}
class UpdateProductDto extends createZodDto(updateProductSchema) {}
class PublishDto extends createZodDto(z.object({ publish: z.boolean() })) {}
class CreateCategoryDto extends createZodDto(createCategorySchema) {}
class UpdateCategoryDto extends createZodDto(updateCategorySchema) {}
class CreateBrandDto extends createZodDto(createBrandSchema) {}
class UpdateBrandDto extends createZodDto(updateBrandSchema) {}
class InventoryQueryDto extends createZodDto(inventoryQuerySchema) {}
class AdjustInventoryDto extends createZodDto(adjustInventorySchema) {}
class BulkAdjustDto extends createZodDto(bulkAdjustInventorySchema) {}
class ThresholdDto extends createZodDto(
  z.object({ variantId: z.string().uuid(), lowStockThreshold: z.number().int().min(0).max(100000) }),
) {}
class InventoryTxQueryDto extends createZodDto(inventoryTransactionQuerySchema) {}
class OrderQueryDto extends createZodDto(orderQuerySchema) {}
class UpdateOrderStatusDto extends createZodDto(updateOrderStatusSchema) {}
class InternalNotesDto extends createZodDto(updateInternalNotesSchema) {}
class CustomerQueryDto extends createZodDto(customerQuerySchema) {}
class UpdateCustomerDto extends createZodDto(merchantUpdateCustomerSchema) {}
class CreateCouponDto extends createZodDto(createCouponSchema) {}
class UpdateCouponDto extends createZodDto(updateCouponSchema) {}
class ReviewQueryDto extends createZodDto(reviewQuerySchema) {}
class ModerateReviewDto extends createZodDto(moderateReviewSchema) {}
class UpdateStoreDto extends createZodDto(updateStoreSettingsSchema) {}
class InviteStaffDto extends createZodDto(inviteStaffSchema) {}
class UpdateStaffDto extends createZodDto(updateStaffSchema) {}
class ReportQueryDto extends createZodDto(reportQuerySchema) {}
class PagedQueryDto extends createZodDto(
  z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  }),
) {}

/**
 * Merchant console API.
 *
 * Class-level decorators establish the security posture once:
 *   `@Audience(ADMIN)` — a shopper's token can never reach these routes
 *   `@RequireTenant()` — the tenant is resolved and membership verified before
 *                        any handler runs, so every service call below is
 *                        already scoped to the right database
 *
 * Individual routes then declare the specific permission they need, which is
 * what makes the RBAC model auditable by reading the controller.
 */
@ApiTags('Merchant')
@Controller('merchant')
@Audience(TokenAudience.ADMIN)
@RequireTenant()
export class MerchantController {
  constructor(
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly inventory: InventoryService,
    private readonly orders: OrdersService,
    private readonly customers: CustomersService,
    private readonly coupons: CouponsService,
    private readonly reviews: ReviewsService,
    private readonly store: StoreService,
    private readonly staff: StaffService,
    private readonly reports: ReportsService,
    private readonly storage: StorageService,
    private readonly tenants: TenantsService,
    private readonly entitlements: EntitlementsService,
    private readonly memberships: MembershipService,
    private readonly tenantDb: TenantDatabaseService,
    private readonly context: RequestContextService,
  ) {}

  // ============================================================ dashboard ==

  @Get('dashboard')
  @RequirePermissions(Permission.REPORTS_READ)
  @ApiOperation({
    summary: 'Dashboard summary',
    description: 'Revenue, orders, customers, charts, top products and low-stock alerts in one call.',
  })
  dashboard(@Query() query: ReportQueryDto) {
    return this.reports.dashboard(query);
  }

  @Get('tenant')
  @ApiOperation({ summary: 'The current store, its plan and its entitlements' })
  async currentTenant() {
    const tenantId = this.context.requireTenantId();
    const [tenant, entitlements] = await Promise.all([
      this.tenants.findById(tenantId),
      this.entitlements.get(tenantId),
    ]);

    return {
      tenant: {
        id: tenant.id,
        name: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        businessCategory: tenant.businessCategory,
        contactEmail: tenant.contactEmail,
        contactPhone: tenant.contactPhone,
        ownerUserId: tenant.ownerUserId,
        primaryDomain: tenant.domains.find((d) => d.isPrimary)?.hostname ?? null,
        storefrontUrl: this.tenants.storefrontUrlFor(tenant.slug),
        createdAt: tenant.createdAt.toISOString(),
        updatedAt: tenant.updatedAt.toISOString(),
        activatedAt: tenant.activatedAt?.toISOString() ?? null,
        suspendedAt: tenant.suspendedAt?.toISOString() ?? null,
        suspensionReason: tenant.suspensionReason,
      },
      entitlements,
      subscription: tenant.subscription
        ? {
            id: tenant.subscription.id,
            tenantId: tenant.id,
            planId: tenant.subscription.planId,
            status: tenant.subscription.status,
            currentPeriodStart: tenant.subscription.currentPeriodStart.toISOString(),
            currentPeriodEnd: tenant.subscription.currentPeriodEnd.toISOString(),
            trialEndsAt: tenant.subscription.trialEndsAt?.toISOString() ?? null,
            cancelledAt: tenant.subscription.cancelledAt?.toISOString() ?? null,
            createdAt: tenant.subscription.createdAt.toISOString(),
            plan: {
              id: tenant.subscription.plan.id,
              code: tenant.subscription.plan.code,
              name: tenant.subscription.plan.name,
              description: tenant.subscription.plan.description,
              priceMonthly: tenant.subscription.plan.priceMonthly,
              priceYearly: tenant.subscription.plan.priceYearly,
              currency: tenant.subscription.plan.currency,
              trialDays: tenant.subscription.plan.trialDays,
              isActive: tenant.subscription.plan.isActive,
              isPublic: tenant.subscription.plan.isPublic,
              sortOrder: tenant.subscription.plan.sortOrder,
              features: tenant.subscription.plan.features as Record<string, boolean>,
              limits: tenant.subscription.plan.limits as Record<string, number>,
            },
          }
        : null,
      domains: tenant.domains.map((d) => ({
        id: d.id,
        tenantId: d.tenantId,
        hostname: d.hostname,
        type: d.type,
        isPrimary: d.isPrimary,
        isVerified: d.isVerified,
        createdAt: d.createdAt.toISOString(),
      })),
    };
  }

  @Get('tenant/memberships')
  @ApiOperation({ summary: 'Stores the signed-in user can switch between' })
  async listMemberships() {
    const auth = this.context.auth;
    if (!auth) throw Errors.unauthenticated();
    const list = await this.memberships.listForUser(auth.userId);
    return list.map((m) => ({
      tenantId: m.tenantId,
      tenantName: m.tenantName,
      tenantSlug: m.tenantSlug,
      tenantStatus: m.tenantStatus,
      storefrontUrl: this.tenants.storefrontUrlFor(m.tenantSlug),
      logoUrl: null,
      role: m.role,
      permissions: m.permissions,
      isDefault: m.isDefault,
    }));
  }

  // ============================================================= products ==

  @Get('products')
  @RequirePermissions(Permission.PRODUCTS_READ)
  @ApiOperation({ summary: 'List products (all statuses)' })
  listProducts(@Query() query: ProductQueryDto) {
    return this.products.list(query, 'merchant');
  }

  @Get('products/:id')
  @RequirePermissions(Permission.PRODUCTS_READ)
  @ApiOperation({ summary: 'Product detail with variants and stock' })
  getProduct(@Param('id') id: string) {
    return this.products.findByIdForMerchant(id);
  }

  @Post('products')
  @RequirePermissions(Permission.PRODUCTS_CREATE)
  @ApiOperation({ summary: 'Create a product with its variants and opening stock' })
  createProduct(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Patch('products/:id')
  @RequirePermissions(Permission.PRODUCTS_UPDATE)
  @ApiOperation({ summary: 'Update a product' })
  updateProduct(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Delete('products/:id')
  @RequirePermissions(Permission.PRODUCTS_DELETE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Archive a product',
    description: 'Soft delete — historical orders keep their snapshot of the product.',
  })
  async deleteProduct(@Param('id') id: string): Promise<void> {
    await this.products.archive(id);
  }

  @Post('products/:id/publish')
  @RequirePermissions(Permission.PRODUCTS_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Publish or unpublish a product' })
  publishProduct(@Param('id') id: string, @Body() dto: PublishDto) {
    return this.products.setPublished(id, dto.publish);
  }

  // =========================================================== categories ==

  @Get('categories')
  @RequirePermissions(Permission.CATEGORIES_READ)
  listCategories() {
    return this.categories.listAll();
  }

  @Post('categories')
  @RequirePermissions(Permission.CATEGORIES_MANAGE)
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.categories.create(dto);
  }

  @Patch('categories/:id')
  @RequirePermissions(Permission.CATEGORIES_MANAGE)
  updateCategory(@Param('id') id: string, @Body() dto: UpdateCategoryDto) {
    return this.categories.update(id, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions(Permission.CATEGORIES_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCategory(@Param('id') id: string): Promise<void> {
    await this.categories.remove(id);
  }

  // =============================================================== brands ==

  @Get('brands')
  @RequirePermissions(Permission.BRANDS_READ)
  listBrands() {
    return this.categories.listBrands(true);
  }

  @Post('brands')
  @RequirePermissions(Permission.BRANDS_MANAGE)
  createBrand(@Body() dto: CreateBrandDto) {
    return this.categories.createBrand(dto);
  }

  @Patch('brands/:id')
  @RequirePermissions(Permission.BRANDS_MANAGE)
  updateBrand(@Param('id') id: string, @Body() dto: UpdateBrandDto) {
    return this.categories.updateBrand(id, dto);
  }

  @Delete('brands/:id')
  @RequirePermissions(Permission.BRANDS_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBrand(@Param('id') id: string): Promise<void> {
    await this.categories.removeBrand(id);
  }

  // ============================================================ inventory ==

  @Get('inventory')
  @RequirePermissions(Permission.INVENTORY_READ)
  @ApiOperation({ summary: 'Stock levels across every variant' })
  listInventory(@Query() query: InventoryQueryDto) {
    return this.inventory.list(query);
  }

  @Post('inventory/adjust')
  @RequirePermissions(Permission.INVENTORY_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Adjust stock for one variant',
    description:
      'Send `expectedVersion` for optimistic concurrency: if someone else changed the same ' +
      'SKU first you get a 409 rather than silently overwriting their count.',
  })
  adjustInventory(@Body() dto: AdjustInventoryDto) {
    return this.inventory.adjust(dto);
  }

  @Post('inventory/bulk-adjust')
  @RequirePermissions(Permission.INVENTORY_UPDATE)
  @HttpCode(HttpStatus.OK)
  bulkAdjust(@Body() dto: BulkAdjustDto) {
    return this.inventory.bulkAdjust(dto.adjustments);
  }

  @Post('inventory/threshold')
  @RequirePermissions(Permission.INVENTORY_UPDATE)
  @HttpCode(HttpStatus.OK)
  setThreshold(@Body() dto: ThresholdDto) {
    return this.inventory.setLowStockThreshold(dto.variantId, dto.lowStockThreshold);
  }

  @Get('inventory/transactions')
  @RequirePermissions(Permission.INVENTORY_READ)
  @ApiOperation({ summary: 'Stock movement ledger' })
  inventoryTransactions(@Query() query: InventoryTxQueryDto) {
    return this.inventory.transactions(query);
  }

  // =============================================================== orders ==

  @Get('orders')
  @RequirePermissions(Permission.ORDERS_READ)
  listOrders(@Query() query: OrderQueryDto) {
    return this.orders.listForMerchant(query);
  }

  @Get('orders/:id')
  @RequirePermissions(Permission.ORDERS_READ)
  getOrder(@Param('id') id: string) {
    return this.orders.findByIdForMerchant(id);
  }

  @Post('orders/:id/status')
  @RequirePermissions(Permission.ORDERS_UPDATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Move an order to the next status',
    description:
      'Validated against the allowed transition map. Cancelling or refunding returns stock ' +
      'automatically and reverses any coupon redemption.',
  })
  updateOrderStatus(@Param('id') id: string, @Body() dto: UpdateOrderStatusDto) {
    return this.orders.updateStatus(id, dto.status, { note: dto.note, reason: dto.reason });
  }

  @Patch('orders/:id/notes')
  @RequirePermissions(Permission.ORDERS_UPDATE)
  updateOrderNotes(@Param('id') id: string, @Body() dto: InternalNotesDto) {
    return this.orders.updateInternalNotes(id, dto.internalNotes);
  }

  // ============================================================ customers ==

  @Get('customers')
  @RequirePermissions(Permission.CUSTOMERS_READ)
  listCustomers(@Query() query: CustomerQueryDto) {
    return this.customers.list(query);
  }

  @Get('customers/:id')
  @RequirePermissions(Permission.CUSTOMERS_READ)
  getCustomer(@Param('id') id: string) {
    return this.customers.findByIdForMerchant(id);
  }

  @Patch('customers/:id')
  @RequirePermissions(Permission.CUSTOMERS_UPDATE)
  updateCustomer(@Param('id') id: string, @Body() dto: UpdateCustomerDto) {
    return this.customers.updateByMerchant(id, dto);
  }

  // ============================================================== coupons ==

  @Get('coupons')
  @RequirePermissions(Permission.COUPONS_READ)
  @RequireFeature(FeatureKey.COUPONS)
  listCoupons(@Query() query: PagedQueryDto) {
    return this.coupons.list(query);
  }

  @Post('coupons')
  @RequirePermissions(Permission.COUPONS_MANAGE)
  @RequireFeature(FeatureKey.COUPONS)
  createCoupon(@Body() dto: CreateCouponDto) {
    return this.coupons.create(dto);
  }

  @Patch('coupons/:id')
  @RequirePermissions(Permission.COUPONS_MANAGE)
  @RequireFeature(FeatureKey.COUPONS)
  updateCoupon(@Param('id') id: string, @Body() dto: UpdateCouponDto) {
    return this.coupons.update(id, dto);
  }

  @Delete('coupons/:id')
  @RequirePermissions(Permission.COUPONS_MANAGE)
  @RequireFeature(FeatureKey.COUPONS)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCoupon(@Param('id') id: string): Promise<void> {
    await this.coupons.remove(id);
  }

  // ============================================================== reviews ==

  @Get('reviews')
  @RequirePermissions(Permission.REVIEWS_READ)
  listReviews(@Query() query: ReviewQueryDto) {
    return this.reviews.listForMerchant(query);
  }

  @Post('reviews/:id/moderate')
  @RequirePermissions(Permission.REVIEWS_MODERATE)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve or reject a review' })
  moderateReview(@Param('id') id: string, @Body() dto: ModerateReviewDto) {
    return this.reviews.moderate(id, dto.isApproved);
  }

  // ================================================================ store ==

  @Get('store')
  @RequireAnyPermission(Permission.STORE_MANAGE, Permission.STORE_DESIGN)
  storeSettings() {
    return this.store.getSettings();
  }

  @Patch('store')
  @RequireAnyPermission(Permission.STORE_MANAGE, Permission.STORE_DESIGN)
  @ApiOperation({ summary: 'Update branding, theme, banners, tax, shipping and payment options' })
  updateStore(@Body() dto: UpdateStoreDto) {
    return this.store.updateSettings(dto);
  }

  // ================================================================ staff ==

  @Get('staff')
  @RequirePermissions(Permission.STAFF_READ)
  listStaff() {
    return this.staff.list();
  }

  @Post('staff')
  @RequirePermissions(Permission.STAFF_MANAGE)
  @RequireFeature(FeatureKey.STAFF)
  @ApiOperation({
    summary: 'Invite a team member',
    description:
      'Only MANAGER and STAFF can be assigned, and extra permissions are intersected with ' +
      'those the inviter holds — a merchant cannot grant more than they have.',
  })
  inviteStaff(@Body() dto: InviteStaffDto) {
    return this.staff.invite(dto);
  }

  @Patch('staff/:id')
  @RequirePermissions(Permission.STAFF_MANAGE)
  updateStaff(@Param('id') id: string, @Body() dto: UpdateStaffDto) {
    return this.staff.update(id, dto);
  }

  @Delete('staff/:id')
  @RequirePermissions(Permission.STAFF_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeStaff(@Param('id') id: string): Promise<void> {
    await this.staff.remove(id);
  }

  // ============================================================== reports ==

  @Get('reports/sales')
  @RequirePermissions(Permission.REPORTS_READ)
  salesReport(@Query() query: ReportQueryDto) {
    return this.reports.salesReport(query);
  }

  @Get('reports/customers')
  @RequirePermissions(Permission.REPORTS_READ)
  customerReport(@Query() query: ReportQueryDto) {
    return this.reports.customerReport(query);
  }

  @Get('reports/inventory')
  @RequirePermissions(Permission.REPORTS_READ)
  inventoryReport() {
    return this.reports.inventoryReport();
  }

  // ================================================================ files ==

  @Post('files/upload')
  @RequirePermissions(Permission.FILES_UPLOAD)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @RateLimit({ limit: 60, ttl: 300, bucket: 'upload', by: 'user' })
  @ApiOperation({
    summary: 'Upload a product or branding image',
    description:
      'Validates size, MIME type *and* the file\'s magic number, then stores it under a ' +
      'tenant-prefixed key in object storage.',
  })
  async upload(@UploadedFile() file?: UploadedImage) {
    if (!file) throw Errors.badRequest('No file was uploaded');

    const stored = await this.storage.upload({
      buffer: file.buffer,
      originalName: file.originalname,
      mimeType: file.mimetype,
      tenantId: this.tenantDb.tenantId,
      folder: 'products',
    });

    return {
      url: stored.url,
      key: stored.key,
      size: stored.size,
      mimeType: stored.mimeType,
    };
  }
}
