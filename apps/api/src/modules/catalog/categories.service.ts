import { Injectable } from '@nestjs/common';
import { cacheKeys } from '@retailos/config';
import type { Brand, Category, CategoryTreeNode } from '@retailos/types';
import { slugify } from '@retailos/validation';
import { Errors } from '@/common/errors/app.exception';
import { AppConfigService } from '@/config/config.module';
import { CacheService } from '@/core/cache/cache.service';
import { TenantDatabaseService } from '@/core/database/tenant-database.service';
import { buildCategoryTree, mapBrand, mapCategory } from './catalog.mapper';

export interface CategoryInput {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  iconName?: string | null;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface BrandInput {
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  isActive?: boolean;
}

@Injectable()
export class CategoriesService {
  constructor(
    private readonly tenantDb: TenantDatabaseService,
    private readonly cache: CacheService,
    private readonly config: AppConfigService,
  ) {}

  /** Nested, active-only tree for the storefront navigation. Cached. */
  async tree(): Promise<CategoryTreeNode[]> {
    const tenantId = this.tenantDb.tenantId;
    return this.cache.remember(
      cacheKeys.categoryTree(tenantId),
      this.config.redis.ttl.catalog,
      async () => {
        const rows = await this.tenantDb.run((db) =>
          db.category.findMany({
            where: { isActive: true, deletedAt: null },
            orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
            include: {
              _count: { select: { products: { where: { status: 'PUBLISHED', deletedAt: null } } } },
            },
          }),
        );
        return buildCategoryTree(rows.map((r) => mapCategory(r, r._count.products)));
      },
    );
  }

  /** Flat list including inactive categories — the merchant's management view. */
  async listAll(): Promise<Category[]> {
    const rows = await this.tenantDb.run((db) =>
      db.category.findMany({
        where: { deletedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { products: { where: { deletedAt: null } } } } },
      }),
    );
    return rows.map((r) => mapCategory(r, r._count.products));
  }

  async create(input: CategoryInput): Promise<Category> {
    const slug = await this.uniqueSlug(input.name);

    if (input.parentId) await this.assertCategoryExists(input.parentId);

    const row = await this.tenantDb.run((db) =>
      db.category.create({
        data: {
          name: input.name.trim(),
          slug,
          description: input.description ?? null,
          imageUrl: input.imageUrl ?? null,
          iconName: input.iconName ?? null,
          parentId: input.parentId ?? null,
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
        },
      }),
    );

    await this.invalidate();
    return mapCategory(row);
  }

  async update(id: string, input: Partial<CategoryInput>): Promise<Category> {
    const existing = await this.assertCategoryExists(id);

    if (input.parentId) {
      if (input.parentId === id) throw Errors.badRequest('A category cannot be its own parent');
      await this.assertCategoryExists(input.parentId);
      // Walking up the chain is what stops A→B→A cycles, which would make the
      // tree builder recurse forever.
      await this.assertNoCycle(id, input.parentId);
    }

    const row = await this.tenantDb.run((db) =>
      db.category.update({
        where: { id },
        data: {
          name: input.name?.trim() ?? existing.name,
          description: input.description !== undefined ? input.description : existing.description,
          imageUrl: input.imageUrl !== undefined ? input.imageUrl : existing.imageUrl,
          iconName: input.iconName !== undefined ? input.iconName : existing.iconName,
          parentId: input.parentId !== undefined ? input.parentId : existing.parentId,
          sortOrder: input.sortOrder ?? existing.sortOrder,
          isActive: input.isActive ?? existing.isActive,
        },
      }),
    );

    await this.invalidate();
    return mapCategory(row);
  }

  /**
   * Soft-deletes a category. Its products are detached rather than deleted —
   * losing a category must never lose the merchant's catalog.
   */
  async remove(id: string): Promise<void> {
    await this.assertCategoryExists(id);

    await this.tenantDb.transaction(async (tx) => {
      await tx.category.updateMany({ where: { parentId: id }, data: { parentId: null } });
      await tx.product.updateMany({ where: { categoryId: id }, data: { categoryId: null } });
      await tx.category.update({
        where: { id },
        data: { deletedAt: new Date(), isActive: false },
      });
    });

    await this.invalidate();
  }

