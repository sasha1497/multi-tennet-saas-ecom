/**
 * The presentation layer's vocabulary.
 *
 * Nothing in this file knows what a product costs, who ordered it or how much
 * stock is left. A template describes *how a storefront looks* — its sections,
 * their order, the component variants that render them and the type/colour
 * system they render in. Business data is passed to it; it never owns any.
 *
 * That separation is what makes template switching a one-field write. See
 * `resolve.ts` and `docs/TEMPLATES.md`.
 */

/**
 * The template family: standard, premium or 3D.
 *
 * A tier is a promise about the *experience*, not a feature flag: premium
 * templates are separate designs with their own layouts and motion, never an
 * existing template with animation switched on, and a 3D template adds a
 * WebGL layer on top of a complete 2D design that it falls back to. All three
 * render the same business data through the same components — see
 * `docs/TEMPLATES.md`.
 *
 * Access is granted per family, never per template: see `entitlement.ts`.
 */
export type TemplateTier = 'standard' | 'premium' | '3d';

export const TEMPLATE_TIERS: readonly TemplateTier[] = ['standard', 'premium', '3d'] as const;

/** Top-level grouping used by the template gallery's filter rail. */
export type TemplateGroup =
  'Fashion' | 'Retail' | 'Technology' | 'Beauty' | 'Lifestyle' | 'Specialised';

export const TEMPLATE_GROUPS: readonly TemplateGroup[] = [
  'Fashion',
  'Retail',
  'Technology',
  'Beauty',
  'Lifestyle',
  'Specialised',
] as const;

/**
 * The kinds of section a storefront home page can be built from.
 *
 * A kind is a *contract*: it says which slice of store data the section reads.
 * A template chooses which kinds it uses and which variant renders each one, so
 * two templates can both show `productRow` and look nothing alike.
 */
export type SectionKind =
  /** Full-bleed opening statement. Reads store banners + branding. */
  | 'hero'
  /** Delivery / payment / authenticity reassurance strip. Reads store settings. */
  | 'trustStrip'
  /** Category navigation block. Reads the category tree. */
  | 'categories'
  /** A titled row or grid of products. Reads a product list. */
  | 'productRow'
  /** Large image-led promotional panel. Reads store banners. */
  | 'collectionBanner'
  /** Brand / manufacturer strip. Reads brands. */
  | 'brands'
  /** Long-form copy panel — the store's own story. Reads store description. */
  | 'editorial'
  /** Coupon / offer strip. Reads publicly advertised coupons. */
  | 'offers'
  /** Social proof. Static per template until reviews are aggregated store-wide. */
  | 'testimonials'
  /** Email capture. */
  | 'newsletter';

/** Which product list a `productRow` section pulls. */
export type ProductSource = 'featured' | 'popular' | 'newest';

/**
 * One section in a template's home-page layout.
 *
 * `id` is the stable handle a merchant's customisation refers to. It must never
 * change for a published template version — a stored `hiddenSections: ['hero']`
 * has to keep meaning the same section a year later.
 */
export interface TemplateSection {
  id: string;
  kind: SectionKind;
  /** Template-specific renderer variant, e.g. `split`, `fullBleed`, `marquee`. */
  variant: string;
  /** Default heading. The merchant may override it in customisation. */
  title?: string;
  /** Default sub-heading. The merchant may override it in customisation. */
  subtitle?: string;
  /** For `productRow`: which list to read. */
  source?: ProductSource;
  /** For `productRow`: how many products to pull. */
  limit?: number;
  /** Whether the merchant is allowed to hide this section in the builder. */
  removable: boolean;
  /** Whether it is on by default for a store that has never customised. */
  defaultVisible: boolean;
}

/** Type, colour and spacing personality. Merged with the merchant's branding. */
export interface TemplateTheme {
  primaryColor: string;
  accentColor: string;
  /** Page background for the storefront shell. */
  surfaceColor: string;
  /** Ink colour for body copy. */
  contentColor: string;
  radius: 'none' | 'sm' | 'md' | 'lg' | 'full';
  /** CSS font stack for headings. */
  headingFont: string;
  /** CSS font stack for body copy. */
  bodyFont: string;
  headingWeight: 400 | 500 | 600 | 700 | 800 | 900;
  /** Heading letter-spacing, e.g. `-0.03em` or `0.18em`. */
  headingTracking: string;
  headingTransform: 'none' | 'uppercase';
  /** Vertical rhythm between sections. */
  density: 'compact' | 'regular' | 'airy';
}

export type HeaderVariant =
  /** Wordmark centred over a wide-tracked nav rail. Fashion editorial. */
  | 'editorial'
  /** Serif wordmark, centred nav, hairline rules. Boutique. */
  | 'classic'
  /** Search-forward single bar with a category strip. Marketplace. */
  | 'utility'
  /** Rounded, pill-shaped, low contrast. Beauty. */
  | 'soft'
  /** Chunky, colour-blocked, oversized targets. Pet. */
  | 'playful'
  /** Aisle-first: a category mega-strip above a dense utility bar. Grocery. */
  | 'aisle'
  /** Almost nothing: wordmark, one menu affordance. Luxury. */
  | 'minimal'
  /** Transparent over the hero, solidifying on scroll. Premium. */
  | 'floating'
  /** Masthead: announcement rule, oversized left wordmark, small-caps nav. */
  | 'lookbook'
  /** Chunky floating pill bar with a solid call to action. Modern D2C. */
  | 'bold';

export type FooterVariant =
  | 'editorial'
  | 'columns'
  | 'compact'
  | 'soft'
  /** Oversized wordmark over a thin link row. Luxury and premium. */
  | 'statement'
  /** Numbered index columns under a rule. Editorial and lookbook. */
  | 'index'
  /** A high-contrast closing panel with an oversized call to action. D2C. */
  | 'bold';

