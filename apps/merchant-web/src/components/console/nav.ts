import {
  BadgePercent,
  Boxes,
  Building2,
  ChartNoAxesCombined,
  CreditCard,
  Gauge,
  IndianRupee,
  LayoutDashboard,
  LayoutTemplate,
  Package,
  Palette,
  Receipt,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Star,
  Tags,
  Users,
  UsersRound,
  Wallet,
  Wand2,
  type LucideIcon,
} from 'lucide-react';
import { Permission } from '@retailos/types';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** One line for the command palette. Never rendered in the rail. */
  hint: string;
  /** Hidden when the signed-in user lacks this permission. */
  permission?: Permission;
  /** Matches the route exactly rather than by prefix — for section parents. */
  exact?: boolean;
  /** Extra words the command palette should match on. */
  keywords?: string[];
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/**
 * Console information architecture.
 *
 * Grouped around the four questions a shop owner actually moves between —
 * how is the shop doing, what do I sell, who is buying it, and what does my
 * storefront look like — with account-level concerns last because they are
 * visited once a month, not once an hour.
 *
 * Two deliberate changes from the flat list this replaced: Analytics sits
 * beside the Dashboard rather than being buried under billing (it answers the
 * same question, just in more detail), and the storefront group leads with
 * Design, because that is the page merchants return to.
 *
 * Every entry maps to a route that already exists. Nothing here is aspirational.
 */
export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Overview',
    items: [
      {
        href: '/dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        hint: 'Revenue, orders and stock at a glance',
        permission: Permission.REPORTS_READ,
        exact: true,
        keywords: ['home', 'overview', 'summary'],
      },
      {
        href: '/reports',
        label: 'Analytics',
        icon: ChartNoAxesCombined,
        hint: 'Sales, customer and inventory reports',
        permission: Permission.REPORTS_READ,
        keywords: ['reports', 'insights', 'revenue', 'statistics'],
      },
    ],
  },
  {
    title: 'Catalogue',
    items: [
      {
        href: '/products',
        label: 'Products',
        icon: Package,
        hint: 'Everything you sell',
        permission: Permission.PRODUCTS_READ,
        keywords: ['catalogue', 'items', 'stock keeping'],
      },
      {
        href: '/categories',
        label: 'Categories',
        icon: Tags,
        hint: 'How your catalogue is organised',
        permission: Permission.CATEGORIES_READ,
        keywords: ['collections', 'brands', 'taxonomy'],
      },
      {
        href: '/inventory',
        label: 'Inventory',
        icon: Boxes,
        hint: 'Stock levels and adjustments',
        permission: Permission.INVENTORY_READ,
        keywords: ['stock', 'warehouse', 'low stock'],
      },
    ],
  },
  {
    title: 'Selling',
    items: [
      {
        href: '/orders',
        label: 'Orders',
        icon: ShoppingBag,
        hint: 'Fulfil, update and track orders',
        permission: Permission.ORDERS_READ,
        keywords: ['sales', 'fulfilment', 'shipping', 'returns'],
      },
      {
        href: '/customers',
        label: 'Customers',
        icon: Users,
        hint: 'Who is buying from you',
        permission: Permission.CUSTOMERS_READ,
        keywords: ['buyers', 'shoppers', 'crm'],
      },
      {
        href: '/coupons',
        label: 'Coupons',
        icon: BadgePercent,
        hint: 'Discount codes and offers',
        permission: Permission.COUPONS_READ,
        keywords: ['discounts', 'promotions', 'offers', 'sale'],
      },
      {
        href: '/reviews',
        label: 'Reviews',
        icon: Star,
        hint: 'Moderate customer reviews',
        permission: Permission.REVIEWS_READ,
        keywords: ['ratings', 'feedback', 'moderation'],
      },
    ],
  },
  {
    title: 'Storefront',
    items: [
      {
        href: '/store',
        label: 'Design',
        icon: Palette,
        hint: 'Your storefront’s look and branding',
        permission: Permission.STORE_DESIGN,
        exact: true,
        keywords: ['theme', 'branding', 'colours', 'logo'],
      },
      {
        href: '/store/templates',
        label: 'Templates',
        icon: LayoutTemplate,
        hint: 'Browse and switch storefront designs',
        permission: Permission.STORE_DESIGN,
        keywords: ['themes', 'designs', 'gallery'],
      },
      {
        href: '/store/customize',
        label: 'Home page',
        icon: Wand2,
        hint: 'Arrange the sections on your home page',
        permission: Permission.STORE_DESIGN,
        keywords: ['customise', 'sections', 'layout', 'builder'],
      },
      {
        href: '/store/settings',
        label: 'Store settings',
        icon: SlidersHorizontal,
        hint: 'Address, delivery, payments and policies',
        permission: Permission.STORE_DESIGN,
        keywords: ['shipping', 'tax', 'currency', 'policies'],
      },
    ],
  },
  {
    title: 'Account',
    items: [
      {
        href: '/staff',
        label: 'Team',
        icon: UsersRound,
        hint: 'Invite staff and set permissions',
        permission: Permission.STAFF_READ,
        keywords: ['staff', 'users', 'roles', 'permissions'],
      },
      {
        href: '/subscription',
        label: 'Subscription',
        icon: CreditCard,
        hint: 'Your plan, billing and limits',
        keywords: ['billing', 'plan', 'payment', 'upgrade'],
      },
      {
        href: '/settings/payments',
        label: 'Payments',
        icon: Wallet,
        hint: 'Connect Razorpay — how your customers pay you',
        permission: Permission.STORE_MANAGE,
        keywords: ['razorpay', 'gateway', 'upi', 'refund', 'settlement', 'online payment'],
      },
      {
        href: '/settings',
        label: 'Account',
        exact: true,
        icon: Settings,
        hint: 'Your profile and password',
        keywords: ['profile', 'password', 'preferences'],
      },
    ],
  },
];

/** The super-admin surface. A separate rail, because it is a separate product. */
export const PLATFORM_SECTIONS: NavSection[] = [
  {
    title: 'Platform',
    items: [
      {
        href: '/platform',
        label: 'Tenants',
        icon: Building2,
        hint: 'Every store on the platform',
        exact: true,
        keywords: ['stores', 'merchants', 'accounts'],
      },
      {
        href: '/platform/billing',
        label: 'Billing',
        icon: IndianRupee,
        hint: 'Subscriptions, MRR, failed payments and plan moves',
        keywords: ['mrr', 'revenue', 'subscriptions', 'invoices', 'plans'],
      },
      {
        href: '/platform/templates',
        label: 'Templates',
        icon: LayoutTemplate,
        hint: 'Publish and withdraw storefront designs',
        keywords: ['themes', 'designs', 'premium', '3d'],
      },
      {
        href: '/platform/usage',
        label: 'Usage',
        icon: Gauge,
        hint: 'AI, catalogue, orders and team use per store',
        keywords: ['ai', 'quota', 'limits', 'resources'],
      },
      {
        href: '/platform/system',
        label: 'System',
        icon: Receipt,
        hint: 'Provisioning, jobs and platform health',
        keywords: ['health', 'queues', 'jobs', 'status'],
      },
    ],
  },
];

/** Flat list of everything the command palette can jump to. */
export function allNavItems(sections: NavSection[]): NavItem[] {
  return sections.flatMap((section) => section.items);
}

/**
 * Whether a rail entry should read as the current page.
 *
 * Prefix matching by default so `/products/abc` still lights up Products, and
 * `exact` for the section parents (`/store`) that would otherwise stay lit while
 * you are three levels into one of their children.
 */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  return item.exact ? pathname === item.href : pathname.startsWith(item.href);
}
