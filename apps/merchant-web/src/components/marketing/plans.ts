/**
 * Public pricing — the words only.
 *
 * Prices, trial lengths and limits come from `GET /plans`, which reads the
 * plans table: a super admin repricing a plan changes this page with no
 * deploy, and nothing here can drift from what a merchant is actually charged.
 *
 * What lives here is the copy a database row should not hold: one line of
 * positioning per plan and the capabilities it leads with. Keyed by plan code;
 * a plan with no entry still renders, from its own description.
 */

export interface PlanCopy {
  /** One line of positioning — who the plan is for. */
  pitch: string;
  /** What the plan leads with. Every line is something its feature flags grant. */
  highlights: string[];
  featured?: boolean;
}

export const PLAN_COPY: Record<string, PlanCopy> = {
  STARTER: {
    pitch: 'Get your shop online with a fast, clean storefront.',
    highlights: [
      'Six standard storefront designs',
      'Products, categories and stock',
      'Orders, customers and cash on delivery',
      'Your own store address with SSL',
      'AI product upload — 10 a month',
    ],
  },
  GROWTH: {
    pitch: 'For a shop that sells every day and has a team.',
    highlights: [
      'Everything in Starter',
      'All premium storefront designs',
      'Coupons, marketing and loyalty',
      'Customer CRM and advanced analytics',
      'Advanced inventory and push notifications',
      'AI product upload — 50 a month',
    ],
    featured: true,
  },
  PRO: {
    pitch: 'For a brand that wants to stand out, online and at the counter.',
    highlights: [
      'Everything in Growth',
      '3D storefront designs',
      'Point of sale and barcode scanning',
      'Advanced reports and your own domain',
      'AI business assistant',
      'AI product upload — 200 a month',
    ],
  },
};

/** `-1` in the plan limits means "no ceiling". */
export function formatLimit(value: number | undefined): string {
  if (value === undefined) return '—';
  return value === -1 ? 'Unlimited' : value.toLocaleString('en-IN');
}

/** Storage is stored in megabytes; below a gigabyte, say so rather than "0.1 GB". */
export function formatStorage(megabytes: number | undefined): string {
  if (megabytes === undefined) return '—';
  if (megabytes === -1) return 'Unlimited';
  return megabytes < 1000 ? `${megabytes} MB` : `${Math.round(megabytes / 1000)} GB`;
}
