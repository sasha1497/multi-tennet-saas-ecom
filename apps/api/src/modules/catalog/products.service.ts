import { Injectable } from '@nestjs/common';
import { cacheKeys } from '@retailos/config';
import { AuditAction, LimitKey, type PaginatedResult, type Product, type ProductListItem } from '@retailos/types';
import { slugify, type CreateProductInput, type ProductQueryInput, type UpdateProductInput } from '@retailos/validation';
import { Errors } from '@/common/errors/app.exception';
import { buildOrderBy, escapeLike, normaliseSearch, paginate, toPrismaPage } from '@/common/utils/pagination';
import { AppConfigService } from '@/config/config.module';
import { CacheService } from '@/core/cache/cache.service';
import { RequestContextService } from '@/core/context/request-context';
import { TenantDatabaseService, type TenantTransactionClient } from '@/core/database/tenant-database.service';
import { AppLogger } from '@/core/logger/logger.service';
import { AuditService } from '@/modules/audit/audit.service';
import { EntitlementsService } from '@/modules/entitlements/entitlements.service';
import {
  buildSearchText,
  buildVariantLabel,
  mapProduct,
  mapProductListItem,
} from './catalog.mapper';

const SORTABLE = ['createdAt', 'updatedAt', 'name', 'priceFrom', 'soldCount', 'ratingAverage'] as const;

/** Everything a full product response needs, in one query. */
const PRODUCT_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
  images: { orderBy: { sortOrder: 'asc' } },
  variants: {
    where: { deletedAt: null },
    orderBy: { sortOrder: 'asc' },
    include: { inventory: true },
  },
} as const;

/** Trimmed include for list views — avoids pulling descriptions for 20 rows. */
const LIST_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
  images: { where: { isPrimary: true }, take: 1 },
  variants: {
    where: { deletedAt: null, isActive: true },
    select: { inventory: { select: { quantity: true, reserved: true } } },
  },
} as const;

@Injectable()
export class ProductsService {
  private readonly logger: AppLogger;

  constructor(
    private readonly tenantDb: TenantDatabaseService,
    private readonly cache: CacheService,
    private readonly context: RequestContextService,
    private readonly entitlements: EntitlementsService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('ProductsService');
  }

  // =========================================================== reading ==

  /**
   * Product list.
   *
   * `scope: 'storefront'` hides drafts and archived products; `scope: 'merchant'`
   * shows everything and adds admin-only columns. Two scopes rather than two
   * methods keeps filtering and sorting in one place.
   */
  async list(
    query: ProductQueryInput,
    scope: 'storefront' | 'merchant',
  ): Promise<PaginatedResult<ProductListItem>> {
    const { skip, take, page, limit } = toPrismaPage(query);
    const search = normaliseSearch(query.search);

    const where: Record<string, unknown> = { deletedAt: null };

    if (scope === 'storefront') {
      where.status = 'PUBLISHED';
    } else if (query.status) {
      where.status = query.status;
    }

    if (query.categoryId) where.categoryId = query.categoryId;
    if (query.brandId) where.brandId = query.brandId;
    if (query.isFeatured !== undefined) where.isFeatured = query.isFeatured;
    if (query.tags?.length) where.tags = { hasSome: query.tags };

    if (query.categorySlug) {
      where.category = { slug: query.categorySlug };
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.priceFrom = {
        ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
      };
    }

    if (search) {
      const term = escapeLike(search);
      where.OR = [
        { name: { contains: term, mode: 'insensitive' } },
        { searchText: { contains: term.toLowerCase(), mode: 'insensitive' } },
        { variants: { some: { sku: { contains: term.toUpperCase() } } } },
      ];
    }

    const orderBy = buildOrderBy(query.sortBy, query.sortOrder, SORTABLE, {
      field: scope === 'storefront' ? 'soldCount' : 'createdAt',
      order: 'desc',
    });

    const [rows, total] = await this.tenantDb.run((db) =>
      Promise.all([
        db.product.findMany({ where, include: LIST_INCLUDE, orderBy, skip, take }),
        db.product.count({ where }),
      ]),
    );

    let items = rows.map((row) =>
      mapProductListItem(row as never, { includeAdminFields: scope === 'merchant' }),
    );

    // Stock filters run in memory because availability is a derived value
    // (`quantity - reserved`) across a product's variants. At page size ≤ 100
    // this is cheaper than the alternative correlated subquery.
    if (query.inStock !== undefined) {
      items = items.filter((i) => i.inStock === query.inStock);
    }
    if (query.lowStockOnly) {
      items = items.filter((i) => (i.totalStock ?? 0) > 0 && (i.totalStock ?? 0) <= 5);
    }

    return paginate(items, total, page, limit);
  }

