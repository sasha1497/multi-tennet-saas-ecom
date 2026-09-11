/**
 * Public pricing.
 *
 * These four plans mirror the `plans` table exactly — codes, prices (in minor
 * units), trial lengths and the `limits` JSON each one carries. They are stated
 * here rather than fetched because the plans endpoint is authenticated: the
 * platform exposes plans to a signed-in merchant and to a super admin, and
 * nothing unauthenticated. Inventing a public endpoint to feed a marketing page
 * would be an API change, which this work does not make.
 *
 * The trade-off is that this file has to be kept honest by hand. Everything in
 * it is checkable against the seeded plan rows, and nothing is claimed that a
 * plan's feature flags do not actually grant.
 */

export interface MarketingPlan {
  code: string;
  name: string;
  /** Minor units, as stored. Rendered through `formatMoney`. */
  priceMonthly: number;
  priceYearly: number;
  trialDays: number;
  /** One line of positioning — who the plan is for. */
  pitch: string;
  /** Straight from the plan's `limits`. `-1` means unlimited. */
  limits: { products: number; orders: number; staff: number; storageMb: number };
  /** Capabilities this plan's feature flags actually switch on. */
  highlights: string[];
  featured?: boolean;
}

export const MARKETING_PLANS: MarketingPlan[] = [
  {
    code: 'FREE',
    name: 'Free',
    priceMonthly: 0,
    priceYearly: 0,
    trialDays: 0,
    pitch: 'Put a shop online and see how it goes.',
    limits: { products: 25, orders: 100, staff: 1, storageMb: 100 },
    highlights: [
      'Your own storefront address',
      'Product catalogue and orders',
      'Customer accounts and checkout',
    ],
  },
  {
    code: 'STARTER',
    name: 'Starter',
    priceMonthly: 49900,
    priceYearly: 499900,
    trialDays: 14,
    pitch: 'For a shop that has started selling every week.',
    limits: { products: 300, orders: 1000, staff: 3, storageMb: 1000 },
    highlights: [
      'Everything in Free',
      'Coupons and discount codes',
      'Sales, customer and stock reports',
      'Up to 3 staff accounts',
    ],
    featured: true,
  },
  {
    code: 'PRO',
    name: 'Pro',
    priceMonthly: 149900,
    priceYearly: 1499900,
    trialDays: 14,
    pitch: 'For a growing brand that wants its own address.',
    limits: { products: 5000, orders: 20000, staff: 15, storageMb: 10000 },
    highlights: [
      'Everything in Starter',
      'Your own custom domain',
      'Advanced analytics',
      'Delivery and marketing tools',
      'Up to 15 staff accounts',
    ],
  },
  {
    code: 'ENTERPRISE',
    name: 'Enterprise',
    priceMonthly: 499900,
    priceYearly: 4999900,
    trialDays: 0,
    pitch: 'For multi-branch retailers and chains.',
    limits: { products: -1, orders: -1, staff: -1, storageMb: -1 },
    highlights: [
      'Everything in Pro',
      'Multiple branches',
      'Point of sale and loyalty',
      'White-label mobile app',
      'Unlimited products, orders and staff',
    ],
  },
];

/** `-1` in the plan limits means "no ceiling". */
export function formatLimit(value: number): string {
  return value === -1 ? 'Unlimited' : value.toLocaleString('en-IN');
}

/** Storage is stored in megabytes; below a gigabyte, say so rather than "0.1 GB". */
export function formatStorage(megabytes: number): string {
  if (megabytes === -1) return 'Unlimited';
  return megabytes < 1000 ? `${megabytes} MB` : `${Math.round(megabytes / 1000)} GB`;
}
