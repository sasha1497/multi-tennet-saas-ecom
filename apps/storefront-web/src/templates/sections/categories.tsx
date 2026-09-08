import Link from 'next/link';
import type { TemplateSection } from '@retailos/templates';
import type { CategoryTreeNode } from '@retailos/types';
import { cn } from '@retailos/ui';
import { Section, SectionHeading } from '../components/section';
import type { SectionData } from '../data';

/**
 * Category navigation, in five shapes.
 *
 * Same category tree in every case. What changes is how much room a category
 * is given — an editorial tile makes browsing feel like choosing a collection,
 * a chip row makes it feel like finding an aisle.
 */
export function CategoriesSection({
  section,
  data,
}: {
  section: TemplateSection;
  data: SectionData;
}) {
  const categories = data.categories.filter((c) => c.isActive !== false);
  if (categories.length === 0) return null;

  switch (section.variant) {
    // ── Editorial tiles: tall, dark-captioned, three across. Urban Luxe. ───
    case 'editorialTiles':
      return (
        <Section>
          <SectionHeading title={section.title ?? 'Categories'} subtitle={section.subtitle} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {categories.slice(0, 6).map((category) => (
              <Link
                key={category.id}
                href={`/products?category=${category.slug}`}
                className="group relative isolate flex aspect-[4/3] items-end overflow-hidden bg-content"
              >
                {/* Absolutely positioned: the tile is a flex container whose
                    caption sits at the bottom, so the artwork has to be taken
                    out of flow to fill it rather than share the box. */}
                <span className="absolute inset-0">
                  <CategoryImage
                    category={category}
                    fill
                    className="opacity-75 group-hover:opacity-60"
                  />
                </span>
                <span
                  aria-hidden="true"
                  className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent"
                />
                <span className="relative w-full p-5">
                  <span className="heading block text-lg text-white">{category.name}</span>
                  {typeof category.productCount === 'number' && (
                    <span className="mt-0.5 block text-xs text-white/70 tabular">
                      {category.productCount} items
                    </span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </Section>
      );

    // ── Rounded rail: circular, scrollable. Silk Editorial and Glow. ───────
    case 'roundedRail':
      return (
        <Section>
          <SectionHeading
            title={section.title ?? 'Shop by category'}
            subtitle={section.subtitle}
            align="center"
            rule
          />
          <ul className="scroll-slim -mx-4 flex snap-x gap-5 overflow-x-auto px-4 pb-2 sm:mx-0 sm:justify-center sm:px-0 sm:flex-wrap">
            {categories.slice(0, 10).map((category) => (
              <li key={category.id} className="snap-start">
                <Link href={`/products?category=${category.slug}`} className="group block w-24 text-center sm:w-28">
                  <span className="block aspect-square overflow-hidden rounded-full bg-surface-muted ring-1 ring-black/5 transition group-hover:ring-primary">
                    <CategoryImage category={category} />
                  </span>
                  <span className="mt-2.5 block truncate text-[13px] font-medium text-content group-hover:text-primary">
                    {category.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      );

    // ── Icon grid: dense, boxed, letter-fallback. Spec Grid. ───────────────
    case 'iconGrid':
      return (
        <Section>
          <SectionHeading
            title={section.title ?? 'Browse categories'}
            subtitle={section.subtitle}
            href="/products"
          />
          <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
            {categories.slice(0, 12).map((category) => (
              <Link
                key={category.id}
                href={`/products?category=${category.slug}`}
                className="group flex flex-col items-center gap-2 rounded-[var(--radius)] border border-line bg-surface p-3 text-center transition hover:border-primary hover:shadow-sm"
              >
                <span className="h-12 w-12 overflow-hidden rounded-[var(--radius)] bg-surface-muted">
                  <CategoryImage category={category} />
                </span>
                <span className="line-clamp-2 text-[12px] font-medium leading-tight text-content">
                  {category.name}
                </span>
              </Link>
            ))}
          </div>
        </Section>
      );

    // ── Bubbles: big, friendly, colour-blocked. Pawsome. ───────────────────
    case 'bubbles':
      return (
        <Section>
          <SectionHeading
            title={section.title ?? 'Shop by category'}
            subtitle={section.subtitle}
            align="center"
          />
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {categories.slice(0, 8).map((category, i) => (
              <Link
                key={category.id}
                href={`/products?category=${category.slug}`}
                className={cn(
                  'group flex flex-col items-center gap-3 rounded-[2rem] p-6 text-center transition hover:-translate-y-1',
                  i % 2 === 0 ? 'bg-primary-soft' : 'bg-accent/15',
                )}
              >
                <span className="h-20 w-20 overflow-hidden rounded-full bg-surface">
                  <CategoryImage category={category} />
                </span>
                <span className="text-sm font-bold text-content">{category.name}</span>
                {typeof category.productCount === 'number' && (
                  <span className="text-xs text-content-muted tabular">
                    {category.productCount} items
                  </span>
                )}
              </Link>
            ))}
          </div>
        </Section>
      );

    // ── Chips: the whole tree in one glance. Daily Cart. ───────────────────
    case 'chips':
    default:
      return (
        <Section>
          <SectionHeading title={section.title ?? 'Shop by aisle'} subtitle={section.subtitle} href="/products" />
          <ul className="flex flex-wrap gap-2">
            {categories.map((category) => (
              <li key={category.id}>
                <Link
                  href={`/products?category=${category.slug}`}
                  className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-[13px] font-medium text-content transition hover:border-primary hover:text-primary"
                >
                  {category.name}
                  {typeof category.productCount === 'number' && (
                    <span className="text-xs text-content-subtle tabular">
                      {category.productCount}
                    </span>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      );
  }
}

function CategoryImage({
  category,
  className,
  fill,
}: {
  category: CategoryTreeNode;
  className?: string;
  /** Large formats where the category name is already shown as a caption. */
  fill?: boolean;
}) {
  if (category.imageUrl) {
    return (
      <img
        src={category.imageUrl}
        alt=""
        loading="lazy"
        className={cn(
          'h-full w-full object-cover transition-transform duration-500 group-hover:scale-105',
          className,
        )}
      />
    );
  }

  // No artwork. In a large tile the name is already rendered as a caption, so
  // a giant initial under a dark scrim just reads as noise — a tonal wash sits
  // behind the caption far better. In a small chip the initial *is* the visual.
  if (fill) {
    return (
      <span
        className={cn('block h-full w-full bg-gradient-to-br from-primary to-accent', className)}
        aria-hidden="true"
      />
    );
  }

  return (
    <span
      className={cn(
        'flex h-full w-full items-center justify-center bg-primary-soft text-lg font-bold text-primary',
        className,
      )}
      aria-hidden="true"
    >
      {category.name.charAt(0).toUpperCase()}
    </span>
  );
}