export type ProductCardVariant =
  /** No chrome, type-led, image does the work. */
  | 'editorial'
  /** Framed and centred, serif title. */
  | 'portrait'
  /** Bordered, rating and EMI line, contained image. */
  | 'spec'
  /** Rounded, shadowed, warm. */
  | 'soft'
  /** Minimum height per product. */
  | 'compact'
  /** Price and add-to-basket forward, unit line. Grocery. */
  | 'grocery'
  /** Overlaid caption on a tall image, no border at all. Luxury. */
  | 'overlay'
  /** Image swaps to the second photograph on hover. Premium. */
  | 'reveal'
  /** A numbered plate: hairline rule, serif name, price on the baseline. */
  | 'plate'
  /** Rounded tile with a solid price chip. Modern D2C. */
  | 'tile';

export type ProductDetailVariant =
  | 'gallerySplit'
  | 'stickyPanel'
  | 'stackedGallery'
  | 'specSheet'
  /** Full-bleed imagery with the buy panel floating over it. Premium. */
  | 'immersive'
  /**
   * The product's photographs on a WebGL turntable the shopper can drag to
   * turn. 3D family; falls back to `gallerySplit` without WebGL.
   */
  | 'turntable';

/** How a section arrives as it scrolls into view. */
export type RevealStyle =
  /** No motion at all. The standard tier's default. */
  | 'none'
  /** Opacity only. The quietest option that still reads as intentional. */
  | 'fade'
  /** Opacity plus a short upward translate. */
  | 'rise'
  /** Opacity plus a scale — for imagery rather than text. */
  | 'zoom'
  /** The element is unmasked from below. Editorial and luxury. */
  | 'clip';

/** What happens when a pointer rests on a product card. */
export type HoverStyle = 'none' | 'lift' | 'zoom' | 'glow';

/**
 * A template's motion personality.
 *
 * Every value here degrades to nothing under `prefers-reduced-motion` — that is
 * handled once, in the storefront's motion module and stylesheet, rather than
 * being each template's problem. See `templates/motion.tsx`.
 */
export interface TemplateMotion {
  reveal: RevealStyle;
  /** Whether items in a row arrive one after another rather than together. */
  stagger: boolean;
  /** Hero imagery drifts slower than the page. Heroes only. */
  parallax: boolean;
  hover: HoverStyle;
  /** Navigation reacts to scroll position (shrinks, or gains a background). */
  stickyNav: boolean;
}

/** Motion off. What every standard template gets unless it says otherwise. */
export const NO_MOTION: TemplateMotion = {
  reveal: 'none',
  stagger: false,
  parallax: false,
  hover: 'none',
  stickyNav: false,
};

export interface TemplateLayout {
  header: HeaderVariant;
  footer: FooterVariant;
  productCard: ProductCardVariant;
  productDetail: ProductDetailVariant;
  /** Product-grid columns per breakpoint. Drives the listing and every row. */
  gridColumns: { base: number; sm: number; lg: number; xl: number };
  /** Product image aspect ratio, as a CSS `aspect-ratio` value. */
  productAspect: string;
}

/**
 * A complete storefront design.
 *
 * `version` exists so a template can evolve without changing what a live store
 * renders: a store pins the version it adopted, and a new major version is
 * published as a new entry rather than an edit. See `resolve.ts`.
 */
export interface TemplateDefinition {
  id: string;
  name: string;
  version: number;
  group: TemplateGroup;
  /** Standard or premium. Drives the gallery's tier rail. */
  tier: TemplateTier;
  /** Short positioning line shown on the gallery card. */
  tagline: string;
  description: string;
  /**
   * Business categories this template is designed for. Drives the "Recommended
   * for your store" rail. Matched case-insensitively against `Tenant.businessCategory`.
   */
  businessTypes: readonly string[];
  /** Three colours shown as a swatch trio on the gallery card. */
  swatches: readonly [string, string, string];
  theme: TemplateTheme;
  layout: TemplateLayout;
  motion: TemplateMotion;
  sections: readonly TemplateSection[];
  /** Marketing flags for the gallery rails. */
  badges?: readonly ('New' | 'Popular' | 'Premium' | '3D')[];
}

/**
 * The merchant's presentation preferences, layered on top of a template.
 *
 * Deliberately additive and template-agnostic: everything here degrades to a
 * no-op against a template that does not have the section it names, which is
 * what lets a merchant switch templates and keep their branding.
 */
export interface TemplateCustomization {
  /** Section ids the merchant switched off. Wins over everything else. */
  hiddenSections?: string[];
  /**
   * Section ids the merchant switched on. Only meaningful for sections a
   * template ships with `defaultVisible: false`; listing one here opts into it.
   */
  shownSections?: string[];
  /** Section ids in the merchant's preferred order. Unknown ids are ignored. */
  sectionOrder?: string[];
  /** Per-section heading overrides. */
  sectionText?: Record<string, { title?: string | null; subtitle?: string | null }>;
}

/**
 * What a store stores. Three presentation-only fields — this is the entire
 * footprint template switching has on the database.
 */
export interface StoreTemplateConfig {
  templateId: string;
  templateVersion: number;
  customization: TemplateCustomization;
}

/** A template with the merchant's customisation already applied. */
export interface ResolvedTemplate {
  template: TemplateDefinition;
  /** Visible sections, in the merchant's order. Safe to render directly. */
  sections: TemplateSection[];
  /** True when the stored template id was unknown and a fallback was used. */
  fellBack: boolean;
}
