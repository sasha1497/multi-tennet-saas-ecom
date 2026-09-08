import Link from 'next/link';
import { ArrowRight, Search, Sparkles } from 'lucide-react';
import type { TemplateSection } from '@retailos/templates';
import { cn } from '@retailos/ui';
import { primaryBanner, type SectionData } from '../data';

/**
 * The opening statement, in six voices.
 *
 * All six read the same three things — the store's active banner, its name and
 * its tagline — and produce completely different first impressions. A shop
 * that switches template gets a new front door; the copy and imagery it wrote
 * come with it.
 */
export function HeroSection({
  section,
  data,
}: {
  section: TemplateSection;
  data: SectionData;
}) {
  const { store, categories } = data;
  const banner = primaryBanner(store);

  const title = section.title ?? banner?.title ?? store.tagline ?? `Welcome to ${store.storeName}`;
  const subtitle =
    section.subtitle ??
    banner?.subtitle ??
    store.description ??
    'Quality products from your neighbourhood store, delivered to your door.';
  const ctaLabel = banner?.ctaLabel ?? 'Shop now';
  const ctaHref = banner?.ctaHref ?? '/products';
  const image = banner?.imageUrl ?? null;

  switch (section.variant) {
    // ── Full bleed: image behind, type on top. Urban Luxe. ─────────────────
    case 'fullBleed':
      return (
        // Height is clamped rather than a bare `vh`: the same markup renders in
        // a phone, a laptop and the console's 375px preview frame, and a hero
        // that is two thirds of a very tall window is just a wall.
        <section className="relative isolate min-h-[clamp(440px,66vh,700px)] overflow-hidden bg-content text-white">
          {image ? (
            <img
              src={image}
              alt=""
              fetchPriority="high"
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <span className="absolute inset-0 bg-gradient-to-br from-content via-content to-primary" />
          )}
          {/* Dark enough to keep white type legible over any photograph, light
              enough that the merchant's banner is still the thing you see. */}
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent"
          />
          <div className="relative mx-auto flex min-h-[clamp(440px,66vh,700px)] w-full max-w-7xl flex-col justify-end px-4 pb-14 sm:px-6 sm:pb-20">
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.32em] text-white/70">
              {store.storeName}
            </p>
            <h1 className="heading max-w-3xl break-words text-[clamp(1.75rem,6.4vw,4.5rem)] leading-[1.05] text-white">
              {title}
            </h1>
            <p className="mt-5 max-w-md text-[15px] leading-relaxed text-white/80">{subtitle}</p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link
                href={ctaHref}
                className="inline-flex h-12 items-center gap-2 bg-white px-8 text-sm font-semibold uppercase tracking-[0.14em] text-content transition hover:bg-white/90"
              >
                {ctaLabel}
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
              <Link
                href="/offers"
                className="inline-flex h-12 items-center border border-white/40 px-8 text-sm font-semibold uppercase tracking-[0.14em] text-white transition hover:border-white"
              >
                Offers
              </Link>
            </div>
          </div>
        </section>
      );

    // ── Lifestyle: framed image beside a serif statement. Silk Editorial. ──
    case 'lifestyle':
      return (
        <section className="bg-surface-muted">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:py-24">
            <div className="order-2 lg:order-1">
              <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.3em] text-accent">
                {store.storeName}
              </p>
              <h1 className="heading break-words text-[clamp(1.75rem,5vw,3rem)] leading-[1.12] text-content">{title}</h1>
              <p className="mt-5 max-w-md text-[15px] leading-relaxed text-content-muted">
                {subtitle}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={ctaHref}
                  className="inline-flex h-12 items-center gap-2 rounded-[var(--radius)] bg-primary px-7 text-sm font-semibold text-primary-fg transition hover:brightness-110"
                >
                  {ctaLabel}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/products"
                  className="inline-flex h-12 items-center rounded-[var(--radius)] border border-content/20 px-7 text-sm font-medium text-content transition hover:border-content"
                >
                  Browse everything
                </Link>
              </div>
            </div>

            <div className="order-1 lg:order-2">
              <div className="relative aspect-[4/5] overflow-hidden rounded-[var(--radius)] bg-surface lg:aspect-[5/4]">
                {image ? (
                  <img
                    src={image}
                    alt=""
                    fetchPriority="high"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full items-center justify-center bg-primary-soft" />
                )}
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-4 border border-white/40"
                />
              </div>
            </div>
          </div>
        </section>
      );

    // ── Device split: product beside a hard sell. Spec Grid. ───────────────
    case 'deviceSplit':
      return (
        <section className="bg-gradient-to-br from-primary to-primary/80 text-primary-fg">
          <div className="mx-auto grid max-w-7xl items-center gap-8 px-4 py-10 sm:px-6 lg:grid-cols-2 lg:py-14">
            <div>
              <span className="mb-4 inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                Latest stock in store
              </span>
              <h1 className="heading break-words text-[clamp(1.6rem,4.6vw,3rem)] leading-tight">{title}</h1>
              <p className="mt-3.5 max-w-md text-[15px] leading-relaxed text-primary-fg/85">
                {subtitle}
              </p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link
                  href={ctaHref}
                  className="inline-flex h-11 items-center gap-2 rounded-[var(--radius)] bg-white px-6 text-sm font-semibold text-primary transition hover:bg-white/90"
                >
                  {ctaLabel}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/offers"
                  className="inline-flex h-11 items-center rounded-[var(--radius)] border border-white/40 px-6 text-sm font-semibold transition hover:bg-white/10"
                >
                  EMI &amp; offers
                </Link>
              </div>
            </div>

            {image && (
              <div className="relative aspect-[16/10] overflow-hidden rounded-[var(--radius)] bg-white/10">
                <img src={image} alt="" fetchPriority="high" className="h-full w-full object-cover" />
              </div>
            )}
          </div>
        </section>
      );

    // ── Soft curve: warm, rounded, reassuring. Glow. ───────────────────────
    case 'softCurve':
      return (
        <section className="relative overflow-hidden bg-primary-soft">
          <span
            aria-hidden="true"
            className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-accent/25 blur-3xl"
          />
          <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-2 lg:py-20">
            <div>
              <h1 className="heading break-words text-[clamp(1.75rem,5vw,3rem)] leading-[1.15] text-content">{title}</h1>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-content-muted">
                {subtitle}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={ctaHref}
                  className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-8 text-sm font-semibold text-primary-fg transition hover:brightness-110"
                >
                  {ctaLabel}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/products"
                  className="inline-flex h-12 items-center rounded-full bg-surface px-8 text-sm font-semibold text-content shadow-sm transition hover:shadow"
                >
                  Explore all
                </Link>
              </div>
            </div>

            {image && (
              <div className="relative aspect-square overflow-hidden rounded-[3rem] bg-surface lg:aspect-[5/4]">
                <img src={image} alt="" fetchPriority="high" className="h-full w-full object-cover" />
              </div>
            )}
          </div>
        </section>
      );

    // ── Playful: bold, friendly, category-led. Pawsome. ────────────────────
    case 'playful':
      return (
        <section className="bg-surface-muted">
          <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
            <div className="relative overflow-hidden rounded-[2.5rem] bg-primary text-primary-fg">
              <div className="grid items-center gap-8 p-8 sm:p-12 lg:grid-cols-2">
                <div>
                  <h1 className="heading break-words text-[clamp(1.6rem,4.6vw,3rem)] leading-tight">{title}</h1>
                  <p className="mt-4 max-w-md text-[15px] leading-relaxed text-primary-fg/85">
                    {subtitle}
                  </p>
                  <Link
                    href={ctaHref}
                    className="mt-8 inline-flex h-12 items-center gap-2 rounded-full bg-accent px-8 text-sm font-bold text-accent-fg transition hover:brightness-110"
                  >
                    {ctaLabel}
                    <ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
                {image && (
                  <div className="relative aspect-[4/3] overflow-hidden rounded-[2rem]">
                    <img
                      src={image}
                      alt=""
                      fetchPriority="high"
                      className="h-full w-full object-cover"
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
      );

    // ── Compact search: shortest path to a basket. Daily Cart. ─────────────
    case 'compactSearch':
    default:
      return (
        <section className="border-b border-line bg-primary text-primary-fg">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:py-10">
            <div className="grid items-center gap-6 lg:grid-cols-[1.2fr_1fr]">
              <div>
                <h1 className="heading break-words text-[clamp(1.4rem,3.6vw,2.125rem)] leading-tight">{title}</h1>
                <p className="mt-2 max-w-lg text-sm text-primary-fg/85">{subtitle}</p>

                <form action="/products" className="mt-5 flex max-w-md gap-2">
                  <label htmlFor="hero-search" className="sr-only">
                    Search the shop
                  </label>
                  <div className="relative flex-1">
                    <Search
                      className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle"
                      aria-hidden="true"
                    />
                    <input
                      id="hero-search"
                      name="search"
                      type="search"
                      placeholder="Search for anything…"
                      className="h-11 w-full rounded-[var(--radius)] border-0 bg-white pl-9 pr-3 text-sm text-content placeholder:text-content-subtle focus:outline-none focus:ring-2 focus:ring-white"
                    />
                  </div>
                  <button
                    type="submit"
                    className="h-11 shrink-0 rounded-[var(--radius)] bg-accent px-5 text-sm font-semibold text-accent-fg transition hover:brightness-110"
                  >
                    Search
                  </button>
                </form>
              </div>

              {categories.length > 0 && (
                <ul className="flex flex-wrap gap-2 lg:justify-end">
                  {categories.slice(0, 6).map((category) => (
                    <li key={category.id}>
                      <Link
                        href={`/products?category=${category.slug}`}
                        className={cn(
                          'inline-flex h-9 items-center rounded-full bg-white/15 px-4 text-xs font-medium',
                          'transition hover:bg-white/25',
                        )}
                      >
                        {category.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </section>
      );
  }
}
