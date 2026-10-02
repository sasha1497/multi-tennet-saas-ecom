'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  BadgePercent,
  Boxes,
  ChartNoAxesCombined,
  Check,
  ChevronDown,
  CreditCard,
  Globe,
  LayoutTemplate,
  Package,
  Palette,
  Rocket,
  Search,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Sparkles,
  Star,
  Store,
  Truck,
  Users,
  UsersRound,
  Wand2,
} from 'lucide-react';
import { formatMoney } from '@retailos/config';
import { TEMPLATES } from '@retailos/templates';
import { cn } from '@retailos/ui';
import { Section, SectionHead } from './chrome';
import { BrowserFrame, ConsolePreview, TemplateThumb } from './previews';
import { PLAN_COPY, formatLimit, formatStorage } from './plans';
import { api } from '@/lib/api';

/* ===========================================================================
 * Hero
 * ======================================================================== */

export function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/* One restrained wash behind the type, and a grid that fades out before
          it reaches the fold. No gradient anywhere else on the page. */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[46rem] bg-iris-wash"
        aria-hidden="true"
      />
      <div
        className="canvas-grid pointer-events-none absolute inset-x-0 top-0 h-[36rem] [mask-image:linear-gradient(to_bottom,black,transparent)]"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-6xl px-5 pb-6 pt-16 sm:px-6 sm:pt-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-sm font-medium text-content-muted backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            Twelve storefront designs. One console.
          </p>

          <h1 className="mt-6 text-4xl font-semibold text-content sm:text-6xl lg:text-7xl">
            Launch your online store
            <br className="hidden sm:block" />{' '}
            <span className="text-primary">without the complexity.</span>
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg leading-7 text-content-muted sm:text-xl sm:leading-8">
            Pick the kind of shop you run, choose a design, add your products — and start taking
            orders on your own web address. No developers, no plugins, no month-long build.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-md font-semibold text-primary-fg shadow-md transition-[filter,box-shadow] hover:brightness-110 hover:shadow-lg"
            >
              Create your store
              <ArrowRight className="h-4.5 w-4.5" aria-hidden="true" />
            </Link>
            <a
              href="#features"
              className="inline-flex h-12 items-center gap-2 rounded-lg border border-line bg-surface px-6 text-md font-semibold text-content transition-colors hover:bg-surface-muted"
            >
              Explore features
            </a>
          </div>

          <p className="mt-5 text-sm text-content-subtle">
            Free plan available · 14-day trial on paid plans · No card required
          </p>
        </div>

        {/* The product itself, in the console's own design language. */}
        <div className="relative mx-auto mt-16 max-w-5xl">
          <BrowserFrame address="yourshop.retailos.app/dashboard">
            <ConsolePreview />
          </BrowserFrame>
        </div>
      </div>
    </section>
  );
}

/* ===========================================================================
 * Value
 * ======================================================================== */

const VALUES = [
  {
    icon: Rocket,
    title: 'Live in minutes',
    body: 'Sign up and your shop is provisioned, branded and reachable on its own address before your tea goes cold.',
  },
  {
    icon: LayoutTemplate,
    title: 'Designs that fit your trade',
    body: 'Twelve storefronts built for real categories — footwear, electronics, beauty, groceries, pets — not one theme recoloured twelve times.',
  },
  {
    icon: Package,
    title: 'A catalogue that behaves',
    body: 'Variants, photos, categories, brands and stock levels, with low-stock warnings before you sell something you do not have.',
  },
  {
    icon: ShoppingBag,
    title: 'Orders end to end',
    body: 'Take the order, pack it, ship it, mark it delivered — with the status your customer sees kept in step automatically.',
  },
  {
    icon: ChartNoAxesCombined,
    title: 'Numbers you can act on',
    body: 'Revenue trends, best sellers, repeat customers and stock health, in one place instead of four spreadsheets.',
  },
  {
    icon: ShieldCheck,
    title: 'Your data stays yours',
    body: 'Every shop gets its own isolated database. Your catalogue and your customers are never mixed with anyone else’s.',
  },
];

export function Value() {
  return (
    <Section id="why">
      <SectionHead
        eyebrow="Why RetailOS"
        title="Everything a shop needs, nothing it doesn’t"
        description="Built for retailers who want to sell online this month — not commission a project."
      />

      <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
        {VALUES.map((value) => {
          const Icon = value.icon;
          return (
            <div key={value.title} className="bg-surface p-7">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-soft text-primary">
                <Icon className="h-5 w-5" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-md font-semibold text-content">{value.title}</h3>
              <p className="mt-2 text-base leading-6 text-content-muted">{value.body}</p>
            </div>
          );
        })}
      </div>
    </Section>
  );
}