  /** Storefront product page. Cached, since it is the most-hit tenant route. */
  async findBySlug(slug: string): Promise<Product> {
    const tenantId = this.tenantDb.tenantId;

    return this.cache.remember(
      cacheKeys.product(tenantId, slug),
      this.config.redis.ttl.catalog,
      async () => {
        const row = await this.tenantDb.run((db) =>
          db.product.findFirst({
            where: { slug, status: 'PUBLISHED', deletedAt: null },
            include: PRODUCT_INCLUDE,
          }),
        );
        if (!row) throw Errors.notFound('Product');
        return mapProduct(row as never);
      },
    );
  }

  /** Merchant view: any status, never cached (they need to see edits at once). */
  async findByIdForMerchant(id: string): Promise<Product> {
    const row = await this.tenantDb.run((db) =>
      db.product.findFirst({ where: { id, deletedAt: null }, include: PRODUCT_INCLUDE }),
    );
    if (!row) throw Errors.notFound('Product', id);
    return mapProduct(row as never);
  }

  async featured(limit = 8): Promise<ProductListItem[]> {
    const tenantId = this.tenantDb.tenantId;
    return this.cache.remember(
      cacheKeys.featuredProducts(tenantId),
      this.config.redis.ttl.catalog,
      async () => {
        const rows = await this.tenantDb.run((db) =>
          db.product.findMany({
            where: { isFeatured: true, status: 'PUBLISHED', deletedAt: null },
            include: LIST_INCLUDE,
            orderBy: { soldCount: 'desc' },
            take: limit,
          }),
        );
        return rows.map((r) => mapProductListItem(r as never));
      },
    );
  }

  async popular(limit = 8): Promise<ProductListItem[]> {
    const tenantId = this.tenantDb.tenantId;
    return this.cache.remember(
      cacheKeys.popularProducts(tenantId),
      this.config.redis.ttl.catalog,
      async () => {
        const rows = await this.tenantDb.run((db) =>
          db.product.findMany({
            where: { status: 'PUBLISHED', deletedAt: null },
            include: LIST_INCLUDE,
            orderBy: [{ soldCount: 'desc' }, { ratingCount: 'desc' }, { createdAt: 'desc' }],
            take: limit,
          }),
        );
        return rows.map((r) => mapProductListItem(r as never));
      },
    );
  }

