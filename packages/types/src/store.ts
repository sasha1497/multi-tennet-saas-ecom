/** Tenant-scoped storefront configuration + branding. */

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

export interface UpdateStoreSettingsRequest extends Partial<Omit<StoreSettings, 'id' | 'updatedAt'>> {}
