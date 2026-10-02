import type { TemplateDefinition, TemplateTier } from './types';

/**
 * Which plan feature unlocks each template family.
 *
 * Access is granted to a *family*, never to an individual template: a merchant
 * entitled to premium can use every premium template, including ones published
 * after they subscribed, and switch between them freely. That is the whole
 * model — there is no per-template purchase anywhere in the system.
 *
 * The keys are plain strings (they match `FeatureKey` in `@retailos/types`) so
 * this package stays dependency-free.
 */
export const FAMILY_FEATURE_KEY: Readonly<Record<TemplateTier, string>> = {
  standard: 'templates_standard',
  premium: 'templates_premium',
  '3d': 'templates_3d',
};

/** The cheapest public plan that unlocks a family, for upgrade prompts only. */
export const FAMILY_MINIMUM_PLAN: Readonly<Record<TemplateTier, string>> = {
  standard: 'STARTER',
  premium: 'GROWTH',
  '3d': 'PRO',
};

export function familyFeatureKey(tier: TemplateTier): string {
  return FAMILY_FEATURE_KEY[tier];
}

/**
 * Whether a set of effective features allows a template.
 *
 * Standard is the floor: it is allowed unless a plan *explicitly* switches it
 * off, so a tenant whose entitlements predate the family keys — or who has
 * lapsed to the free floor — still has a working storefront to choose from.
 * Premium and 3D need an explicit `true`.
 *
 * This is the rule; enforcing it is the API's job. A client may call this to
 * draw a lock icon, but must never be the thing that decides.
 */
export function isTemplateAllowed(
  template: Pick<TemplateDefinition, 'tier'>,
  features: Readonly<Record<string, boolean | undefined>>,
): boolean {
  const value = features[familyFeatureKey(template.tier)];
  return template.tier === 'standard' ? value !== false : value === true;
}

/** Families a set of features unlocks, in gallery order. */
export function allowedFamilies(
  features: Readonly<Record<string, boolean | undefined>>,
): TemplateTier[] {
  return (['standard', 'premium', '3d'] as const).filter((tier) =>
    isTemplateAllowed({ tier }, features),
  );
}
