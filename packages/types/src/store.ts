/** Tenant-scoped storefront configuration + branding. */

/**
 * Which storefront design this store renders through.
 *
 * The entire presentation layer, expressed as three fields. Switching a
 * template writes exactly this object and nothing else — no product, order,
 * customer, payment or inventory row is read or written by the operation.
 *
 * The shape mirrors `StoreTemplateConfig` in `@retailos/templates`; it is
 * restated here so `@retailos/types` stays dependency-free, and the two are
 * kept in step by `store-template.spec.ts` in the templates package.
 */
export interface StoreTemplate {
  /** Template id from the catalogue, e.g. `urban-luxe`. */
  templateId: string;
  /** The version the store adopted. Pinned so a template update cannot surprise it. */
  templateVersion: number;
  /** The merchant's presentation preferences, layered on the template. */
  customization: {
    hiddenSections?: string[];
    shownSections?: string[];
    sectionOrder?: string[];
    sectionText?: Record<string, { title?: string | null; subtitle?: string | null }>;
  };
}

export interface StoreTheme {
  primaryColor: string;
  accentColor: string;
  /** Rounded corner scale used across the storefront. */
  radius: 'none' | 'sm' | 'md' | 'lg' | 'full';
  fontFamily: string;
  /** Optional dark-mode override for the storefront. */
  colorMode: 'light' | 'dark' | 'system';
}

export interface StoreBanner {
  id: string;
  title: string;
  subtitle: string | null;
  imageUrl: string;
  mobileImageUrl: string | null;
  ctaLabel: string | null;
  ctaHref: string | null;
  sortOrder: number;
  isActive: boolean;
}

export interface StoreBusinessHours {
  /** 0 = Sunday. */
  day: number;
  open: string | null;
  close: string | null;
  closed: boolean;
}

export interface StoreSettings {
  id: string;
  storeName: string;
  tagline: string | null;
  description: string | null;
  logoUrl: string | null;
  faviconUrl: string | null;
  theme: StoreTheme;
  /** The active storefront design. Presentation only — see `StoreTemplate`. */
  template: StoreTemplate;
  banners: StoreBanner[];

  contactEmail: string | null;
  contactPhone: string | null;
  whatsappNumber: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  country: string;

  currency: string;
  currencySymbol: string;
  /** Basis points, e.g. 500 = 5.00 %. Applied when a product has no own rate. */
  defaultTaxRateBps: number;
  taxInclusivePricing: boolean;

  /** Minor units. Orders below this are rejected. */
  minOrderAmount: number;
  /** Minor units. Flat fee added when the order is below `freeShippingThreshold`. */
  shippingFee: number;
  freeShippingThreshold: number;

  codEnabled: boolean;
  onlinePaymentEnabled: boolean;
  /** Refuse to sell past zero available stock. */
  allowBackorder: boolean;

  businessHours: StoreBusinessHours[];
  socialLinks: Record<string, string>;
  isPublished: boolean;
  maintenanceMessage: string | null;

  updatedAt: string;
}

/**
 * The bootstrap payload every storefront/mobile session fetches first.
 * Resolved purely from the request Host — never from a client-supplied tenant id.
 */
export interface StorefrontBootstrap {
  tenant: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  store: StoreSettings;
  categories: import('./catalog').CategoryTreeNode[];
  features: Record<string, boolean>;
}

/**
 * `template` is deliberately absent: presentation changes go through the
 * dedicated template endpoint, so a settings save can never move a store's
 * design by accident.
 */
export interface UpdateStoreSettingsRequest
  extends Partial<Omit<StoreSettings, 'id' | 'updatedAt' | 'template'>> {}

/**
 * Switch template, adjust the current template's customisation, or both.
 *
 * Omitting `templateId` keeps the active template and edits only its
 * customisation — that is the store builder. Supplying a different one is a
 * template switch: presentation is replaced, business data is untouched.
 */
export interface UpdateStoreTemplateRequest {
  templateId?: string;
  customization?: StoreTemplate['customization'];
}

/**
 * What one store may do with one catalogue template.
 *
 * Computed by the API from the store's entitlements and the platform's publish
 * state. Clients render it (a lock, an upgrade prompt); they never decide it.
 */
export interface TemplateAccess {
  /** 'standard' | 'premium' | '3d'. */
  family: string;
  /** The store's plan unlocks this template's family. */
  allowed: boolean;
  /** A super admin has not withdrawn it from the gallery. */
  published: boolean;
  /** The feature key that unlocks the family, e.g. `templates_premium`. */
  featureKey: string;
  /** The cheapest public plan that includes the family — for upgrade copy. */
  requiredPlan: string;
}