  /** Same category first, then same brand — good enough without a recommender. */
  async related(productId: string, limit = 8): Promise<ProductListItem[]> {
    const product = await this.tenantDb.run((db) =>
      db.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { categoryId: true, brandId: true },
      }),
    );
    if (!product) return [];

    const rows = await this.tenantDb.run((db) =>
      db.product.findMany({
        where: {
          id: { not: productId },
          status: 'PUBLISHED',
          deletedAt: null,
          OR: [
            ...(product.categoryId ? [{ categoryId: product.categoryId }] : []),
            ...(product.brandId ? [{ brandId: product.brandId }] : []),
          ],
        },
        include: LIST_INCLUDE,
        orderBy: { soldCount: 'desc' },
        take: limit,
      }),
    );
    return rows.map((r) => mapProductListItem(r as never));
  }

  /** Type-ahead search. Backed by the trigram index from migration 0002. */
  async search(term: string, limit = 10): Promise<ProductListItem[]> {
    const clean = normaliseSearch(term);
    if (!clean || clean.length < 2) return [];

    const escaped = escapeLike(clean);
    const rows = await this.tenantDb.run((db) =>
      db.product.findMany({
        where: {
          status: 'PUBLISHED',
          deletedAt: null,
          OR: [
            { name: { contains: escaped, mode: 'insensitive' } },
            { searchText: { contains: escaped.toLowerCase() } },
          ],
        },
        include: LIST_INCLUDE,
        orderBy: [{ soldCount: 'desc' }],
        take: limit,
      }),
    );
    return rows.map((r) => mapProductListItem(r as never));
  }

  // =========================================================== writing ==

  async create(input: CreateProductInput): Promise<Product> {
    const tenantId = this.tenantDb.tenantId;

    const currentCount = await this.tenantDb.run((db) =>
      db.product.count({ where: { deletedAt: null } }),
    );
    await this.entitlements.assertWithinLimit(tenantId, LimitKey.MAX_PRODUCTS, currentCount);

    const slug = await this.uniqueSlug(input.name);

    const product = await this.tenantDb.transaction(async (tx) => {
      await this.assertRelationsExist(tx, input.categoryId, input.brandId);
      await this.assertSkusAvailable(tx, input.variants.map((v) => v.sku));

      const priceFrom = Math.min(...input.variants.map((v) => v.price));
      const mrpFrom = Math.min(...input.variants.map((v) => v.mrp));
      const [category, brand] = await Promise.all([
        input.categoryId ? tx.category.findUnique({ where: { id: input.categoryId } }) : null,
        input.brandId ? tx.brand.findUnique({ where: { id: input.brandId } }) : null,
      ]);

      const created = await tx.product.create({
        data: {
          name: input.name.trim(),
          slug,
          description: input.description ?? null,
          shortDescription: input.shortDescription ?? null,
          status: input.status,
          categoryId: input.categoryId ?? null,
          brandId: input.brandId ?? null,
          options: (input.options ?? []) as never,
          tags: input.tags ?? [],
          taxRateBps: input.taxRateBps ?? null,
          hsnCode: input.hsnCode ?? null,
          isFeatured: input.isFeatured ?? false,
          priceFrom,
          mrpFrom,
          metaTitle: input.metaTitle ?? null,
          metaDescription: input.metaDescription ?? null,
          searchText: buildSearchText({
            name: input.name,
            shortDescription: input.shortDescription,
            brandName: brand?.name,
            categoryName: category?.name,
            tags: input.tags,
            skus: input.variants.map((v) => v.sku),
          }),
          publishedAt: input.status === 'PUBLISHED' ? new Date() : null,
          images: {
            create: (input.images ?? []).map((img, index) => ({
              url: img.url,
              alt: img.alt ?? null,
              sortOrder: index,
              // Exactly one primary; default to the first if none was flagged.
              isPrimary: img.isPrimary ?? index === 0,
            })),
          },
        },
      });

      for (const [index, variant] of input.variants.entries()) {
        const created_ = await tx.productVariant.create({
          data: {
            productId: created.id,
            sku: variant.sku,
            barcode: variant.barcode ?? null,
            options: variant.options as never,
            label: buildVariantLabel(variant.options, input.options),
            price: variant.price,
            mrp: variant.mrp,
            imageUrl: variant.imageUrl ?? null,
            weightGrams: variant.weightGrams ?? null,
            sortOrder: index,
            isActive: variant.isActive ?? true,
          },
        });

        // Inventory is created alongside the variant so a product can never
        // exist without a stock row to reserve against.
        await tx.inventory.create({
          data: {
            variantId: created_.id,
            quantity: variant.initialStock ?? 0,
            reserved: 0,
            lowStockThreshold: variant.lowStockThreshold ?? 5,
          },
        });

        if ((variant.initialStock ?? 0) > 0) {
          await tx.inventoryTransaction.create({
            data: {
              variantId: created_.id,
              type: 'INITIAL',
              quantityChange: variant.initialStock ?? 0,
              quantityAfter: variant.initialStock ?? 0,
              reason: 'Initial stock on product creation',
              performedBy: this.context.userId,
            },
          });
        }
      }

      return tx.product.findUniqueOrThrow({ where: { id: created.id }, include: PRODUCT_INCLUDE });
    });

    await this.cache.invalidateCatalog(tenantId);

    this.audit.record('tenant', {
      action: AuditAction.PRODUCT_CREATED,
      resourceType: 'product',
      resourceId: product.id,
      metadata: { name: product.name, variants: input.variants.length },
    });

    this.logger.info('Product created', { productId: product.id, tenantId });
    return mapProduct(product as never);
  }

  async update(id: string, input: UpdateProductInput): Promise<Product> {
    const tenantId = this.tenantDb.tenantId;

    const product = await this.tenantDb.transaction(async (tx) => {
      const existing = await tx.product.findFirst({
        where: { id, deletedAt: null },
        include: { variants: { where: { deletedAt: null } } },
      });
      if (!existing) throw Errors.notFound('Product', id);

      await this.assertRelationsExist(tx, input.categoryId, input.brandId);

      // ---- variants ------------------------------------------------------
      if (input.variants) {
        const incomingIds = new Set(input.variants.filter((v) => v.id).map((v) => v.id!));
        const newSkus = input.variants.filter((v) => !v.id).map((v) => v.sku);
        if (newSkus.length) await this.assertSkusAvailable(tx, newSkus);

        // Variants dropped from the payload are soft-deleted, never hard-deleted:
        // historical order lines reference them.
        const removed = existing.variants.filter((v) => !incomingIds.has(v.id));
        for (const variant of removed) {
          await tx.productVariant.update({
            where: { id: variant.id },
            data: { deletedAt: new Date(), isActive: false },
          });
        }

        for (const [index, variant] of input.variants.entries()) {
          const label = buildVariantLabel(
            variant.options,
            (input.options ?? existing.options) as never,
          );

          if (variant.id) {
            await tx.productVariant.update({
              where: { id: variant.id },
              data: {
                sku: variant.sku,
                barcode: variant.barcode ?? null,
                options: variant.options as never,
                label,
                price: variant.price,
                mrp: variant.mrp,
                imageUrl: variant.imageUrl ?? null,
                weightGrams: variant.weightGrams ?? null,
                sortOrder: index,
                isActive: variant.isActive ?? true,
                deletedAt: null,
              },
            });
          } else {
            const created = await tx.productVariant.create({
              data: {
                productId: id,
                sku: variant.sku,
                barcode: variant.barcode ?? null,
                options: variant.options as never,
                label,
                price: variant.price,
                mrp: variant.mrp,
                imageUrl: variant.imageUrl ?? null,
                weightGrams: variant.weightGrams ?? null,
                sortOrder: index,
                isActive: variant.isActive ?? true,
              },
            });
            await tx.inventory.create({
              data: {
                variantId: created.id,
                quantity: variant.initialStock ?? 0,
                lowStockThreshold: variant.lowStockThreshold ?? 5,
              },
            });
          }
        }
      }

      // ---- images --------------------------------------------------------
      if (input.images) {
        await tx.productImage.deleteMany({ where: { productId: id } });
        if (input.images.length) {
          await tx.productImage.createMany({
            data: input.images.map((img, index) => ({
              productId: id,
              url: img.url,
              alt: img.alt ?? null,
              sortOrder: index,
              isPrimary: img.isPrimary ?? index === 0,
            })),
          });
        }
      }

      // ---- denormalised price + search text -------------------------------
      const liveVariants = await tx.productVariant.findMany({
        where: { productId: id, deletedAt: null, isActive: true },
        select: { price: true, mrp: true, sku: true },
      });

      const [category, brand] = await Promise.all([
        (input.categoryId ?? existing.categoryId)
          ? tx.category.findUnique({ where: { id: (input.categoryId ?? existing.categoryId)! } })
          : null,
        (input.brandId ?? existing.brandId)
          ? tx.brand.findUnique({ where: { id: (input.brandId ?? existing.brandId)! } })
          : null,
      ]);

      const name = input.name?.trim() ?? existing.name;
      const status = input.status ?? existing.status;

      await tx.product.update({
        where: { id },
        data: {
          name,
          description: input.description !== undefined ? input.description : existing.description,
          shortDescription:
            input.shortDescription !== undefined ? input.shortDescription : existing.shortDescription,
          status,
          categoryId: input.categoryId !== undefined ? input.categoryId : existing.categoryId,
          brandId: input.brandId !== undefined ? input.brandId : existing.brandId,
          options: (input.options ?? existing.options) as never,
          tags: input.tags ?? existing.tags,
          taxRateBps: input.taxRateBps !== undefined ? input.taxRateBps : existing.taxRateBps,
          hsnCode: input.hsnCode !== undefined ? input.hsnCode : existing.hsnCode,
          isFeatured: input.isFeatured ?? existing.isFeatured,
          metaTitle: input.metaTitle !== undefined ? input.metaTitle : existing.metaTitle,
          metaDescription:
            input.metaDescription !== undefined ? input.metaDescription : existing.metaDescription,
          priceFrom: liveVariants.length ? Math.min(...liveVariants.map((v) => v.price)) : 0,
          mrpFrom: liveVariants.length ? Math.min(...liveVariants.map((v) => v.mrp)) : 0,
          searchText: buildSearchText({
            name,
            shortDescription: input.shortDescription ?? existing.shortDescription,
            brandName: brand?.name,
            categoryName: category?.name,
            tags: input.tags ?? existing.tags,
            skus: liveVariants.map((v) => v.sku),
          }),
          publishedAt:
            status === 'PUBLISHED' ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
        },
      });

      return tx.product.findUniqueOrThrow({ where: { id }, include: PRODUCT_INCLUDE });
    });

    await this.cache.invalidateCatalog(tenantId);

    this.audit.record('tenant', {
      action: AuditAction.PRODUCT_UPDATED,
      resourceType: 'product',
      resourceId: id,
    });

    return mapProduct(product as never);
  }

  /**
   * Archive, not delete.
   *
   * Order lines hold a snapshot but still carry a `variantId` FK for reporting,
   * so a hard delete would either break those rows or silently orphan them.
   * Archiving hides the product everywhere a shopper can see it and keeps
   * history intact.
   */
  async archive(id: string): Promise<void> {
    const tenantId = this.tenantDb.tenantId;

    await this.tenantDb.transaction(async (tx) => {
      const product = await tx.product.findFirst({ where: { id, deletedAt: null } });
      if (!product) throw Errors.notFound('Product', id);

      await tx.product.update({
        where: { id },
        data: { status: 'ARCHIVED', deletedAt: new Date() },
      });
      await tx.productVariant.updateMany({
        where: { productId: id },
        data: { isActive: false },
      });
      // Pull it out of every live cart so nobody checks out an archived item.
      await tx.cartItem.deleteMany({ where: { variant: { productId: id } } });
    });

    await this.cache.invalidateCatalog(tenantId);
    this.audit.record('tenant', {
      action: AuditAction.PRODUCT_DELETED,
      resourceType: 'product',
      resourceId: id,
    });
  }

  async setPublished(id: string, publish: boolean): Promise<Product> {
    const tenantId = this.tenantDb.tenantId;

    const product = await this.tenantDb.run(async (db) => {
      const existing = await db.product.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw Errors.notFound('Product', id);

      if (publish) {
        const variants = await db.productVariant.count({
          where: { productId: id, deletedAt: null, isActive: true },
        });
        if (variants === 0) {
          throw Errors.badRequest('Add at least one active variant before publishing');
        }
      }

      return db.product.update({
        where: { id },
        data: {
          status: publish ? 'PUBLISHED' : 'DRAFT',
          publishedAt: publish ? (existing.publishedAt ?? new Date()) : existing.publishedAt,
        },
        include: PRODUCT_INCLUDE,
      });
    });

    await this.cache.invalidateCatalog(tenantId);
    return mapProduct(product as never);
  }

  // ========================================================== internals ==

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'product';
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? base : `${base}-${i + 1}`;
      const taken = await this.tenantDb.run((db) =>
        db.product.findUnique({ where: { slug: candidate }, select: { id: true } }),
      );
      if (!taken) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  private async assertRelationsExist(
    tx: TenantTransactionClient,
    categoryId?: string | null,
    brandId?: string | null,
  ): Promise<void> {
    if (categoryId) {
      const exists = await tx.category.findFirst({
        where: { id: categoryId, deletedAt: null },
        select: { id: true },
      });
      if (!exists) throw Errors.badRequest('The selected category does not exist');
    }
    if (brandId) {
      const exists = await tx.brand.findFirst({
        where: { id: brandId, deletedAt: null },
        select: { id: true },
      });
      if (!exists) throw Errors.badRequest('The selected brand does not exist');
    }
  }

  /** SKUs are unique per tenant; a clear message beats a raw unique-violation. */
  private async assertSkusAvailable(tx: TenantTransactionClient, skus: string[]): Promise<void> {
    if (skus.length === 0) return;
    const clash = await tx.productVariant.findFirst({
      where: { sku: { in: skus } },
      select: { sku: true },
    });
    if (clash) throw Errors.duplicate(`SKU ${clash.sku}`, 'SKU');
  }
}
