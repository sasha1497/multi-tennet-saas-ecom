import { Money, PaginationQuery } from './common';
import { ProductStatus } from './enums';

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  imageUrl: string | null;
  iconName: string | null;
  parentId: string | null;
  sortOrder: number;
  isActive: boolean;
  productCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface CategoryTreeNode extends Category {
  children: CategoryTreeNode[];
}

export interface Brand {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  logoUrl: string | null;
  isActive: boolean;
  productCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProductImage {
  id: string;
  url: string;
  alt: string | null;
  sortOrder: number;
  isPrimary: boolean;
}

/** A single option axis, e.g. `Size: [7, 8, 9]`. */
export interface ProductOption {
  name: string;
  values: string[];
}

export interface ProductVariant {
  id: string;
  productId: string;
  sku: string;
  barcode: string | null;
  /** Selected value per option axis, e.g. `{ Size: "9", Color: "Black" }`. */
  options: Record<string, string>;
  /** Human label built from `options`, e.g. "9 / Black". */
  label: string;
  /** Selling price, minor units. */
  price: Money;
  /** Maximum retail price (strike-through), minor units. */
  mrp: Money;
  imageUrl: string | null;
  weightGrams: number | null;
  isActive: boolean;
  /** Denormalised from the inventory record for list rendering. */
  stock: VariantStock;
  createdAt: string;
  updatedAt: string;
}

export interface VariantStock {
  quantity: number;
  reserved: number;
  available: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  inStock: boolean;
}

export interface Product {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  shortDescription: string | null;
  status: ProductStatus;

  categoryId: string | null;
  category?: Pick<Category, 'id' | 'name' | 'slug'> | null;
  brandId: string | null;
  brand?: Pick<Brand, 'id' | 'name' | 'slug'> | null;

  images: ProductImage[];
  options: ProductOption[];
  variants: ProductVariant[];

  /** Cheapest active variant price — what the card shows. */
  priceFrom: Money;
  mrpFrom: Money;
  /** Percentage off, derived from `priceFrom` vs `mrpFrom`. 0 when no discount. */
  discountPercent: number;

  /** Basis points; null means fall back to the store default. */
  taxRateBps: number | null;
  hsnCode: string | null;

  isFeatured: boolean;
  ratingAverage: number;
  ratingCount: number;
  soldCount: number;

  totalStock: number;
  inStock: boolean;

  metaTitle: string | null;
  metaDescription: string | null;
  tags: string[];

  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** Trimmed shape used by grids, search results and mobile lists. */
export interface ProductListItem {
  id: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  primaryImageUrl: string | null;
  priceFrom: Money;
  mrpFrom: Money;
  discountPercent: number;
  ratingAverage: number;
  ratingCount: number;
  inStock: boolean;
  isFeatured: boolean;
  brandName: string | null;
  categoryName: string | null;
  status?: ProductStatus;
  totalStock?: number;
}

export interface ProductQuery extends PaginationQuery {
  categoryId?: string;
  categorySlug?: string;
  brandId?: string;
  status?: ProductStatus;
  isFeatured?: boolean;
  inStock?: boolean;
  minPrice?: number;
  maxPrice?: number;
  tags?: string[];
  lowStockOnly?: boolean;
  cursor?: string;
}

// ---------------------------------------------------------------- requests --

export interface UpsertVariantRequest {
  id?: string;
  sku: string;
  barcode?: string | null;
  options: Record<string, string>;
  price: Money;
  mrp: Money;
  imageUrl?: string | null;
  weightGrams?: number | null;
  isActive?: boolean;
  /** Only honoured on create; later changes go through the inventory module. */
  initialStock?: number;
  lowStockThreshold?: number;
}

export interface CreateProductRequest {
  name: string;
  description?: string | null;
  shortDescription?: string | null;
  status?: ProductStatus;
  categoryId?: string | null;
  brandId?: string | null;
  images?: { url: string; alt?: string | null; isPrimary?: boolean }[];
  options?: ProductOption[];
  variants: UpsertVariantRequest[];
  taxRateBps?: number | null;
  hsnCode?: string | null;
  isFeatured?: boolean;
  metaTitle?: string | null;
  metaDescription?: string | null;
  tags?: string[];
}

export interface UpdateProductRequest extends Partial<CreateProductRequest> {}

export interface CreateCategoryRequest {
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  iconName?: string | null;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

export interface CreateBrandRequest {
  name: string;
  description?: string | null;
  logoUrl?: string | null;
  isActive?: boolean;
}

export interface Review {
  id: string;
  productId: string;
  customerId: string;
  customerName: string;
  orderId: string | null;
  rating: number;
  title: string | null;
  comment: string | null;
  isApproved: boolean;
  isVerifiedPurchase: boolean;
  createdAt: string;
}

export interface CreateReviewRequest {
  productId: string;
  rating: number;
  title?: string | null;
  comment?: string | null;
  orderId?: string | null;
}
