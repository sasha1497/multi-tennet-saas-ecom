import { Injectable } from '@nestjs/common';
import { cacheKeys } from '@retailos/config';
import {
  AuditAction,
  LimitKey,
  type PaginatedResult,
  type Product,
  type ProductImage,
  type ProductListItem,
} from '@retailos/types';
import {
  slugify,
  type AddProductImagesInput,
  type CreateProductInput,
  type ProductQueryInput,
  type ReorderProductImagesInput,
  type UpdateProductInput,
} from '@retailos/validation';
import { Errors } from '@/common/errors/app.exception';
import { buildOrderBy, escapeLike, normaliseSearch, paginate, toPrismaPage } from '@/common/utils/pagination';
import { AppConfigService } from '@/config/config.module';
import { CacheService } from '@/core/cache/cache.service';
import { RequestContextService } from '@/core/context/request-context';
import { TenantDatabaseService, type TenantTransactionClient } from '@/core/database/tenant-database.service';
import { AppLogger } from '@/core/logger/logger.service';
import { MediaUrlService } from '@/core/storage/media-url.service';
import { StorageService } from '@/core/storage/storage.service';
import { AuditService } from '@/modules/audit/audit.service';
import { EntitlementsService } from '@/modules/entitlements/entitlements.service';
import {
  buildSearchText,
  buildVariantLabel,
  mapImage,
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

/**
 * Primary image first, then gallery order.
 *
 * Declared out here rather than inline because the include below is `as const`,
 * which would freeze this into a readonly tuple — and Prisma's `orderBy` takes
 * a mutable array.
 */
const LIST_IMAGE_ORDER: ({ isPrimary: 'desc' } | { sortOrder: 'asc' })[] = [
  { isPrimary: 'desc' },
  { sortOrder: 'asc' },
];

/** Trimmed include for list views — avoids pulling descriptions for 20 rows. */
const LIST_INCLUDE = {
  category: { select: { id: true, name: true, slug: true } },
  brand: { select: { id: true, name: true, slug: true } },
  // Two, not one: the primary for every template, and the next one for the
  // templates whose cards cross-fade on hover. Ordered so the primary is
  // always first even when no image carries the flag.
  images: { orderBy: LIST_IMAGE_ORDER, take: 2 },
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
    private readonly storage: StorageService,
    private readonly media: MediaUrlService,
    logger: AppLogger,
  ) {
    this.logger = logger.withContext('ProductsService');
  }

  /**
   * A URL resolver covering every image on the rows about to be mapped.
   *
   * Built once per response rather than per image: on a private bucket each
   * image needs a presigned GET, and signing inside a `.map()` would mean one
   * await per product. See `MediaUrlService` for why the URLs it returns are
   * safe to put in the catalogue cache.
   */
  private imageUrls(rows: { images?: { objectKey?: string | null; url: string }[] }[]) {
    const refs = rows.flatMap((row) =>
      (row.images ?? []).map((image) => ({ objectKey: image.objectKey ?? null, url: image.url })),
    );
    return this.media.resolver(this.tenantDb.tenantId, refs);
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

    const resolveUrl = await this.imageUrls(rows as never);
    let items = rows.map((row) =>
      mapProductListItem(row as never, {
        includeAdminFields: scope === 'merchant',
        resolveUrl,
      }),
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
        return mapProduct(row as never, await this.imageUrls([row as never]));
      },
    );
  }

  /** Merchant view: any status, never cached (they need to see edits at once). */
  async findByIdForMerchant(id: string): Promise<Product> {
    const row = await this.tenantDb.run((db) =>
      db.product.findFirst({ where: { id, deletedAt: null }, include: PRODUCT_INCLUDE }),
    );
    if (!row) throw Errors.notFound('Product', id);
    return mapProduct(row as never, await this.imageUrls([row as never]));
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
        const resolveUrl = await this.imageUrls(rows as never);
        return rows.map((r) => mapProductListItem(r as never, { resolveUrl }));
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
        const resolveUrl = await this.imageUrls(rows as never);
        return rows.map((r) => mapProductListItem(r as never, { resolveUrl }));
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
    const resolveUrl = await this.imageUrls(rows as never);
    return rows.map((r) => mapProductListItem(r as never, { resolveUrl }));
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
    const resolveUrl = await this.imageUrls(rows as never);
    return rows.map((r) => mapProductListItem(r as never, { resolveUrl }));
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
          images: { create: this.buildImageRows(tenantId, input.images ?? []) },
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
    return mapProduct(product as never, await this.imageUrls([product as never]));
  }

  async update(id: string, input: UpdateProductInput): Promise<Product> {
    const tenantId = this.tenantDb.tenantId;
    /** Objects dropped from the gallery, swept once the transaction commits. */
    const orphanedKeys: string[] = [];

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
      // The payload is the complete gallery, so anything absent from it was
      // removed. The rows go first; the objects they referenced are collected
      // and swept after the transaction commits — deleting a file inside a
      // transaction that may still roll back would destroy a live image.
      if (input.images) {
        const kept = new Set(
          input.images.map((img) => img.objectKey).filter((k): k is string => Boolean(k)),
        );
        const existingImages = await tx.productImage.findMany({
          where: { productId: id },
          select: { objectKey: true },
        });
        for (const image of existingImages) {
          if (image.objectKey && !kept.has(image.objectKey)) orphanedKeys.push(image.objectKey);
        }

        await tx.productImage.deleteMany({ where: { productId: id } });
        if (input.images.length) {
          await tx.productImage.createMany({
            data: this.buildImageRows(tenantId, input.images).map((row) => ({ ...row, productId: id })),
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

    // Only now that the rows are committed: a file deleted before the commit
    // would be gone even if the transaction rolled back.
    await this.sweepObjects(tenantId, orphanedKeys);
    await this.cache.invalidateCatalog(tenantId);

    this.audit.record('tenant', {
      action: AuditAction.PRODUCT_UPDATED,
      resourceType: 'product',
      resourceId: id,
    });

    return mapProduct(product as never, await this.imageUrls([product as never]));
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
    return mapProduct(product as never, await this.imageUrls([product as never]));
  }

  // ============================================================ images ==

  /**
   * Appends already-uploaded objects to a product's gallery.
   *
   * The objects exist by this point — the client uploaded them straight to the
   * bucket with a presigned PUT and confirmed them — so this is purely the
   * database half. Ownership is checked twice over: the product must belong to
   * the acting tenant (the connection itself is that tenant's database), and
   * every key must sit under that tenant's prefix, which `buildImageRows`
   * enforces through `StorageService.publicUrl`.
   */
  async addImages(
    productId: string,
    images: AddProductImagesInput['images'],
  ): Promise<ProductImage[]> {
    const tenantId = this.tenantDb.tenantId;

    const rows = await this.tenantDb.transaction(async (tx) => {
      const product = await tx.product.findFirst({
        where: { id: productId, deletedAt: null },
        select: { id: true },
      });
      if (!product) throw Errors.notFound('Product', productId);

      const existing = await tx.productImage.findMany({
        where: { productId },
        select: { id: true, isPrimary: true },
        orderBy: { sortOrder: 'asc' },
      });

      if (existing.length + images.length > this.storage.maxFilesPerRequest) {
        throw Errors.badRequest(
          `A product can have at most ${this.storage.maxFilesPerRequest} images. ` +
            `This one already has ${existing.length}.`,
        );
      }

      // A gallery that already has a primary keeps it — appending an image is
      // not a request to re-crown the product's main photo.
      const hasPrimary = existing.some((i) => i.isPrimary);
      const built = this.buildImageRows(tenantId, images).map((row, index) => ({
        ...row,
        productId,
        sortOrder: existing.length + index,
        isPrimary: hasPrimary ? false : row.isPrimary,
      }));

      await tx.productImage.createMany({ data: built, skipDuplicates: true });

      return tx.productImage.findMany({
        where: { productId },
        orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }],
      });
    });

    await this.cache.invalidateCatalog(tenantId);
    const resolveUrl = await this.media.resolver(tenantId, rows);
    return rows.map((row) => mapImage(row, resolveUrl));
  }

  /**
   * Reorders a gallery and/or moves the primary flag.
   *
   * Takes the complete list of ids, so the operation is idempotent and a
   * dropped retry cannot leave a half-applied order. Ids that do not belong to
   * this product are rejected rather than ignored: silently discarding one
   * would reorder the gallery to something the merchant did not ask for.
   */
  async reorderImages(
    productId: string,
    input: ReorderProductImagesInput,
  ): Promise<ProductImage[]> {
    const tenantId = this.tenantDb.tenantId;

    const rows = await this.tenantDb.transaction(async (tx) => {
      const existing = await tx.productImage.findMany({
        where: { productId, product: { deletedAt: null } },
        select: { id: true },
      });
      if (existing.length === 0) throw Errors.notFound('Product', productId);

      const known = new Set(existing.map((i) => i.id));
      const unknown = input.imageIds.filter((id) => !known.has(id));
      if (unknown.length > 0) {
        throw Errors.badRequest('One or more images do not belong to this product');
      }
      if (input.imageIds.length !== existing.length) {
        throw Errors.badRequest(
          `Send every image id. This product has ${existing.length}; ${input.imageIds.length} were sent.`,
        );
      }
      if (input.primaryImageId && !known.has(input.primaryImageId)) {
        throw Errors.badRequest('The chosen primary image does not belong to this product');
      }

      const primaryId = input.primaryImageId ?? input.imageIds[0];
      for (const [index, id] of input.imageIds.entries()) {
        await tx.productImage.update({
          where: { id },
          data: { sortOrder: index, isPrimary: id === primaryId },
        });
      }

      return tx.productImage.findMany({
        where: { productId },
        orderBy: [{ sortOrder: 'asc' }],
      });
    });

    await this.cache.invalidateCatalog(tenantId);
    const resolveUrl = await this.media.resolver(tenantId, rows);
    return rows.map((row) => mapImage(row, resolveUrl));
  }

  /**
   * Removes one image from a product, and its object from the bucket.
   *
   * The row goes inside the transaction and the file goes after it commits —
   * the same ordering as everywhere else, for the same reason. Removing the
   * primary promotes the next image rather than leaving the product with no
   * main photo.
   */
  async deleteImage(productId: string, imageId: string): Promise<void> {
    const tenantId = this.tenantDb.tenantId;

    const removedKey = await this.tenantDb.transaction(async (tx) => {
      const image = await tx.productImage.findFirst({
        // Scoped by productId as well as id: an image id from another product
        // (or another merchant's console) must not resolve to a delete.
        where: { id: imageId, productId, product: { deletedAt: null } },
      });
      if (!image) throw Errors.notFound('Product image', imageId);

      await tx.productImage.delete({ where: { id: imageId } });

      if (image.isPrimary) {
        const next = await tx.productImage.findFirst({
          where: { productId },
          orderBy: { sortOrder: 'asc' },
        });
        if (next) {
          await tx.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
        }
      }

      return image.objectKey;
    });

    if (removedKey) await this.sweepObjects(tenantId, [removedKey]);
    await this.cache.invalidateCatalog(tenantId);

    this.audit.record('tenant', {
      action: AuditAction.PRODUCT_UPDATED,
      resourceType: 'product',
      resourceId: productId,
      metadata: { imageDeleted: imageId },
    });
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

  /**
   * Removes objects whose rows are already gone.
   *
   * Always after the commit, never inside it: a rolled-back transaction that
   * had already deleted the file would leave a live image pointing at nothing.
   * The reverse order — a deleted row whose file survives — costs storage and
   * is recoverable, so that is the failure this leans towards.
   */
  private async sweepObjects(tenantId: string, keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    try {
      await this.storage.deleteMany(tenantId, keys);
      this.media.forget(keys);
    } catch (err) {
      this.logger.warn('Could not remove orphaned product objects', {
        tenantId,
        count: keys.length,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Turns image inputs into rows.
   *
   * Three invariants, all enforced here rather than trusted from the client:
   * positions come from the payload's own order (or an explicit `sortOrder`),
   * **exactly one** image is primary — the one flagged, or the first — and
   * every row carries a usable `url` even when the client only sent a key.
   *
   * The stored `url` is deliberately the object's *canonical* address, never a
   * presigned one: it is a durable column, and a signature that expires in
   * fifteen minutes has no business in it. Presigned previews are minted at
   * read time by `MediaUrlService`.
   */
  private buildImageRows(
    tenantId: string,
    images: readonly {
      url?: string;
      objectKey?: string;
      alt?: string | null;
      fileName?: string | null;
      mimeType?: string | null;
      size?: number | null;
      sortOrder?: number;
      isPrimary?: boolean;
    }[],
  ) {
    const flagged = images.findIndex((img) => img.isPrimary);
    const primaryIndex = flagged === -1 ? 0 : flagged;

    return images.map((img, index) => ({
      // One of the two is guaranteed present by `productImageInputSchema`;
      // `publicUrl` also re-checks that the key belongs to this tenant.
      url: img.objectKey ? this.storage.publicUrl(tenantId, img.objectKey) : img.url!,
      objectKey: img.objectKey ?? null,
      bucket: img.objectKey ? this.storage.bucket : null,
      alt: img.alt ?? null,
      fileName: img.fileName ?? null,
      mimeType: img.mimeType ?? null,
      sizeBytes: img.size ?? null,
      sortOrder: img.sortOrder ?? index,
      isPrimary: index === primaryIndex,
    }));
  }
}
