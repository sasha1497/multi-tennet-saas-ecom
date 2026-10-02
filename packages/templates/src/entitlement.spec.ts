import { allowedFamilies, FAMILY_FEATURE_KEY, isTemplateAllowed } from './entitlement';
import { TEMPLATES } from './registry';
import { TEMPLATE_TIERS } from './types';

describe('template family entitlement', () => {
  const standard = { tier: 'standard' as const };
  const premium = { tier: 'premium' as const };
  const threeD = { tier: '3d' as const };

  it('maps every family to a feature key', () => {
    for (const tier of TEMPLATE_TIERS) expect(FAMILY_FEATURE_KEY[tier]).toMatch(/^templates_/);
  });

  it('treats standard as the floor unless a plan explicitly removes it', () => {
    expect(isTemplateAllowed(standard, {})).toBe(true);
    expect(isTemplateAllowed(standard, { templates_standard: true })).toBe(true);
    expect(isTemplateAllowed(standard, { templates_standard: false })).toBe(false);
  });

  it('requires an explicit grant for premium and 3D', () => {
    expect(isTemplateAllowed(premium, {})).toBe(false);
    expect(isTemplateAllowed(threeD, {})).toBe(false);
    expect(isTemplateAllowed(premium, { templates_premium: true })).toBe(true);
    expect(isTemplateAllowed(threeD, { templates_3d: true })).toBe(true);
  });

  it('grants a whole family at once, including templates added later', () => {
    const features = { templates_standard: true, templates_premium: true };
    const premiumTemplates = TEMPLATES.filter((t) => t.tier === 'premium');
    expect(premiumTemplates.length).toBeGreaterThan(0);
    for (const t of premiumTemplates) expect(isTemplateAllowed(t, features)).toBe(true);
    // A hypothetical premium template published tomorrow needs no new grant.
    expect(isTemplateAllowed({ tier: 'premium' }, features)).toBe(true);
  });

  it('does not let premium imply 3D', () => {
    expect(isTemplateAllowed(threeD, { templates_premium: true })).toBe(false);
  });

  it('lists the families a plan unlocks, in gallery order', () => {
    expect(allowedFamilies({})).toEqual(['standard']);
    expect(allowedFamilies({ templates_premium: true })).toEqual(['standard', 'premium']);
    expect(allowedFamilies({ templates_premium: true, templates_3d: true })).toEqual([
      'standard',
      'premium',
      '3d',
    ]);
  });
});
