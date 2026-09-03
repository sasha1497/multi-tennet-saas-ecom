import { discountPercent } from '@retailos/config';
import type {
  Brand,
  Category,
  CategoryTreeNode,
  Product,
  ProductImage,
  ProductListItem,
  ProductOption,
  ProductStatus,
  ProductVariant,
  VariantStock,
} from '@retailos/types';

/**
 * Database rows → API shapes.
 *
 * Kept as pure functions in one file so the wire format is defined in exactly
 * one place. Anything not listed here (internal counters, soft-delete markers)
 * simply never reaches a client.
 */

type VariantRow = {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  options: unknown;
  label: string;
  price: number;
  mrp: number;
  imageUrl: string | null;
  weightGrams: number | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  inventory?: {
    quantity: number;
    reserved: number;
    lowStockThreshold: number;
  } | null;
};

export function mapVariantStock(
  inventory: { quantity: number; reserved: number; lowStockThreshold: number } | null | undefined,
): VariantStock {
  const quantity = inventory?.quantity ?? 0;
  const reserved = inventory?.reserved ?? 0;
  const available = Math.max(0, quantity - reserved);
  const lowStockThreshold = inventory?.lowStockThreshold ?? 0;
  return {
    quantity,
    reserved,
    available,
    lowStockThreshold,
    isLowStock: available > 0 && available <= lowStockThreshold,
    inStock: available > 0,
  };
}

export function mapVariant(row: VariantRow): ProductVariant {
  return {
    id: row.id,
    productId: row.productId,
    sku: row.sku,
    barcode: row.barcode,
    options: (row.options ?? {}) as Record<string, string>,
    label: row.label,
    price: row.price,
    mrp: row.mrp,
    imageUrl: row.imageUrl,
    weightGrams: row.weightGrams,
    isActive: row.isActive,
    stock: mapVariantStock(row.inventory),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function mapImage(row: {
  id: string;
  url: string;
  alt: string | null;
  sortOrder: number;
  isPrimary: boolean;
}): ProductImage {
  return {
    id: row.id,
    url: row.url,
    alt: row.alt,
    sortOrder: row.sortOrder,
    isPrimary: row.isPrimary,
  };
}

export function mapCategory(
  row: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    imageUrl: string | null;
    iconName: string | null;
    parentId: string | null;
    sortOrder: number;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  productCount?: number,
): Category {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    imageUrl: row.imageUrl,
    iconName: row.iconName,
    parentId: row.parentId,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    productCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Flat list → nested tree. Orphans (parent filtered out) surface at the root. */
export function buildCategoryTree(categories: Category[]): CategoryTreeNode[] {
  const nodes = new Map<string, CategoryTreeNode>();
  for (const c of categories) nodes.set(c.id, { ...c, children: [] });

  const roots: CategoryTreeNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (list: CategoryTreeNode[]) => {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);

  return roots;
}

export function mapBrand(
  row: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logoUrl: string | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
  },
  productCount?: number,
): Brand {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    logoUrl: row.logoUrl,
    isActive: row.isActive,
    productCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type ProductRow = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  shortDescription: string | null;
  status: string;
  categoryId: string | null;
  brandId: string | null;
  options: unknown;
  tags: string[];
  taxRateBps: number | null;
  hsnCode: string | null;
  isFeatured: boolean;
  priceFrom: number;
  mrpFrom: number;
  ratingAverage: number;
  ratingCount: number;
  soldCount: number;
  metaTitle: string | null;
  metaDescription: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  category?: { id: string; name: string; slug: string } | null;
  brand?: { id: string; name: string; slug: string } | null;
  images?: { id: string; url: string; alt: string | null; sortOrder: number; isPrimary: boolean }[];
  variants?: VariantRow[];
};

export function mapProduct(row: ProductRow): Product {
  const variants = (row.variants ?? []).map(mapVariant);
  const totalStock = variants.reduce((sum, v) => sum + v.stock.available, 0);

  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    shortDescription: row.shortDescription,
    status: row.status as ProductStatus,
    categoryId: row.categoryId,
    category: row.category ?? null,
    brandId: row.brandId,
    brand: row.brand ?? null,
    images: (row.images ?? []).map(mapImage).sort((a, b) => a.sortOrder - b.sortOrder),
    options: (row.options ?? []) as ProductOption[],
    variants,
    priceFrom: row.priceFrom,
    mrpFrom: row.mrpFrom,
    discountPercent: discountPercent(row.priceFrom, row.mrpFrom),
    taxRateBps: row.taxRateBps,
    hsnCode: row.hsnCode,
    isFeatured: row.isFeatured,
    ratingAverage: Math.round(row.ratingAverage * 10) / 10,
    ratingCount: row.ratingCount,
    soldCount: row.soldCount,
    totalStock,
    inStock: totalStock > 0,
    metaTitle: row.metaTitle,
    metaDescription: row.metaDescription,
    tags: row.tags ?? [],
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  };
}

/**
 * The trimmed shape used by grids and search.
 *
 * `includeAdminFields` adds status and stock, which merchants need in their
 * table but which must not appear on the public storefront — a shopper has no
 * business knowing a product is a draft, or exactly how many units are left.
 */
export function mapProductListItem(
  row: ProductRow & { _count?: { variants: number } },
  options: { includeAdminFields?: boolean } = {},
): ProductListItem {
  const images = row.images ?? [];
  const primary = images.find((i) => i.isPrimary) ?? images[0];
  const totalStock = (row.variants ?? []).reduce(
    (sum, v) => sum + Math.max(0, (v.inventory?.quantity ?? 0) - (v.inventory?.reserved ?? 0)),
    0,
  );

  const item: ProductListItem = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    shortDescription: row.shortDescription,
    primaryImageUrl: primary?.url ?? null,
    priceFrom: row.priceFrom,
    mrpFrom: row.mrpFrom,
    discountPercent: discountPercent(row.priceFrom, row.mrpFrom),
    ratingAverage: Math.round(row.ratingAverage * 10) / 10,
    ratingCount: row.ratingCount,
    inStock: totalStock > 0,
    isFeatured: row.isFeatured,
    brandName: row.brand?.name ?? null,
    categoryName: row.category?.name ?? null,
  };

  if (options.includeAdminFields) {
    item.status = row.status as ProductStatus;
    item.totalStock = totalStock;
  }

  return item;
}

/** Renders a variant's option map into a display label: `{Size:9,Color:Black}` → `9 / Black`. */
export function buildVariantLabel(
  options: Record<string, string>,
  optionOrder?: ProductOption[],
): string {
  const keys = optionOrder?.length ? optionOrder.map((o) => o.name) : Object.keys(options);
  const parts = keys.map((k) => options[k]).filter(Boolean);
  return parts.length ? parts.join(' / ') : 'Default';
}

/** The blob backing trigram search: name, brand, category, tags and SKUs. */
export function buildSearchText(parts: {
  name: string;
  shortDescription?: string | null;
  brandName?: string | null;
  categoryName?: string | null;
  tags?: string[];
  skus?: string[];
}): string {
  return [
    parts.name,
    parts.shortDescription ?? '',
    parts.brandName ?? '',
    parts.categoryName ?? '',
    ...(parts.tags ?? []),
    ...(parts.skus ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
    .slice(0, 2000);
}