/* ===========================================================================
 * How it works
 * ======================================================================== */

const STEPS = [
  {
    n: '01',
    title: 'Create your store',
    body: 'Your name, your shop name and what you sell. We provision your storefront and its own database on the spot.',
    icon: Store,
  },
  {
    n: '02',
    title: 'Choose your design',
    body: 'Browse designs matched to your trade, preview your real shop in each one, and switch whenever you like.',
    icon: Palette,
  },
  {
    n: '03',
    title: 'Add your products',
    body: 'Photos, prices, variants and stock. Group them into the categories your customers will browse.',
    icon: Package,
  },
  {
    n: '04',
    title: 'Start selling',
    body: 'Publish, share your address, and run the whole shop — orders, customers, stock — from one console.',
    icon: Rocket,
  },
];

export function HowItWorks() {
  return (
    <Section id="how" tone="muted">
      <SectionHead
        eyebrow="How it works"
        title="Four steps from idea to first order"
        description="The setup is the product. Nothing here needs a developer, a plugin or a migration."
      />

      <ol className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          return (
            <li key={step.n} className="relative">
              {/* A rule joining the steps, drawn between cards rather than through
                  them, and only where there is a next step to point at. */}
              {i < STEPS.length - 1 && (
                <span
                  className="absolute left-full top-9 hidden h-px w-6 bg-line lg:block"
                  aria-hidden="true"
                />
              )}
              <div className="h-full rounded-2xl border border-line bg-surface p-6">
                <div className="flex items-center justify-between">
                  <span className="nums text-2xl font-semibold text-primary/30">{step.n}</span>
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-soft text-primary">
                    <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                  </span>
                </div>
                <h3 className="mt-5 text-md font-semibold text-content">{step.title}</h3>
                <p className="mt-2 text-base leading-6 text-content-muted">{step.body}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Section>
  );
}

/* ===========================================================================
 * Console showcase
 * ======================================================================== */

const SHOWCASE_POINTS = [
  {
    icon: ChartNoAxesCombined,
    title: 'Know where you stand',
    body: 'Revenue, orders, new customers and average order value — each against the period before it.',
  },
  {
    icon: ShoppingBag,
    title: 'Nothing slips',
    body: 'Orders waiting on you are surfaced first, before the charts, every time you open the console.',
  },
  {
    icon: Boxes,
    title: 'Stock you can trust',
    body: 'Low-stock and out-of-stock variants are called out by name, not buried in a report.',
  },
  {
    icon: Search,
    title: 'Reach anything instantly',
    body: 'One keystroke opens a command bar that jumps to any screen — or straight to a product by name.',
  },
];

export function Showcase() {
  return (
    <Section id="console">
      <SectionHead
        eyebrow="The console"
        title="Everything your store needs. In one place."
        description="One screen to open in the morning, and four sections that answer everything else."
      />

      <div className="mt-14 grid items-center gap-12 lg:grid-cols-[1fr_1.15fr]">
        <ul className="space-y-8">
          {SHOWCASE_POINTS.map((point) => {
            const Icon = point.icon;
            return (
              <li key={point.title} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-surface text-primary">
                  <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                </span>
                <div>
                  <h3 className="text-md font-semibold text-content">{point.title}</h3>
                  <p className="mt-1.5 text-base leading-6 text-content-muted">{point.body}</p>
                </div>
              </li>
            );
          })}
        </ul>

        <BrowserFrame address="yourshop.retailos.app/dashboard" className="lg:-mr-8">
          <ConsolePreview />
        </BrowserFrame>
      </div>
    </Section>
  );
}

/* ===========================================================================
 * Templates
 * ======================================================================== */

/**
 * The design gallery.
 *
 * Read straight from `@retailos/templates` — the same registry the storefront
 * renders from — so a design added to the product appears here without anyone
 * remembering to update a marketing page, and a design that does not exist can
 * never be advertised.
 */
export function Templates() {
  const groups = Array.from(new Set(TEMPLATES.map((t) => t.group)));
  const shown = TEMPLATES.slice(0, 8);

  return (
    <Section id="templates" tone="muted">
      <SectionHead
        eyebrow="Storefront designs"
        title="Designed for every kind of business"
        description="Each design is its own layout and typography — not a colour swap. Preview your real shop in any of them, and switch whenever you want."
      />

      <div className="mt-8 flex flex-wrap justify-center gap-2">
        {groups.map((group) => (
          <span
            key={group}
            className="rounded-full border border-line bg-surface px-3 py-1 text-sm font-medium text-content-muted"
          >
            {group}
          </span>
        ))}
      </div>

      <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {shown.map((template) => (
          <article
            key={template.id}
            className="group overflow-hidden rounded-2xl border border-line bg-surface p-3 transition-[box-shadow,border-color] hover:border-primary/40 hover:shadow-md"
          >
            <TemplateThumb
              swatches={template.swatches}
              name={template.name}
              heading={template.tagline}
            />
            <div className="flex items-start justify-between gap-2 px-1 pb-1 pt-3.5">
              <div className="min-w-0">
                <h3 className="truncate text-base font-semibold text-content">{template.name}</h3>
                <p className="mt-0.5 line-clamp-2 text-sm text-content-muted">{template.tagline}</p>
              </div>
              {template.tier === 'premium' && (
                <span className="shrink-0 rounded-full bg-brandAccent/10 px-2 py-0.5 text-2xs font-semibold uppercase tracking-label text-brandAccent">
                  Premium
                </span>
              )}
            </div>
          </article>
        ))}
      </div>

      <p className="mt-8 text-center text-base text-content-muted">
        {TEMPLATES.length} designs available today, across {groups.length} categories.
      </p>
    </Section>
  );
}

/* ===========================================================================
 * Features
 * ======================================================================== */

const FEATURE_GROUPS: {
  title: string;
  items: { icon: typeof Package; label: string; body: string }[];
}[] = [
  {
    title: 'Run the shop',
    items: [
      {
        icon: Package,
        label: 'Products and variants',
        body: 'Sizes, colours, SKUs, multiple photos per product and per-variant pricing.',
      },
      {
        icon: Boxes,
        label: 'Inventory',
        body: 'Stock per variant, bulk adjustments, an audit trail and low-stock thresholds you set.',
      },
      {
        icon: ShoppingBag,
        label: 'Orders',
        body: 'The full lifecycle from placed to delivered, with internal notes only your team sees.',
      },
      {
        icon: Users,
        label: 'Customers',
        body: 'Accounts, addresses, order history and who is worth keeping close.',
      },
    ],
  },
  {
    title: 'Grow the shop',
    items: [
      {
        icon: BadgePercent,
        label: 'Discounts',
        body: 'Coupon codes with value, percentage, minimum-spend and usage limits.',
      },
      {
        icon: Star,
        label: 'Reviews',
        body: 'Customer ratings with moderation, so nothing appears on your shop unapproved.',
      },
      {
        icon: ChartNoAxesCombined,
        label: 'Reports',
        body: 'Sales over time, top products, revenue by category, customer and inventory reports.',
      },
      {
        icon: Truck,
        label: 'Delivery and payments',
        body: 'Shipping fees, free-delivery thresholds, cash on delivery and online payment.',
      },
    ],
  },
  {
    title: 'Make it yours',
    items: [
      {
        icon: Palette,
        label: 'Branding',
        body: 'Your logo, your colours and your story, applied across whichever design you pick.',
      },
      {
        icon: Wand2,
        label: 'Home page builder',
        body: 'Reorder, hide and retitle the sections on your home page, and preview before publishing.',
      },
      {
        icon: Globe,
        label: 'Your own address',
        body: 'A storefront address from day one, and a custom domain on Pro and above.',
      },
      {
        icon: UsersRound,
        label: 'Team access',
        body: 'Invite staff with roles and per-permission control over what each one can reach.',
      },
    ],
  },
];

export function Features() {
  return (
    <Section id="features">
      <SectionHead
        eyebrow="Features"
        title="The whole shop, actually built"
        description="Everything listed here is in the product today. Nothing on this page is a roadmap item."
      />

      <div className="mt-14 space-y-12">
        {FEATURE_GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="eyebrow mb-5">{group.title}</h3>
            <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              {group.items.map((item) => {
                const Icon = item.icon;
                return (
                  <div
                    key={item.label}
                    className="rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-primary/30"
                  >
                    <Icon className="h-5 w-5 text-primary" aria-hidden="true" />
                    <h4 className="mt-4 text-base font-semibold text-content">{item.label}</h4>
                    <p className="mt-1.5 text-sm leading-5 text-content-muted">{item.body}</p>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

/* ===========================================================================
 * Pricing
 * ======================================================================== */

export function Pricing() {
  const [yearly, setYearly] = useState(false);
  // Prices come from the plans table, never from this file.
  const { data: plans, isError } = useQuery({
    queryKey: ['public-plans'],
    queryFn: () => api().plans.list(),
    staleTime: 5 * 60_000,
  });

  return (
    <Section id="pricing" tone="muted">
      <SectionHead
        eyebrow="Pricing"
        title="Pick a plan. Try it free for two weeks."
        description="Every plan includes the storefront, the catalogue, orders and the console. Move up or down whenever you like — your shop stays exactly as it is."
      />

      <div className="mt-8 flex justify-center">
        <div
          role="group"
          aria-label="Billing period"
          className="inline-flex items-center gap-0.5 rounded-lg border border-line bg-surface p-0.5"
        >
          {[
            { value: false, label: 'Monthly' },
            { value: true, label: 'Yearly' },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={yearly === option.value}
              onClick={() => setYearly(option.value)}
              className={cn(
                'rounded-md px-4 py-1.5 text-base font-medium transition-colors',
                yearly === option.value
                  ? 'bg-primary text-primary-fg'
                  : 'text-content-muted hover:text-content',
              )}
            >
              {option.label}
              {option.value && (
                <span className="ml-1.5 text-2xs font-semibold opacity-80">2 months free</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {!plans && !isError && (
        <div className="mt-10 grid gap-5 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[520px] animate-pulse rounded-2xl border border-line bg-surface" />
          ))}
        </div>
      )}
      {isError && (
        <p className="mt-10 text-center text-sm text-content-muted">
          Prices could not be loaded just now.{' '}
          <Link href="/register" className="font-semibold text-primary">
            Start your free trial
          </Link>{' '}
          and see every plan inside the console.
        </p>
      )}

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {(plans ?? []).map((row) => {
          const copy = PLAN_COPY[row.code];
          const plan = {
            ...row,
            pitch: copy?.pitch ?? row.description ?? '',
            highlights: copy?.highlights ?? [],
            featured: copy?.featured ?? false,
          };
          const price = yearly ? plan.priceYearly : plan.priceMonthly;
          return (
            <article
              key={plan.code}
              className={cn(
                'relative flex flex-col rounded-2xl border bg-surface p-6',
                plan.featured
                  ? 'border-primary shadow-lg ring-1 ring-primary/20'
                  : 'border-line',
              )}
            >
              {plan.featured && (
                <span className="absolute -top-2.5 left-6 rounded-full bg-primary px-2.5 py-0.5 text-2xs font-semibold uppercase tracking-label text-primary-fg">
                  Most popular
                </span>
              )}

              <h3 className="text-md font-semibold text-content">{plan.name}</h3>
              <p className="mt-1 text-sm leading-5 text-content-muted">{plan.pitch}</p>

              <p className="mt-5 flex items-baseline gap-1">
                <span className="nums text-3xl font-semibold text-content">
                  {price === 0 ? 'Free' : formatMoney(price, 'INR', { hideDecimals: true })}
                </span>
                {price > 0 && (
                  <span className="text-sm text-content-subtle">/{yearly ? 'year' : 'month'}</span>
                )}
              </p>
              <p className="mt-1 h-4 text-2xs text-content-subtle">
                {plan.trialDays > 0 ? `${plan.trialDays}-day free trial` : ' '}
              </p>

              <Link
                href="/register"
                className={cn(
                  'mt-5 inline-flex h-10 items-center justify-center rounded-lg text-base font-semibold transition-[filter,background-color]',
                  plan.featured
                    ? 'bg-primary text-primary-fg shadow-xs hover:brightness-110'
                    : 'border border-line text-content hover:bg-surface-muted',
                )}
              >
                {plan.trialDays > 0 ? 'Start free trial' : 'Create your store'}
              </Link>

              <dl className="mt-6 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-line pt-5 text-sm">
                <div>
                  <dt className="text-content-subtle">Products</dt>
                  <dd className="nums font-medium text-content">{formatLimit(plan.limits.max_products)}</dd>
                </div>
                <div>
                  <dt className="text-content-subtle">Orders / month</dt>
                  <dd className="nums font-medium text-content">{formatLimit(plan.limits.max_orders_per_month)}</dd>
                </div>
                <div>
                  <dt className="text-content-subtle">Staff</dt>
                  <dd className="nums font-medium text-content">{formatLimit(plan.limits.max_staff)}</dd>
                </div>
                <div>
                  <dt className="text-content-subtle">Storage</dt>
                  <dd className="nums font-medium text-content">
                    {formatStorage(plan.limits.max_storage_mb)}
                  </dd>
                </div>
              </dl>

              <ul className="mt-5 space-y-2.5 border-t border-line pt-5">
                {plan.highlights.map((highlight) => (
                  <li key={highlight} className="flex gap-2.5 text-sm text-content-muted">
                    <Check
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success-600"
                      aria-hidden="true"
                    />
                    {highlight}
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>

      <p className="mt-8 text-center text-sm text-content-subtle">
        Prices in Indian rupees. Change or cancel your plan from the console at any time.
      </p>
    </Section>
  );
}

/* ===========================================================================
 * FAQ
 * ======================================================================== */

const FAQS = [
  {
    q: 'How long does it take to get my store online?',
    a: 'Signing up provisions your storefront and its own database in a few seconds. From there, choosing a design and adding your first products is the only work left — most shops are taking orders the same day.',
  },
  {
    q: 'Do I need to know anything technical?',
    a: 'No. There is nothing to install, host or update. You pick a design, fill in your products and publish; everything underneath is run for you.',
  },
  {
    q: 'Can I change my storefront design later?',
    a: 'Yes, as often as you like. Switching design changes how your shop looks and nothing else — your products, orders, customers and stock are untouched, and you can preview your real shop in a design before you commit to it.',
  },
  {
    q: 'Is my shop’s data separate from other shops?',
    a: 'Every shop is provisioned with its own isolated database. Your catalogue, customers and orders are never stored alongside another retailer’s.',
  },
  {
    q: 'Can my team help run the shop?',
    a: 'Yes. Invite staff with a role, and tune exactly which parts of the console each person can reach — from a manager who handles orders to someone who only updates stock.',
  },
  {
    q: 'What happens when my trial ends?',
    a: 'Nothing disappears. You choose a plan from the console when you are ready, and your shop keeps running on the plan you pick.',
  },
  {
    q: 'Can customers pay online?',
    a: 'Yes. You can take online payments, cash on delivery, or both — and set your own shipping fee and free-delivery threshold.',
  },
];

export function Faq() {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <Section id="faq">
      <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionHead
          eyebrow="FAQ"
          title="Questions, answered"
          description="If something is not covered here, ask us before you sign up."
          align="left"
        />

        <div className="divide-y divide-line border-y border-line">
          {FAQS.map((faq, i) => {
            const expanded = open === i;
            return (
              <div key={faq.q}>
                <h3>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-controls={`faq-${i}`}
                    onClick={() => setOpen(expanded ? null : i)}
                    className="flex w-full items-center justify-between gap-4 py-5 text-left"
                  >
                    <span className="text-md font-medium text-content">{faq.q}</span>
                    <ChevronDown
                      className={cn(
                        'h-4.5 w-4.5 shrink-0 text-content-subtle transition-transform duration-200',
                        expanded && 'rotate-180',
                      )}
                      aria-hidden="true"
                    />
                  </button>
                </h3>
                <div id={`faq-${i}`} hidden={!expanded}>
                  <p className="pb-5 pr-10 text-base leading-6 text-content-muted">{faq.a}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </Section>
  );
}

/* ===========================================================================
 * Final call to action
 * ======================================================================== */

export function FinalCta() {
  return (
    <Section className="!py-16">
      <div className="relative overflow-hidden rounded-3xl bg-rail px-6 py-16 text-center sm:px-12">
        <div
          className="pointer-events-none absolute inset-0 opacity-60 bg-iris-wash"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-2xl">
          <h2 className="text-3xl font-semibold text-rail-fg sm:text-4xl">
            Your store is closer than you think
          </h2>
          <p className="mt-4 text-lg leading-7 text-rail-muted">
            Create it now, look at it in a design you like, and decide about a plan later. Nothing
            is charged today.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/register"
              className="inline-flex h-12 items-center gap-2 rounded-lg bg-primary px-6 text-md font-semibold text-primary-fg shadow-lg transition-[filter] hover:brightness-110"
            >
              Create your store
              <ArrowRight className="h-4.5 w-4.5" aria-hidden="true" />
            </Link>
            <Link
              href="/login"
              className="inline-flex h-12 items-center rounded-lg border border-rail-line px-6 text-md font-semibold text-rail-fg transition-colors hover:bg-rail-raised"
            >
              Sign in
            </Link>
          </div>
          <p className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-1.5 text-sm text-rail-subtle">
            <span className="inline-flex items-center gap-1.5">
              <CreditCard className="h-3.5 w-3.5" aria-hidden="true" />
              No card required
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
              Works on any device
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
              Your own isolated database
            </span>
          </p>
        </div>
      </div>
    </Section>
  );
}
