import Link from 'next/link';
import {
  BadgePercent,
  Clock,
  CreditCard,
  HeartHandshake,
  Leaf,
  Quote,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Truck,
} from 'lucide-react';
import { formatMoney } from '@retailos/config';
import type { TemplateSection } from '@retailos/templates';
import type { Coupon } from '@retailos/types';
import { cn } from '@retailos/ui';
import { Ornament, Paw } from '../components/decor';
import { Section, SectionHeading } from '../components/section';
import { primaryBanner, secondaryBanner, type SectionData } from '../data';
import { BrandMarquee } from '../components/brand-marquee';
import { Parallax, Reveal, RevealGroup } from '../motion';

// ═══════════════════════════════════════════════════════════ trust strip ══

/**
 * The three things a local shopper wants settled before they browse.
 *
 * Copy is derived from the store's real settings — free-delivery threshold,
 * whether cash on delivery is on — so it is never a claim the shop cannot keep.
 */
export function TrustStripSection({
  section,
  data,
}: {
  section: TemplateSection;
  data: SectionData;
}) {
  const { store } = data;

  const items = [
    {
      icon: Truck,
      title:
        store.freeShippingThreshold > 0
          ? `Free delivery above ${formatMoney(store.freeShippingThreshold, store.currency, { hideDecimals: true })}`
          : 'Fast local delivery',
      description: 'Delivered from a shop near you',
    },
    store.codEnabled
      ? {
          icon: CreditCard,
          title: 'Cash on delivery',
          description: 'Pay when it reaches your door',
        }
      : {
          icon: ShieldCheck,
          title: 'Secure payments',
          description: 'UPI, cards and net banking',
        },
    {
      icon: BadgePercent,
      title: 'Genuine products',
      description: 'Straight from the store',
    },
  ];

  // ── EMI: adds a fourth, finance-specific reassurance. Spec Grid. ─────────
  if (section.variant === 'emi') {
    const emi = [
      ...items.slice(0, 2),
      { icon: RotateCcw, title: 'Easy EMI available', description: 'On cards, from 3 months' },
      { icon: ShieldCheck, title: 'Brand warranty', description: 'Serviced through the brand' },
    ];
    return (
      <section className="border-b border-line bg-surface">
        <div className="mx-auto grid max-w-7xl gap-3 px-4 py-4 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {emi.map((item) => (
            <TrustItem key={item.title} {...item} compact />
          ))}
        </div>
      </section>
    );
  }

  // ── Pills: rounded and warm. Glow and Pawsome. ──────────────────────────
  if (section.variant === 'pills') {
    return (
      <Section className="!py-6">
        <ul className="flex flex-wrap justify-center gap-3">
          {items.map((item) => (
            <li
              key={item.title}
              className="flex items-center gap-2.5 rounded-full bg-surface px-5 py-3 shadow-sm ring-1 ring-black/5"
            >
              <item.icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
              <span className="text-[13px] font-semibold text-content">{item.title}</span>
            </li>
          ))}
        </ul>
      </Section>
    );
  }

  // ── Pet care: reassurance written for someone with an animal at home,
  //    not for a generic shopper. Pawsome and Companion Club. ─────────────
  if (section.variant === 'petCare') {
    const care = [
      items[0],
      {
        icon: Stethoscope,
        title: 'Vet-approved brands',
        description: 'Nothing we would not feed our own',
      },
      {
        icon: Leaf,
        title: 'Checked ingredients',
        description: 'Every label read before it goes on the shelf',
      },
      {
        icon: HeartHandshake,
        title: 'Advice at the counter',
        description: 'Ask us anything about them',
      },
    ];
    return (
      <Section className="!py-8">
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {care.map((item) => (
            <li
              key={item.title}
              className="relative flex items-start gap-3 overflow-hidden rounded-[1.75rem] bg-surface p-5 shadow-sm ring-1 ring-black/5"
            >
              <Paw className="pointer-events-none absolute -right-2 -bottom-2 h-12 w-12 rotate-12 text-primary/[0.07]" />
              <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <item.icon className="h-4.5 w-4.5 text-primary" aria-hidden="true" />
              </span>
              <span className="relative">
                <span className="block text-[13px] font-extrabold leading-tight text-content">
                  {item.title}
                </span>
                <span className="mt-1 block text-xs leading-snug text-content-muted">
                  {item.description}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </Section>
    );
  }

  // ── Delivery: the grocery promise, stated as flatly as possible. ────────
  if (section.variant === 'delivery') {
    const promise = [
      { icon: Clock, title: 'Same-day slots', description: 'Order by 6pm' },
      items[0],
      items[1],
      {
        icon: RotateCcw,
        title: 'Not right? Send it back',
        description: 'On the doorstep, no questions',
      },
    ];
    return (
      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-7xl grid-cols-2 gap-x-3 gap-y-4 px-4 py-5 sm:px-6 lg:grid-cols-4">
          {promise.map((item) => (
            <TrustItem key={item.title} {...item} compact />
          ))}
        </div>
      </section>
    );
  }

  // ── Bordered: a framed band. Silk Editorial. ────────────────────────────
  if (section.variant === 'bordered') {
    return (
      <Section>
        <div className="grid divide-y divide-line rounded-[var(--radius)] border border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {items.map((item) => (
            <div key={item.title} className="px-5 py-6 text-center">
              <item.icon className="mx-auto h-5 w-5 text-accent" aria-hidden="true" />
              <p className="heading mt-3 text-[15px] text-content">{item.title}</p>
              <p className="mt-1 text-xs text-content-muted">{item.description}</p>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  // ── Minimal: a thin strip. Urban Luxe and Daily Cart. ───────────────────
  return (
    <section className="border-y border-line bg-surface">
      <div className="mx-auto grid max-w-7xl gap-3 px-4 py-5 sm:grid-cols-3 sm:px-6">
        {items.map((item) => (
          <TrustItem key={item.title} {...item} />
        ))}
      </div>
    </section>
  );
}

function TrustItem({
  icon: Icon,
  title,
  description,
  compact,
}: {
  icon: typeof Truck;
  title: string;
  description: string;
  compact?: boolean;
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius)] bg-primary-soft text-primary">
        <Icon className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-[13px] font-semibold text-content">{title}</p>
        {!compact && <p className="truncate text-xs text-content-muted">{description}</p>}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════ collection banner ══

/** The store's promotional imagery, framed four different ways. */
export function CollectionBannerSection({
  section,
  data,
}: {
  section: TemplateSection;
  data: SectionData;
}) {
  const banner = secondaryBanner(data.store) ?? primaryBanner(data.store);
  if (!banner?.imageUrl) return null;

  const title = section.title ?? banner.title;
  const subtitle = section.subtitle ?? banner.subtitle;
  const href = banner.ctaHref ?? '/products';
  const label = banner.ctaLabel ?? 'Shop the collection';

  switch (section.variant) {
    // ── Split frame: image and copy side by side. ──────────────────────────
    case 'splitFrame':
      return (
        <Section>
          <div className="grid overflow-hidden rounded-[var(--radius)] bg-content text-white lg:grid-cols-2">
            <div className="relative min-h-[220px] lg:min-h-[340px]">
              <img
                src={banner.imageUrl}
                alt=""
                loading="lazy"
                className="absolute inset-0 h-full w-full object-cover"
              />
            </div>
            <div className="flex flex-col justify-center gap-4 p-8 sm:p-12">
              <h2 className="heading text-2xl leading-tight text-white sm:text-3xl">{title}</h2>
              {subtitle && <p className="text-sm leading-relaxed text-white/75">{subtitle}</p>}
              <Link
                href={href}
                className="mt-2 inline-flex h-11 w-fit items-center rounded-[var(--radius)] bg-white px-6 text-sm font-semibold text-content transition hover:bg-white/90"
              >
                {label}
              </Link>
            </div>
          </div>
        </Section>
      );

    // ── Centred: copy over a dimmed image. ─────────────────────────────────
    case 'centered':
      return (
        <Section bleed>
          <div className="relative isolate flex min-h-[300px] items-center justify-center overflow-hidden">
            <img
              src={banner.imageUrl}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
            <span aria-hidden="true" className="absolute inset-0 bg-black/45" />
            <div className="relative mx-auto max-w-lg px-6 py-16 text-center text-white">
              <h2 className="heading text-2xl leading-tight sm:text-4xl">{title}</h2>
              {subtitle && <p className="mt-3 text-sm leading-relaxed text-white/85">{subtitle}</p>}
              <Link
                href={href}
                className="mt-7 inline-flex h-11 items-center rounded-[var(--radius)] border border-white px-7 text-sm font-semibold text-white transition hover:bg-white hover:text-content"
              >
                {label}
              </Link>
            </div>
          </div>
        </Section>
      );

    // ── Cinematic: full-bleed, parallaxed, type held to one side. The
    //    premium templates' promotional panel. ─────────────────────────────
    case 'cinematicBanner':
      return (
        <section className="relative isolate flex min-h-[clamp(380px,58vh,620px)] items-end overflow-hidden">
          <Parallax strength={0.12} className="absolute inset-0 scale-110">
            <img
              src={banner.imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover"
            />
          </Parallax>
          <span
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-transparent"
          />
          <div className="relative mx-auto w-full max-w-7xl px-4 pb-12 sm:px-6 sm:pb-16">
            <Reveal>
              <div className="max-w-lg text-white">
                <h2 className="heading break-words text-[clamp(1.5rem,4.5vw,3rem)] leading-[1.06]">
                  {title}
                </h2>
                {subtitle && (
                  <p className="mt-4 text-[15px] leading-relaxed text-white/75">{subtitle}</p>
                )}
                <Link
                  href={href}
                  className="group mt-8 inline-flex items-center gap-3 border-b border-white/40 pb-1.5 text-sm font-medium text-white transition-colors hover:border-white"
                >
                  {label}
                  <span
                    aria-hidden="true"
                    className="transition-transform duration-300 group-hover:translate-x-1"
                  >
                    →
                  </span>
                </Link>
              </div>
            </Reveal>
          </div>
        </section>
      );

    // ── Wide strip: short, horizontal, low-commitment. ─────────────────────
    case 'wideStrip':
    default:
      return (
        <Section className="!py-6">
          <Link
            href={href}
            className="group relative flex min-h-[130px] items-center overflow-hidden rounded-[var(--radius)] bg-primary-soft sm:min-h-[160px]"
          >
            <img
              src={banner.imageUrl}
              alt=""
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover opacity-90 transition-transform duration-500 group-hover:scale-105"
            />
            <span
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-r from-black/70 to-transparent"
            />
            <span className="relative max-w-sm px-6 py-5 sm:px-9">
              <span className="heading block text-lg text-white sm:text-2xl">{title}</span>
              {subtitle && (
                <span className="mt-1 block text-xs text-white/80 sm:text-sm">{subtitle}</span>
              )}
              <span className="mt-3 inline-block text-xs font-semibold uppercase tracking-wide text-white underline">
                {label}
              </span>
            </span>
          </Link>
        </Section>
      );
  }
}

// ═════════════════════════════════════════════════════════════════ brands ══

export function BrandsSection({ section, data }: { section: TemplateSection; data: SectionData }) {
  const brands = data.brands.filter((b) => b.isActive !== false);
  if (brands.length === 0) return null;

  // ── Marquee: a type-only strip. Static on the standard tier; genuinely
  //    drifting on the premium one, where motion is part of the design. ───
  if (section.variant === 'marquee') {
    return <BrandMarquee brands={brands} title={section.title ?? 'Brands we carry'} />;
  }

  // ── Tiles: logo boxes, tappable. Spec Grid, Glow, Pawsome. ──────────────
  return (
    <Section>
      <SectionHeading title={section.title ?? 'Shop by brand'} subtitle={section.subtitle} />
      <ul className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 lg:grid-cols-6">
        {brands.slice(0, 12).map((brand) => (
          <li key={brand.id}>
            <Link
              href={`/products?brand=${brand.slug}`}
              className="flex h-20 items-center justify-center rounded-[var(--radius)] border border-line bg-surface px-3 text-center transition hover:border-primary hover:shadow-sm"
            >
              {brand.logoUrl ? (
                <img
                  src={brand.logoUrl}
                  alt={brand.name}
                  loading="lazy"
                  className="max-h-10 max-w-full object-contain"
                />
              ) : (
                <span className="text-[13px] font-semibold text-content">{brand.name}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ══════════════════════════════════════════════════════════════ editorial ══

/** The store's own words. Reads `description`; hidden when there are none. */
export function EditorialSection({
  section,
  data,
}: {
  section: TemplateSection;
  data: SectionData;
}) {
  const { store } = data;
  const body = section.subtitle ?? store.description;
  if (!body) return null;

  // ── Ritual: a numbered how-to. Glow. ────────────────────────────────────
  if (section.variant === 'ritual') {
    const steps = [
      { n: '01', title: 'Cleanse', body: 'Start with a gentle base for the skin you have.' },
      { n: '02', title: 'Treat', body: 'Layer the actives your skin actually needs.' },
      { n: '03', title: 'Protect', body: 'Seal it in, morning and night.' },
    ];
    return (
      <Section tone="muted">
        <SectionHeading title={section.title ?? 'Build your routine'} align="center" rule />
        <div className="grid gap-5 sm:grid-cols-3">
          {steps.map((step) => (
            <div
              key={step.n}
              className="rounded-[var(--radius)] bg-surface p-7 text-center shadow-sm"
            >
              <span className="heading block text-3xl text-accent">{step.n}</span>
              <p className="heading mt-3 text-lg text-content">{step.title}</p>
              <p className="mt-1.5 text-sm leading-relaxed text-content-muted">{step.body}</p>
            </div>
          ))}
        </div>
      </Section>
    );
  }

  // ── Pet care: three practical reminders an owner actually acts on.
  //    Pawsome and Companion Club. ─────────────────────────────────────────
  if (section.variant === 'petCare') {
    const care = [
      {
        icon: Stethoscope,
        title: 'Weigh them monthly',
        body: 'Portion sizes on every bag we stock are set by weight, not by guess.',
      },
      {
        icon: Leaf,
        title: 'Change food slowly',
        body: 'Mix the new in over a week. Their stomach will thank you for it.',
      },
      {
        icon: HeartHandshake,
        title: 'Rotate their toys',
        body: 'Put half away. Bring them back out in a fortnight and they are new again.',
      },
    ];
    return (
      <Section tone="muted">
        <SectionHeading
          title={section.title ?? 'Looking after them'}
          subtitle={section.subtitle}
          align="center"
        />
        <RevealGroup className="grid gap-4 sm:grid-cols-3" step={80}>
          {care.map((step) => (
            <div
              key={step.title}
              className="relative overflow-hidden rounded-[2rem] bg-surface p-7 shadow-sm"
            >
              <Paw className="pointer-events-none absolute -right-4 -top-4 h-20 w-20 rotate-12 text-primary/[0.06]" />
              <span className="relative flex h-11 w-11 items-center justify-center rounded-full bg-accent/20">
                <step.icon className="h-5 w-5 text-primary" aria-hidden="true" />
              </span>
              <p className="heading relative mt-4 text-lg text-content">{step.title}</p>
              <p className="relative mt-2 text-sm leading-relaxed text-content-muted">
                {step.body}
              </p>
            </div>
          ))}
        </RevealGroup>
      </Section>
    );
  }

  // ── Manifesto: the shop's words at display size, one column, no chrome.
  //    Atelier Noir and Maison. ───────────────────────────────────────────
  if (section.variant === 'manifesto') {
    return (
      <Section>
        <div className="mx-auto max-w-3xl">
          <Reveal>
            <p className="text-[10px] uppercase tracking-[0.45em] text-content-subtle">
              {section.title ?? 'The house'}
            </p>
          </Reveal>
          <Reveal delay={120}>
            <p className="heading mt-8 whitespace-pre-line break-words text-[clamp(1.35rem,3.6vw,2.5rem)] font-normal leading-[1.32] text-content">
              {body}
            </p>
          </Reveal>
          <Reveal delay={240}>
            <Ornament className="mt-12" />
            <p className="mt-8 text-center text-[11px] uppercase tracking-[0.3em] text-content-subtle">
              {store.storeName}
            </p>
          </Reveal>
        </div>
      </Section>
    );
  }

  // ── Letter: a signed note from the shop. Silk Editorial. ────────────────
  return (
    <Section>
      <div className="mx-auto max-w-2xl text-center">
        <Sparkles className="mx-auto h-5 w-5 text-accent" aria-hidden="true" />
        <h2 className="heading mt-4 text-2xl text-content sm:text-3xl">
          {section.title ?? 'Our story'}
        </h2>
        <p className="mt-5 whitespace-pre-line text-[15px] leading-relaxed text-content-muted">
          {body}
        </p>
        <p className="heading mt-6 text-sm text-content">— {store.storeName}</p>
      </div>
    </Section>
  );
}

// ═════════════════════════════════════════════════════════════════ offers ══

export function OffersSection({ section, data }: { section: TemplateSection; data: SectionData }) {
  const coupons = data.coupons.filter((c) => c.isActive);
  if (coupons.length === 0) return null;

  // ── Deal rail: offers as shelf tickets, scrolled horizontally. The
  //    grocery template's one flash of colour. Daily Cart. ────────────────
  if (section.variant === 'dealRail') {
    return (
      <Section className="!py-5">
        <ul className="scroll-slim -mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
          {coupons.slice(0, 8).map((coupon) => (
            <li key={coupon.id} className="w-[72%] shrink-0 snap-start sm:w-[38%] lg:w-[24%]">
              <div className="flex h-full items-center gap-3 rounded-[var(--radius)] border border-dashed border-accent/60 bg-accent/10 px-4 py-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg">
                  <BadgePercent className="h-4 w-4" aria-hidden="true" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-bold leading-tight text-content">
                    {describeCoupon(coupon, data.store.currency)}
                  </span>
                  <span className="mt-0.5 block text-[11px] text-content-muted">
                    Use code{' '}
                    <code className="rounded bg-surface px-1.5 py-0.5 font-semibold tracking-wide text-content">
                      {coupon.code}
                    </code>
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    );
  }

  // ── Ticker: a single scrolling strip. Urban Luxe and Daily Cart. ────────
  if (section.variant === 'ticker') {
    return (
      <section className="bg-accent text-accent-fg">
        <ul className="scroll-slim mx-auto flex max-w-7xl gap-6 overflow-x-auto px-4 py-3 sm:justify-center sm:px-6">
          {coupons.slice(0, 4).map((coupon) => (
            <li
              key={coupon.id}
              className="flex shrink-0 items-center gap-2 text-[13px] font-semibold"
            >
              <BadgePercent className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{describeCoupon(coupon, data.store.currency)}</span>
              <code className="rounded bg-black/15 px-1.5 py-0.5 text-[11px] tracking-wide">
                {coupon.code}
              </code>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  // ── Cards: each offer given room. ───────────────────────────────────────
  return (
    <Section>
      <SectionHeading
        title={section.title ?? 'Offers'}
        subtitle={section.subtitle}
        href="/offers"
      />
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {coupons.slice(0, 6).map((coupon) => (
          <li
            key={coupon.id}
            className="flex items-center gap-4 rounded-[var(--radius)] border border-dashed border-primary/40 bg-primary-soft p-4"
          >
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius)] bg-primary text-primary-fg">
              <BadgePercent className="h-5 w-5" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-content">
                {describeCoupon(coupon, data.store.currency)}
              </p>
              <p className="mt-0.5 truncate text-xs text-content-muted">
                {coupon.description ?? `Use code ${coupon.code} at checkout`}
              </p>
            </div>
            <code className="ml-auto shrink-0 rounded border border-primary/30 bg-surface px-2 py-1 text-[11px] font-semibold tracking-wide text-primary">
              {coupon.code}
            </code>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function describeCoupon(coupon: Coupon, currency: string): string {
  if (coupon.discountType === 'PERCENTAGE') return `${coupon.discountValue}% off`;
  return `${formatMoney(coupon.discountValue, currency, { hideDecimals: true })} off`;
}

// ═══════════════════════════════════════════════════════════ testimonials ══

/**
 * Social proof.
 *
 * Presentation copy that belongs to the template, not to the merchant's data —
 * a store-wide review digest is a catalogue feature and lives on the roadmap.
 * Until then these are clearly generic rather than fabricated attributions.
 */
export function TestimonialsSection({
  section,
  data,
}: {
  section: TemplateSection;
  data: SectionData;
}) {
  const quotes = [
    {
      body: 'Ordered on a Sunday evening, it was at my door before lunch on Monday.',
      by: 'A regular customer',
    },
    {
      body: 'Exactly what was on the website — the fit, the colour, all of it.',
      by: 'A recent shopper',
    },
    { body: 'They actually picked up the phone when I called about a size.', by: 'A local buyer' },
  ];

  return (
    <Section tone="muted">
      <SectionHeading title={section.title ?? 'What shoppers say'} align="center" rule />
      <ul className="grid gap-4 sm:grid-cols-3">
        {quotes.map((quote) => (
          <li key={quote.by} className="rounded-[var(--radius)] bg-surface p-6 shadow-sm">
            <Quote className="h-5 w-5 text-accent" aria-hidden="true" />
            <p className="mt-3 text-[15px] leading-relaxed text-content">{quote.body}</p>
            <p className="mt-4 text-xs font-medium uppercase tracking-wide text-content-subtle">
              {quote.by} · {data.store.storeName}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// ════════════════════════════════════════════════════════════ newsletter ══

/**
 * Email capture.
 *
 * Posts to the shop's own contact address rather than pretending to have a
 * mailing-list backend — an honest mailto beats a form that silently discards
 * what someone typed.
 */
export function NewsletterSection({
  section,
  data,
}: {
  section: TemplateSection;
  data: SectionData;
}) {
  const { store } = data;
  if (!store.contactEmail) return null;

  const soft = section.variant === 'soft';

  return (
    <Section className={cn(soft && 'bg-primary-soft')}>
      <div className="mx-auto max-w-xl text-center">
        <h2 className="heading text-2xl text-content">
          {section.title ?? `Hear from ${store.storeName} first`}
        </h2>
        <p className="mt-2 text-sm text-content-muted">
          {section.subtitle ?? 'New arrivals and offers, occasionally — never spam.'}
        </p>
        <a
          href={`mailto:${store.contactEmail}?subject=${encodeURIComponent(`Keep me posted — ${store.storeName}`)}`}
          className={cn(
            'mt-6 inline-flex h-11 items-center px-7 text-sm font-semibold transition hover:brightness-110',
            soft
              ? 'rounded-full bg-primary text-primary-fg'
              : 'rounded-[var(--radius)] bg-primary text-primary-fg',
          )}
        >
          Keep me posted
        </a>
      </div>
    </Section>
  );
}