  // --------------------------------------------------------------- brands --

  async listBrands(includeInactive = false): Promise<Brand[]> {
    const tenantId = this.tenantDb.tenantId;

    if (includeInactive) {
      const rows = await this.tenantDb.run((db) =>
        db.brand.findMany({
          where: { deletedAt: null },
          orderBy: { name: 'asc' },
          include: { _count: { select: { products: { where: { deletedAt: null } } } } },
        }),
      );
      return rows.map((r) => mapBrand(r, r._count.products));
    }

    return this.cache.remember(cacheKeys.brands(tenantId), this.config.redis.ttl.catalog, async () => {
      const rows = await this.tenantDb.run((db) =>
        db.brand.findMany({
          where: { isActive: true, deletedAt: null },
          orderBy: { name: 'asc' },
          include: {
            _count: { select: { products: { where: { status: 'PUBLISHED', deletedAt: null } } } },
          },
        }),
      );
      return rows.map((r) => mapBrand(r, r._count.products));
    });
  }

  async createBrand(input: BrandInput): Promise<Brand> {
    const slug = await this.uniqueBrandSlug(input.name);
    const row = await this.tenantDb.run((db) =>
      db.brand.create({
        data: {
          name: input.name.trim(),
          slug,
          description: input.description ?? null,
          logoUrl: input.logoUrl ?? null,
          isActive: input.isActive ?? true,
        },
      }),
    );
    await this.invalidate();
    return mapBrand(row);
  }

  async updateBrand(id: string, input: Partial<BrandInput>): Promise<Brand> {
    const existing = await this.tenantDb.run((db) =>
      db.brand.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw Errors.notFound('Brand', id);

    const row = await this.tenantDb.run((db) =>
      db.brand.update({
        where: { id },
        data: {
          name: input.name?.trim() ?? existing.name,
          description: input.description !== undefined ? input.description : existing.description,
          logoUrl: input.logoUrl !== undefined ? input.logoUrl : existing.logoUrl,
          isActive: input.isActive ?? existing.isActive,
        },
      }),
    );
    await this.invalidate();
    return mapBrand(row);
  }

  async removeBrand(id: string): Promise<void> {
    const existing = await this.tenantDb.run((db) =>
      db.brand.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!existing) throw Errors.notFound('Brand', id);

    await this.tenantDb.transaction(async (tx) => {
      await tx.product.updateMany({ where: { brandId: id }, data: { brandId: null } });
      await tx.brand.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
    });
    await this.invalidate();
  }

  // ------------------------------------------------------------ internals --

  private async invalidate(): Promise<void> {
    await this.cache.invalidateCatalog(this.tenantDb.tenantId);
  }

  private async assertCategoryExists(id: string) {
    const row = await this.tenantDb.run((db) =>
      db.category.findFirst({ where: { id, deletedAt: null } }),
    );
    if (!row) throw Errors.notFound('Category', id);
    return row;
  }

  private async assertNoCycle(id: string, parentId: string): Promise<void> {
    let cursor: string | null = parentId;
    for (let depth = 0; cursor && depth < 20; depth++) {
      if (cursor === id) throw Errors.badRequest('That would create a circular category structure');
      const parent: { parentId: string | null } | null = await this.tenantDb.run((db) =>
        db.category.findUnique({ where: { id: cursor! }, select: { parentId: true } }),
      );
      cursor = parent?.parentId ?? null;
    }
  }

  private async uniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'category';
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? base : `${base}-${i + 1}`;
      const taken = await this.tenantDb.run((db) =>
        db.category.findUnique({ where: { slug: candidate }, select: { id: true } }),
      );
      if (!taken) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }

  private async uniqueBrandSlug(name: string): Promise<string> {
    const base = slugify(name) || 'brand';
    for (let i = 0; i < 50; i++) {
      const candidate = i === 0 ? base : `${base}-${i + 1}`;
      const taken = await this.tenantDb.run((db) =>
        db.brand.findUnique({ where: { slug: candidate }, select: { id: true } }),
      );
      if (!taken) return candidate;
    }
    return `${base}-${Date.now().toString(36)}`;
  }
}
