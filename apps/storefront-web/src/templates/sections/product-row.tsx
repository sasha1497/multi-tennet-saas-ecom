import Link from 'next/link';
import type { TemplateSection } from '@retailos/templates';
import type { ProductListItem } from '@retailos/types';
import { ProductCard } from '../components/product-card';
import { Section, SectionHeading } from '../components/section';
import type { SectionData } from '../data';

/**
 * A titled set of products.
 *
 * The clearest illustration of the data/presentation split in the codebase:
 * this component receives `ProductListItem[]` and knows nothing else. Four
 * layouts, one input, zero duplication — a store's hundred products render in
 * whichever design is active without anything being copied or converted.
 */
export function ProductRowSection({
  section,
  data,
}: {
  section: TemplateSection;
  data: SectionData;
}) {
  const source = section.source ?? 'featured';
  const products = data.products[source].slice(0, section.limit ?? 8);

  // Empty rows are dropped rather than rendered as a heading over nothing — a
  // new store's home page should look sparse, not broken.
  if (products.length === 0) return null;

  const href = LIST_HREF[source];
  const currency = data.store.currency;
  const title = section.title ?? DEFAULT_TITLE[source];

  switch (section.variant) {
    // ── Editorial row: horizontal scroll on phones, wide cards. ────────────
    case 'editorialRow':
      return (
        <Section>
          <SectionHeading title={title} subtitle={section.subtitle} href={href} />
          <ul className="scroll-slim -mx-4 flex snap-x gap-4 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 lg:grid-cols-4">
            {products.map((product, i) => (
              <li key={product.id} className="w-[62%] shrink-0 snap-start sm:w-auto">
                <ProductCard product={product} currency={currency} priority={i < 2} />
              </li>
            ))}
          </ul>
        </Section>
      );

    // ── Editorial grid: a full block, no scrolling. ────────────────────────
    case 'editorialGrid':
      return (
        <Section tone="muted">
          <SectionHeading title={title} subtitle={section.subtitle} href={href} />
          <div className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} currency={currency} />
            ))}
          </div>
        </Section>
      );

    // ── Gallery: centred heading, three across, lots of air. ───────────────
    case 'gallery':
      return (
        <Section>
          <SectionHeading
            title={title}
            subtitle={section.subtitle}
            align="center"
            rule
            href={href}
            linkLabel="See the full edit"
          />
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-3">
            {products.map((product) => (
              <ProductCard key={product.id} product={product} currency={currency} />
            ))}
          </div>
        </Section>
      );

    // ── Dense grid: maximum products per screen. ───────────────────────────
    case 'denseGrid':
    default:
      return (
        <Section>
          <SectionHeading title={title} subtitle={section.subtitle} href={href} />
          <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {products.map((product) => (
              <li key={product.id}>
                <ProductCard product={product} currency={currency} />
              </li>
            ))}
          </ul>
        </Section>
      );
  }
}

const LIST_HREF: Record<string, string> = {
  featured: '/products?featured=true',
  popular: '/products?sortBy=soldCount&sortOrder=desc',
  newest: '/products?sortBy=createdAt&sortOrder=desc',
};

const DEFAULT_TITLE: Record<string, string> = {
  featured: 'Featured',
  popular: 'Best sellers',
  newest: 'New arrivals',
};

/**
 * Shown in place of every product row when a store has nothing published yet.
 *
 * Rendered once by the page rather than once per row, so an empty store gets a
 * single honest message instead of a stack of them.
 */
export function EmptyCatalogue({ storeName }: { storeName: string }) {
  return (
    <Section>
      <div className="mx-auto max-w-md rounded-[var(--radius)] border border-dashed border-line bg-surface px-6 py-14 text-center">
        <h2 className="heading text-xl text-content">{storeName} is just getting started</h2>
        <p className="mt-2 text-sm text-content-muted">
          Products will appear here as soon as the shop adds them. Do come back.
        </p>
        <Link
          href="/products"
          className="mt-6 inline-flex h-10 items-center rounded-[var(--radius)] border border-line px-5 text-sm font-medium text-content transition hover:border-primary hover:text-primary"
        >
          Browse the catalogue
        </Link>
      </div>
    </Section>
  );
}

/** True when the store has no products at all across every source. */
export function catalogueIsEmpty(products: Record<string, ProductListItem[]>): boolean {
  return Object.values(products).every((list) => list.length === 0);
}
