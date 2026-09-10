import Link from 'next/link';
import type { TemplateSection } from '@retailos/templates';
import type { ProductListItem } from '@retailos/types';
import { ProductCard } from '../components/product-card';
import { Section, SectionHeading } from '../components/section';
import type { SectionData } from '../data';
import { Reveal, RevealGroup } from '../motion';

/**
 * A titled set of products.
 *
 * The clearest illustration of the data/presentation split in the codebase:
 * this component receives `ProductListItem[]` and knows nothing else. Ten
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
          <RevealGroup className="grid grid-cols-2 gap-x-4 gap-y-8 lg:grid-cols-4" step={60}>
            {products.map((product) => (
              <ProductCard key={product.id} product={product} currency={currency} />
            ))}
          </RevealGroup>
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
          <RevealGroup className="grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-3" step={80}>
            {products.map((product) => (
              <ProductCard key={product.id} product={product} currency={currency} />
            ))}
          </RevealGroup>
        </Section>
      );

    // ── Asymmetric: one hero product against a column of small ones. The
    //    magazine block. Urban Luxe, Atelier Noir, Maison. ─────────────────
    case 'asymmetric': {
      const [lead, ...rest] = products;
      return (
        <Section>
          <SectionHeading title={title} subtitle={section.subtitle} href={href} />
          <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr] lg:gap-8">
            <Reveal>
              {/* The lead product gets a taller frame than the grid's own
                  aspect, which is what breaks the rhythm rather than simply
                  making one card bigger. */}
              <ProductCard product={lead} currency={currency} priority className="h-full" />
            </Reveal>
            {rest.length > 0 && (
              <RevealGroup
                as="ul"
                className="grid grid-cols-2 gap-4 self-start sm:grid-cols-3 lg:grid-cols-2"
                step={70}
              >
                {rest.slice(0, 6).map((product) => (
                  <ProductCard key={product.id} product={product} currency={currency} />
                ))}
              </RevealGroup>
            )}
          </div>
        </Section>
      );
    }

    // ── Soft grid: rounded cards, generous gutters. Glow, Pawsome. ─────────
    case 'softGrid':
      return (
        <Section>
          <SectionHeading title={title} subtitle={section.subtitle} href={href} />
          <RevealGroup
            as="ul"
            className="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4"
            step={55}
          >
            {products.map((product, i) => (
              <ProductCard
                key={product.id}
                product={product}
                currency={currency}
                priority={i < 2}
              />
            ))}
          </RevealGroup>
        </Section>
      );

    // ── Parade: a scrolling rail on every size, with the shop's own rhythm.
    //    Pawsome and Companion Club. ────────────────────────────────────────
    case 'parade':
      return (
        <Section bleed>
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
            <SectionHeading title={title} subtitle={section.subtitle} href={href} />
          </div>
          <ul className="scroll-slim flex snap-x gap-4 overflow-x-auto px-4 pb-3 sm:px-6 lg:justify-start">
            {products.map((product, i) => (
              <li
                key={product.id}
                className="w-[58%] shrink-0 snap-start sm:w-[34%] lg:w-[23%] xl:w-[19%]"
              >
                <Reveal delay={Math.min(i, 5) * 60}>
                  <ProductCard product={product} currency={currency} priority={i < 2} />
                </Reveal>
              </li>
            ))}
          </ul>
        </Section>
      );

    // ── Shelf: maximum products per screen, tight gutters, price forward.
    //    Daily Cart. ────────────────────────────────────────────────────────
    case 'shelf':
      return (
        <Section>
          <SectionHeading title={title} subtitle={section.subtitle} href={href} />
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {products.map((product, i) => (
              <li key={product.id}>
                <ProductCard product={product} currency={currency} priority={i < 3} />
              </li>
            ))}
          </ul>
        </Section>
      );

    // ── Compare: products lined up so their specs read across. Spec Grid,
    //    Lumen. Scrolls on a phone rather than stacking, because the whole
    //    point is seeing them beside each other. ─────────────────────────────
    case 'compare':
      return (
        <Section tone="muted" bleed>
          <div className="mx-auto w-full max-w-7xl px-4 sm:px-6">
            <SectionHeading
              title={title}
              subtitle={section.subtitle}
              href={href}
              linkLabel="Compare all"
            />
          </div>
          <ul className="scroll-slim flex snap-x items-stretch gap-3 overflow-x-auto px-4 pb-3 sm:px-6">
            {products.map((product, i) => (
              <li
                key={product.id}
                className="w-[62%] shrink-0 snap-start sm:w-[38%] lg:w-[25%] xl:w-[20%]"
              >
                <Reveal delay={Math.min(i, 5) * 60}>
                  <ProductCard
                    product={product}
                    currency={currency}
                    variant="spec"
                    priority={i < 2}
                    className="h-full"
                  />
                </Reveal>
              </li>
            ))}
          </ul>
        </Section>
      );

    // ── Stage: one product held up at a time, the rest ranged beneath.
    //    Lumen and Companion Club. ──────────────────────────────────────────
    case 'stage': {
      const [lead, ...rest] = products;
      return (
        <Section>
          <SectionHeading title={title} subtitle={section.subtitle} align="center" href={href} />
          <Reveal>
            <Link
              href={`/products/${lead.slug}`}
              className="group relative mx-auto block max-w-4xl overflow-hidden rounded-[var(--radius)] bg-surface-muted"
            >
              <span className="grid items-center gap-6 p-5 sm:grid-cols-2 sm:p-8">
                <span className="block aspect-square overflow-hidden rounded-[var(--radius)] bg-surface">
                  {lead.primaryImageUrl ? (
                    <img
                      src={lead.primaryImageUrl}
                      alt=""
                      className="h-full w-full object-cover transition-transform duration-700 motion-safe:group-hover:scale-105"
                    />
                  ) : (
                    <span className="block h-full w-full bg-primary-soft" />
                  )}
                </span>
                <span className="block">
                  {lead.brandName && (
                    <span className="block text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                      {lead.brandName}
                    </span>
                  )}
                  <span className="heading mt-2 block text-[clamp(1.25rem,3vw,2rem)] leading-tight text-content">
                    {lead.name}
                  </span>
                  {lead.shortDescription && (
                    <span className="mt-3 block text-sm leading-relaxed text-content-muted">
                      {lead.shortDescription}
                    </span>
                  )}
                  <span className="mt-6 inline-flex h-11 items-center rounded-[var(--radius)] bg-primary px-6 text-sm font-semibold text-primary-fg transition group-hover:brightness-110">
                    View this one
                  </span>
                </span>
              </span>
            </Link>
          </Reveal>

          {rest.length > 0 && (
            <RevealGroup
              as="ul"
              className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
              step={55}
            >
              {rest.slice(0, 5).map((product) => (
                <ProductCard key={product.id} product={product} currency={currency} />
              ))}
            </RevealGroup>
          )}
        </Section>
      );
    }

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
