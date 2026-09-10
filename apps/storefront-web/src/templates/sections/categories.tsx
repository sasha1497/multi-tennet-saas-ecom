import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { TemplateSection } from '@retailos/templates';
import type { CategoryTreeNode } from '@retailos/types';
import { cn } from '@retailos/ui';
import { Paw } from '../components/decor';
import { Section, SectionHeading } from '../components/section';
import type { SectionData } from '../data';
import { Reveal, RevealGroup } from '../motion';

/**
 * Category navigation, in nine shapes.
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
                <Link
                  href={`/products?category=${category.slug}`}
                  className="group block w-24 text-center sm:w-28"
                >
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

    // ── Companions: "who are we shopping for?", not a category grid.
    //    Pawsome and Companion Club. ────────────────────────────────────────
    case 'companions':
      return (
        <Section>
          <SectionHeading
            title={section.title ?? 'Who are we shopping for?'}
            subtitle={section.subtitle}
            align="center"
          />
          <RevealGroup
            as="ul"
            className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4"
            step={70}
          >
            {categories.slice(0, 8).map((category, i) => (
              <Link
                key={category.id}
                href={`/products?category=${category.slug}`}
                className={cn(
                  'group relative flex h-full flex-col items-center gap-3 overflow-hidden rounded-[2rem] p-5 pt-6 text-center',
                  'transition-transform duration-300 motion-safe:hover:-translate-y-1.5',
                  TONES[i % TONES.length],
                )}
              >
                {/* A paw watermark in the corner of every card — the cheapest
                    possible signal that this is a pet shop, on every tile. */}
                <Paw className="pointer-events-none absolute -right-3 -top-3 h-14 w-14 rotate-12 text-content/[0.06] transition-transform duration-500 group-hover:rotate-[20deg]" />
                <span className="relative block h-20 w-20 overflow-hidden rounded-full bg-surface ring-4 ring-surface/70">
                  <CategoryImage category={category} />
                </span>
                <span className="relative text-sm font-extrabold leading-tight text-content">
                  {category.name}
                </span>
                {typeof category.productCount === 'number' && (
                  <span className="relative -mt-1.5 text-xs font-medium text-content-muted tabular">
                    {category.productCount} things they will love
                  </span>
                )}
              </Link>
            ))}
          </RevealGroup>
        </Section>
      );

    // ── Aisle grid: the whole shop, labelled, in one screen. Daily Cart. ───
    case 'aisleGrid':
      return (
        <Section>
          <SectionHeading
            title={section.title ?? 'Shop by aisle'}
            subtitle={section.subtitle}
            href="/products"
            linkLabel="All aisles"
          />
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-8">
            {categories.slice(0, 16).map((category) => (
              <li key={category.id}>
                <Link
                  href={`/products?category=${category.slug}`}
                  className="group flex h-full flex-col items-center gap-1.5 rounded-[var(--radius)] bg-surface p-2.5 text-center ring-1 ring-line transition hover:ring-primary"
                >
                  <span className="block h-14 w-14 overflow-hidden rounded-full bg-surface-muted">
                    <CategoryImage category={category} />
                  </span>
                  <span className="line-clamp-2 text-[11px] font-medium leading-tight text-content">
                    {category.name}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      );

    // ── Index list: a contents page, not a gallery. Silk Editorial, Maison.
    case 'indexList':
      return (
        <Section>
          <SectionHeading
            title={section.title ?? 'Collections'}
            subtitle={section.subtitle}
            align="center"
          />
          <ul className="mx-auto max-w-3xl">
            {categories.slice(0, 10).map((category, i) => (
              <li key={category.id}>
                <Reveal delay={i * 45}>
                  <Link
                    href={`/products?category=${category.slug}`}
                    className="group flex items-baseline gap-5 border-b border-line py-5 transition-colors hover:border-content"
                  >
                    <span className="w-8 shrink-0 text-[11px] text-content-subtle tabular">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="heading flex-1 text-[clamp(1.15rem,3vw,1.9rem)] font-normal leading-tight text-content transition-transform duration-500 motion-safe:group-hover:translate-x-2">
                      {category.name}
                    </span>
                    {typeof category.productCount === 'number' && (
                      <span className="hidden text-xs text-content-subtle tabular sm:block">
                        {category.productCount}
                      </span>
                    )}
                    <ArrowUpRight
                      className="h-4 w-4 shrink-0 text-content-subtle transition-colors group-hover:text-content"
                      aria-hidden="true"
                    />
                  </Link>
                </Reveal>
              </li>
            ))}
          </ul>
        </Section>
      );

    // ── Marquee tiles: wide tiles that drift as you scroll past. Premium. ──
    case 'marqueeTiles':
      return (
        <Section bleed>
          <div className="mx-auto mb-8 w-full max-w-7xl px-4 sm:px-6">
            <SectionHeading
              title={section.title ?? 'Explore'}
              subtitle={section.subtitle}
              className="mb-0"
            />
          </div>
          <ul className="scroll-slim flex snap-x gap-4 overflow-x-auto px-4 pb-3 sm:px-6">
            {categories.slice(0, 10).map((category, i) => (
              <li key={category.id} className="w-[70%] shrink-0 snap-start sm:w-[42%] lg:w-[30%]">
                <Reveal delay={Math.min(i, 4) * 80}>
                  <Link
                    href={`/products?category=${category.slug}`}
                    className="group relative block aspect-[4/5] overflow-hidden rounded-[var(--radius)] bg-content"
                  >
                    <span className="absolute inset-0">
                      <CategoryImage
                        category={category}
                        fill
                        className="opacity-70 transition-[opacity,transform] duration-700 group-hover:scale-105 group-hover:opacity-90"
                      />
                    </span>
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent"
                    />
                    <span className="absolute inset-x-0 bottom-0 p-6">
                      <span className="block text-[10px] uppercase tracking-[0.3em] text-white/55">
                        {String(i + 1).padStart(2, '0')}
                      </span>
                      <span className="heading mt-2 block text-xl text-white">{category.name}</span>
                      <span className="mt-3 inline-flex items-center gap-1.5 text-xs text-white/70 transition-transform duration-300 motion-safe:group-hover:translate-x-1">
                        Explore
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                    </span>
                  </Link>
                </Reveal>
              </li>
            ))}
          </ul>
        </Section>
      );

    // ── Chips: the whole tree in one glance. Daily Cart. ───────────────────
    case 'chips':
    default:
      return (
        <Section>
          <SectionHeading
            title={section.title ?? 'Shop by aisle'}
            subtitle={section.subtitle}
            href="/products"
          />
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

/** Alternating warm tones for the companion cards. */
const TONES = ['bg-primary-soft', 'bg-accent/15', 'bg-primary/10', 'bg-accent/25'];

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
