import type { ProductSource, TemplateSection } from '@retailos/templates';
import type {
  Brand,
  CategoryTreeNode,
  Coupon,
  ProductListItem,
  StorefrontBootstrap,
  StoreSettings,
} from '@retailos/types';
import { serverApi } from '@/lib/server-api';

/**
 * Everything a home page's sections read.
 *
 * This is the seam the whole architecture turns on: templates receive store
 * data, they never hold it. `ProductRow` is handed `ProductListItem[]` and
 * renders it — it has no idea which template it is in, and no template has its
 * own copy of a product.
 */
export interface SectionData {
  store: StoreSettings;
  tenant: StorefrontBootstrap['tenant'];
  categories: CategoryTreeNode[];
  brands: Brand[];
  coupons: Coupon[];
  products: Record<ProductSource, ProductListItem[]>;
  /**
   * Whether 3D variants may upgrade to WebGL on this render: the store is
   * entitled to the 3D family, or the merchant is previewing a design. A 3D
   * template on a store without it renders its 2D composition — which is what
   * keeps a downgrade from breaking or removing anything.
   */
  allow3d: boolean;
}

/**
 * Fetches exactly what the resolved sections ask for, and nothing else.
 *
 * A template that shows no brand strip does not pay for a brands request; a
 * template with three product rows fetches each list once no matter how many
 * rows read it. Every call runs in parallel and every failure degrades to an
 * empty list — one slow endpoint must not take the whole shop offline.
 */
export async function loadSectionData(
  bootstrap: StorefrontBootstrap,
  sections: readonly TemplateSection[],
  options: { isPreview?: boolean } = {},
): Promise<SectionData> {
  const api = serverApi();

  const kinds = new Set(sections.map((s) => s.kind));
  const sources = new Set(
    sections.filter((s) => s.kind === 'productRow' && s.source).map((s) => s.source!),
  );
  // A 3D opening is built from product photographs, so it needs a product list
  // even when the merchant has hidden every product row.
  if (sections.some((s) => s.kind === 'hero' && s.variant.endsWith('3d'))) {
    sources.add('featured');
    sources.add('newest');
  }

  // The largest limit any row asks for, so one request serves them all.
  const limitFor = (source: ProductSource) =>
    Math.max(
      ...sections
        .filter((s) => s.kind === 'productRow' && s.source === source)
        .map((s) => s.limit ?? 8),
      8,
    );

  const [featured, popular, newest, brands, coupons] = await Promise.all([
    sources.has('featured')
      ? api.storefront.featuredProducts(limitFor('featured')).catch(() => [])
      : Promise.resolve([]),
    sources.has('popular')
      ? api.storefront.popularProducts(limitFor('popular')).catch(() => [])
      : Promise.resolve([]),
    sources.has('newest')
      ? api.storefront
          // `newest` is a presentation idea; the API sorts on `createdAt`.
          .products({ limit: limitFor('newest'), sortBy: 'createdAt', sortOrder: 'desc' })
          .then((page) => page.items)
          .catch(() => [])
      : Promise.resolve([]),
    kinds.has('brands') ? api.storefront.brands().catch(() => []) : Promise.resolve([]),
    kinds.has('offers') ? api.storefront.availableCoupons().catch(() => []) : Promise.resolve([]),
  ]);

  return {
    store: bootstrap.store,
    tenant: bootstrap.tenant,
    categories: bootstrap.categories,
    brands,
    coupons,
    products: { featured, popular, newest },
    allow3d: bootstrap.features.templates_3d === true || options.isPreview === true,
  };
}

/** The active banner a hero or promotional section should use. */
export function primaryBanner(store: StoreSettings) {
  return store.banners.find((b) => b.isActive) ?? store.banners[0] ?? null;
}

/** A secondary banner for templates that show two, falling back to the first. */
export function secondaryBanner(store: StoreSettings) {
  const active = store.banners.filter((b) => b.isActive);
  return active[1] ?? active[0] ?? store.banners[1] ?? null;
}
