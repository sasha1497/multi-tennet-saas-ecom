import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { productQuerySchema, reviewQuerySchema, uuidSchema } from '@retailos/validation';
import { Public, RequireTenant } from '@/common/decorators';
import { RateLimit } from '@/common/guards/rate-limit.guard';
import { CategoriesService } from '@/modules/catalog/categories.service';
import { ProductsService } from '@/modules/catalog/products.service';
import { CouponsService } from '@/modules/coupons/coupons.service';
import { ReviewsService } from '@/modules/reviews/reviews.service';
import { StoreService } from '@/modules/store/store.service';

class ProductQueryDto extends createZodDto(productQuerySchema) {}
class ReviewQueryDto extends createZodDto(reviewQuerySchema) {}
class LimitQueryDto extends createZodDto(
  z.object({ limit: z.coerce.number().int().min(1).max(50).default(8) }),
) {}
class SearchQueryDto extends createZodDto(
  z.object({
    q: z.string().trim().min(1).max(120),
    limit: z.coerce.number().int().min(1).max(25).default(10),
  }),
) {}

/**
 * Public storefront API.
 *
 * Every route is `@Public()` — a shopper browses before signing in — but every
 * route is also `@RequireTenant()`, so the tenant is established from the
 * request Host before a single query runs. A published catalog is public; it is
 * never *cross-tenant* public.
 */
@ApiTags('Storefront')
@Controller()
@Public()
@RequireTenant()
export class StorefrontController {
  constructor(
    private readonly store: StoreService,
    private readonly products: ProductsService,
    private readonly categories: CategoriesService,
    private readonly reviews: ReviewsService,
    private readonly coupons: CouponsService,
  ) {}

  @Get('store')
  @ApiOperation({
    summary: 'Storefront bootstrap',
    description:
      'Branding, settings and the category tree for the store resolved from the request Host. ' +
      'The first call any storefront or mobile session makes.',
  })
  bootstrap() {
    return this.store.bootstrap();
  }

  @Get('categories')
  @ApiOperation({ summary: 'Active category tree' })
  categoryTree() {
    return this.categories.tree();
  }

  @Get('brands')
  @ApiOperation({ summary: 'Active brands' })
  brands() {
    return this.categories.listBrands(false);
  }

  @Get('products')
  @ApiOperation({ summary: 'Browse published products with filters, sort and paging' })
  list(@Query() query: ProductQueryDto) {
    return this.products.list(query, 'storefront');
  }

  @Get('products/featured')
  @ApiOperation({ summary: 'Featured products for the home page' })
  featured(@Query() query: LimitQueryDto) {
    return this.products.featured(query.limit);
  }

  @Get('products/popular')
  @ApiOperation({ summary: 'Best-selling products' })
  popular(@Query() query: LimitQueryDto) {
    return this.products.popular(query.limit);
  }

  @Get('products/search')
  @RateLimit({ limit: 60, ttl: 60, bucket: 'storefront:search', by: 'ip+tenant' })
  @ApiOperation({ summary: 'Type-ahead product search' })
  search(@Query() query: SearchQueryDto) {
    return this.products.search(query.q, query.limit);
  }

  // Declared after the literal `products/*` routes so `featured` and `popular`
  // are not swallowed by the `:slug` parameter.
  @Get('products/:slug')
  @ApiOperation({ summary: 'Product detail by slug' })
  bySlug(@Param('slug') slug: string) {
    return this.products.findBySlug(slug);
  }

  @Get('products/:id/related')
  @ApiOperation({ summary: 'Related products' })
  related(@Param('id') id: string, @Query() query: LimitQueryDto) {
    return this.products.related(uuidSchema.parse(id), query.limit);
  }

  @Get('reviews')
  @ApiOperation({ summary: 'Approved reviews for a product' })
  reviewsFor(@Query() query: ReviewQueryDto) {
    return this.reviews.listPublic(uuidSchema.parse(query.productId), query);
  }

  @Get('coupons/available')
  @ApiOperation({ summary: 'Publicly advertised, currently valid coupons' })
  availableCoupons() {
    return this.coupons.availableForStorefront();
  }
}
