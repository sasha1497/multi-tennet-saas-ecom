import Link from 'next/link';
import { ArrowDown, ArrowRight, Search, Sparkles, Truck, Zap } from 'lucide-react';
import type { TemplateSection } from '@retailos/templates';
import { cn } from '@retailos/ui';
import { primaryBanner, type SectionData } from '../data';
import { Parallax, Reveal, RevealWords } from '../motion';
import { GridField, Ornament, Paw, PawField, StageGlow } from '../components/decor';

/**
 * The opening statement, in eleven voices.
 *
 * Every one of them reads the same three things — the store's active banner,
 * its name and its tagline — and produces a completely different first
 * impression. A shop that switches template gets a new front door; the copy and
 * imagery it wrote come with it, unchanged.
 *
 * The hero is the single largest reason two templates feel different, so this
 * is where the variants are least alike: a full-height film still, a framed
 * product shot, a search bar over an aisle strip and a paw-print field are not
 * the same component with different padding.
 */
export function HeroSection({ section, data }: { section: TemplateSection; data: SectionData }) {
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
              <h1 className="heading break-words text-[clamp(1.75rem,5vw,3rem)] leading-[1.12] text-content">
                {title}
              </h1>
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
              <h1 className="heading break-words text-[clamp(1.6rem,4.6vw,3rem)] leading-tight">
                {title}
              </h1>
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
                <img
                  src={image}
                  alt=""
                  fetchPriority="high"
                  className="h-full w-full object-cover"
                />
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
              <h1 className="heading break-words text-[clamp(1.75rem,5vw,3rem)] leading-[1.15] text-content">
                {title}
              </h1>
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
                <img
                  src={image}
                  alt=""
                  fetchPriority="high"
                  className="h-full w-full object-cover"
                />
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
                  <h1 className="heading break-words text-[clamp(1.6rem,4.6vw,3rem)] leading-tight">
                    {title}
                  </h1>
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

    // ── Cinematic: full-height film still, headline unmasked word by word.
    //    Atelier Noir. The one hero that fills the viewport. ────────────────
    case 'cinematic':
      return (
        <section className="relative isolate flex min-h-[clamp(560px,88vh,900px)] items-end overflow-hidden bg-black text-white">
          {/* Scaled slightly past the frame so the parallax drift never
              exposes an edge at either end of its travel. */}
          <Parallax strength={0.18} className="absolute inset-0 scale-110">
            {image ? (
              <img src={image} alt="" fetchPriority="high" className="h-full w-full object-cover" />
            ) : (
              <span className="block h-full w-full bg-gradient-to-br from-neutral-900 via-neutral-800 to-accent/40" />
            )}
          </Parallax>
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black via-black/45 to-black/25"
          />

          <div className="relative mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6 sm:pb-24">
            <p className="mb-6 text-[10px] font-semibold uppercase tracking-[0.42em] text-white/55">
              {store.storeName}
            </p>
            <h1 className="heading max-w-4xl break-words text-[clamp(2.25rem,7.5vw,5.5rem)] font-medium leading-[0.98] text-white">
              <RevealWords text={title} />
            </h1>
            <Reveal delay={420}>
              <p className="mt-7 max-w-lg text-[15px] leading-relaxed text-white/70">{subtitle}</p>
              <div className="mt-10 flex flex-wrap items-center gap-6">
                <Link
                  href={ctaHref}
                  className="group inline-flex items-center gap-3 border-b border-white/40 pb-1.5 text-sm font-medium tracking-wide text-white transition-colors hover:border-white"
                >
                  {ctaLabel}
                  <ArrowRight
                    className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </Link>
                <Link
                  href="/products"
                  className="text-sm text-white/55 transition-colors hover:text-white"
                >
                  View everything
                </Link>
              </div>
            </Reveal>
          </div>

          <span
            aria-hidden="true"
            className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 text-white/40 sm:block"
          >
            <ArrowDown className="h-4 w-4 animate-bounce" />
          </span>
        </section>
      );

    // ── Showcase: dark, backlit product stage. Lumen. ──────────────────────
    case 'showcase':
      return (
        <section className="relative isolate overflow-hidden bg-[rgb(var(--color-surface-muted))] text-content">
          <StageGlow />
          <GridField />

          <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-20 text-center sm:px-6 sm:pb-24 sm:pt-28">
            <Reveal>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3.5 py-1.5 text-[11px] font-medium uppercase tracking-[0.18em] text-content-muted backdrop-blur">
                <Zap className="h-3 w-3 text-accent" aria-hidden="true" />
                In store now
              </span>
            </Reveal>
            <h1 className="heading mx-auto mt-7 max-w-3xl break-words text-[clamp(2rem,6vw,4.25rem)] leading-[1.02] text-content">
              <RevealWords text={title} />
            </h1>
            <Reveal delay={360}>
              <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-content-muted">
                {subtitle}
              </p>
              <div className="mt-9 flex flex-wrap justify-center gap-3">
                <Link
                  href={ctaHref}
                  className="inline-flex h-12 items-center gap-2 rounded-full bg-primary px-8 text-sm font-semibold text-primary-fg transition hover:brightness-110"
                >
                  {ctaLabel}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/offers"
                  className="inline-flex h-12 items-center rounded-full border border-white/15 px-8 text-sm font-medium text-content transition hover:border-white/35"
                >
                  EMI &amp; offers
                </Link>
              </div>
            </Reveal>

            {image && (
              <Reveal delay={200} className="mt-14">
                <Parallax strength={-0.06}>
                  <div className="relative mx-auto max-w-4xl overflow-hidden rounded-[1.75rem] border border-white/10 bg-white/5 shadow-2xl shadow-primary/20">
                    <img
                      src={image}
                      alt=""
                      fetchPriority="high"
                      className="aspect-[16/9] w-full object-cover"
                    />
                  </div>
                </Parallax>
              </Reveal>
            )}
          </div>
        </section>
      );

    // ── Paw prints: unmistakably a pet shop within one screen. Pawsome. ────
    case 'pawPrints':
      return (
        <section className="relative overflow-hidden bg-primary-soft">
          <PawField className="text-primary" />

          <div className="relative mx-auto grid max-w-7xl items-center gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:py-20">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full bg-accent/20 px-4 py-1.5 text-xs font-bold text-content">
                <Paw className="h-3.5 w-3.5 text-accent" />
                Food · Toys · Care
              </span>
              <h1 className="heading mt-5 break-words text-[clamp(1.9rem,5.4vw,3.5rem)] leading-[1.08] text-content">
                {title}
              </h1>
              <p className="mt-4 max-w-md text-[15px] leading-relaxed text-content-muted">
                {subtitle}
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href={ctaHref}
                  className="inline-flex h-13 items-center gap-2 rounded-full bg-primary px-8 py-3.5 text-sm font-bold text-primary-fg transition hover:brightness-110"
                >
                  {ctaLabel}
                  <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </Link>
                <Link
                  href="/offers"
                  className="inline-flex h-13 items-center rounded-full bg-surface px-8 py-3.5 text-sm font-bold text-content shadow-sm transition hover:shadow-md"
                >
                  Treats &amp; offers
                </Link>
              </div>

              {categories.length > 0 && (
                <ul className="mt-8 flex flex-wrap gap-2">
                  {categories.slice(0, 4).map((category) => (
                    <li key={category.id}>
                      <Link
                        href={`/products?category=${category.slug}`}
                        className="inline-flex items-center gap-1.5 rounded-full border-2 border-primary/15 bg-surface/70 px-3.5 py-1.5 text-xs font-semibold text-content transition hover:border-primary/40"
                      >
                        <Paw className="h-3 w-3 text-primary" />
                        {category.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="relative">
              <div className="relative aspect-[4/3] overflow-hidden rounded-[2.5rem] bg-surface shadow-lg lg:aspect-square">
                {image ? (
                  <img
                    src={image}
                    alt=""
                    fetchPriority="high"
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-accent/15">
                    <Paw className="h-24 w-24 text-primary/25" />
                  </span>
                )}
              </div>
              {/* A treat-shaped badge, tucked into the corner of the photo. */}
              <span
                aria-hidden="true"
                className="absolute -bottom-3 -left-3 hidden rotate-[-8deg] rounded-full bg-accent px-5 py-2.5 text-sm font-extrabold text-accent-fg shadow-lg sm:block"
              >
                Happy tails
              </span>
            </div>
          </div>
        </section>
      );

    // ── Aisle search: delivery promise, big search, aisle chips. Daily Cart.
    case 'aisleSearch':
      return (
        <section className="border-b border-line bg-primary text-primary-fg">
          <div className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:py-9">
            <div className="grid items-center gap-6 lg:grid-cols-[1.15fr_1fr]">
              <div>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold">
                  <Truck className="h-3 w-3" aria-hidden="true" />
                  Delivered from your neighbourhood shop
                </span>
                <h1 className="heading mt-3 break-words text-[clamp(1.35rem,3.4vw,2rem)] leading-tight">
                  {title}
                </h1>
                <p className="mt-1.5 max-w-lg text-sm text-primary-fg/85">{subtitle}</p>

                <form action="/products" className="mt-4 flex max-w-lg gap-2">
                  <label htmlFor="hero-search" className="sr-only">
                    Search the shop
                  </label>
                  <div className="relative flex-1">
                    <Search
                      className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle"
                      aria-hidden="true"
                    />
                    <input
                      id="hero-search"
                      name="search"
                      type="search"
                      placeholder="Search for rice, milk, soap…"
                      className="h-12 w-full rounded-[var(--radius)] border-0 bg-white pl-10 pr-3 text-sm text-content placeholder:text-content-subtle focus:outline-none focus:ring-2 focus:ring-white"
                    />
                  </div>
                  <button
                    type="submit"
                    className="h-12 shrink-0 rounded-[var(--radius)] bg-accent px-6 text-sm font-bold text-accent-fg transition hover:brightness-110"
                  >
                    Search
                  </button>
                </form>
              </div>

              {image ? (
                <div className="hidden aspect-[16/10] overflow-hidden rounded-[var(--radius)] lg:block">
                  <img
                    src={image}
                    alt=""
                    fetchPriority="high"
                    className="h-full w-full object-cover"
                  />
                </div>
              ) : (
                categories.length > 0 && (
                  <ul className="flex flex-wrap gap-2 lg:justify-end">
                    {categories.slice(0, 8).map((category) => (
                      <li key={category.id}>
                        <Link
                          href={`/products?category=${category.slug}`}
                          className="inline-flex h-9 items-center rounded-full bg-white/15 px-4 text-xs font-medium transition hover:bg-white/25"
                        >
                          {category.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )
              )}
            </div>
          </div>
        </section>
      );

    // ── Statement: type at display size over white. Silk Editorial. ────────
    case 'statement':
      return (
        <section className="bg-surface">
          <div className="mx-auto max-w-5xl px-4 pb-14 pt-16 text-center sm:px-6 sm:pb-20 sm:pt-24">
            <p className="text-[10px] uppercase tracking-[0.45em] text-content-subtle">
              {store.storeName}
            </p>
            <h1 className="heading mx-auto mt-8 max-w-3xl break-words text-[clamp(1.9rem,5.6vw,4rem)] font-normal leading-[1.12] text-content">
              {title}
            </h1>
            <p className="mx-auto mt-6 max-w-lg text-[15px] leading-loose text-content-muted">
              {subtitle}
            </p>
            <Ornament className="mt-10" />
            <div className="mt-10">
              <Link
                href={ctaHref}
                className="inline-flex h-12 items-center border border-content px-10 text-[11px] font-medium uppercase tracking-[0.25em] text-content transition-colors hover:bg-content hover:text-surface"
              >
                {ctaLabel}
              </Link>
            </div>
          </div>

          {image && (
            <div className="mx-auto max-w-7xl px-4 sm:px-6">
              <div className="aspect-[21/9] overflow-hidden">
                <img
                  src={image}
                  alt=""
                  fetchPriority="high"
                  className="h-full w-full object-cover"
                />
              </div>
            </div>
          )}
        </section>
      );

    // ── Manifesto: one held image, one sentence, nothing else. Maison. ─────
    case 'manifesto':
      return (
        <section className="relative isolate flex min-h-[clamp(600px,92vh,940px)] items-center justify-center overflow-hidden bg-content text-white">
          <Parallax strength={0.1} className="absolute inset-0 scale-105">
            {image ? (
              <img src={image} alt="" fetchPriority="high" className="h-full w-full object-cover" />
            ) : (
              <span className="block h-full w-full bg-gradient-to-b from-content via-content to-accent/25" />
            )}
          </Parallax>
          <span aria-hidden="true" className="absolute inset-0 bg-black/45" />

          <div className="relative mx-auto max-w-3xl px-6 text-center">
            <Reveal>
              <p className="text-[10px] uppercase tracking-[0.5em] text-white/50">
                {store.storeName}
              </p>
            </Reveal>
            <h1 className="heading mt-10 break-words text-[clamp(2rem,6.5vw,4.75rem)] font-normal leading-[1.1] text-white">
              <RevealWords text={title} />
            </h1>
            <Reveal delay={700}>
              <Ornament className="mt-12 text-white" />
              <div className="mt-12">
                <Link
                  href={ctaHref}
                  className="inline-flex h-12 items-center border border-white/50 px-12 text-[11px] font-medium uppercase tracking-[0.3em] text-white transition-colors duration-500 hover:border-white hover:bg-white hover:text-content"
                >
                  {ctaLabel}
                </Link>
              </div>
            </Reveal>
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
                <h1 className="heading break-words text-[clamp(1.4rem,3.6vw,2.125rem)] leading-tight">
                  {title}
                </h1>
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
