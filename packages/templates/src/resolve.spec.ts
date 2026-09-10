import { TEMPLATES } from './registry';
import {
  builderSections,
  defaultTemplateConfig,
  defaultTemplateFor,
  getTemplate,
  isRecommendedFor,
  recommendedTemplates,
  resolveTemplate,
  sanitiseCustomization,
} from './resolve';
import type { StoreTemplateConfig } from './types';

describe('template registry', () => {
  it('gives every template a unique id/version pair', () => {
    const keys = TEMPLATES.map((t) => `${t.id}@${t.version}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every section within a template a unique id', () => {
    for (const template of TEMPLATES) {
      const ids = template.sections.map((s) => s.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('keeps at least one non-removable section so a store can never render empty', () => {
    for (const template of TEMPLATES) {
      expect(template.sections.some((s) => !s.removable && s.defaultVisible)).toBe(true);
    }
  });

  it('gives every productRow section a source and a limit', () => {
    for (const template of TEMPLATES) {
      for (const section of template.sections) {
        if (section.kind !== 'productRow') continue;
        expect(section.source).toBeDefined();
        expect(section.limit).toBeGreaterThan(0);
      }
    }
  });
});

/**
 * The catalogue's reason for existing.
 *
 * "Six templates" is worthless if two of them are the same page in different
 * colours — which is exactly what a design system drifts towards, because
 * reusing a layout is always the cheapest change. These assertions make
 * sameness a build failure rather than something someone notices in a demo.
 */
describe('templates are genuinely different designs', () => {
  /** Everything about a template except its palette. */
  const structure = (t: (typeof TEMPLATES)[number]) =>
    JSON.stringify({
      layout: t.layout,
      density: t.theme.density,
      radius: t.theme.radius,
      transform: t.theme.headingTransform,
      sections: t.sections.map((s) => `${s.kind}:${s.variant}`),
    });

  it('gives no two templates the same structure', () => {
    const seen = new Map<string, string>();
    for (const template of TEMPLATES) {
      const key = structure(template);
      const clash = seen.get(key);
      expect(clash ? `${clash} and ${template.name} are the same design` : null).toBeNull();
      seen.set(key, template.name);
    }
  });

  it('gives no two templates the same header, footer and card combination', () => {
    const seen = new Map<string, string>();
    for (const template of TEMPLATES) {
      const { header, footer, productCard, productDetail } = template.layout;
      const key = `${header}/${footer}/${productCard}/${productDetail}`;
      const clash = seen.get(key);
      expect(clash ? `${clash} and ${template.name} share a chrome` : null).toBeNull();
      seen.set(key, template.name);
    }
  });

  it('keeps the two fashion templates structurally distinct', () => {
    // The specific complaint that prompted the redesign: these two used to
    // read as one template with a different palette.
    const urban = getTemplate('urban-luxe')!;
    const silk = getTemplate('silk-editorial')!;

    expect(urban.layout.header).not.toBe(silk.layout.header);
    expect(urban.layout.footer).not.toBe(silk.layout.footer);
    expect(urban.layout.productCard).not.toBe(silk.layout.productCard);
    expect(urban.theme.headingTransform).not.toBe(silk.theme.headingTransform);
    expect(urban.layout.gridColumns).not.toEqual(silk.layout.gridColumns);
    expect(structure(urban)).not.toBe(structure(silk));
  });

  it('gives each template its own opening', () => {
    const heroes = TEMPLATES.map((t) => t.sections.find((s) => s.kind === 'hero')?.variant);
    expect(heroes.every(Boolean)).toBe(true);
    // Two templates may share a hero variant only if they are different tiers
    // of the same industry — Pawsome and Companion Club, by design.
    const counts = new Map<string, number>();
    for (const hero of heroes) counts.set(hero!, (counts.get(hero!) ?? 0) + 1);
    for (const [, count] of counts) expect(count).toBeLessThanOrEqual(2);
  });
});

describe('tiers', () => {
  it('ships both tiers', () => {
    expect(TEMPLATES.some((t) => t.tier === 'standard')).toBe(true);
    expect(TEMPLATES.some((t) => t.tier === 'premium')).toBe(true);
  });

  it('keeps the original six standard templates in the catalogue', () => {
    // Adding a premium tier must never remove what merchants already use.
    for (const id of [
      'urban-luxe',
      'spec-grid',
      'glow-beauty',
      'pawsome',
      'daily-cart',
      'silk-editorial',
    ]) {
      expect(getTemplate(id)).not.toBeNull();
      expect(getTemplate(id)!.tier).toBe('standard');
    }
  });

  it('gives every premium template real motion, and standard templates none that needs scroll', () => {
    for (const template of TEMPLATES) {
      if (template.tier === 'premium') {
        expect(template.motion.reveal).not.toBe('none');
      } else {
        // Standard templates may have a hover state; they must not pay for
        // scroll observers, parallax or a scroll-reactive header.
        expect(template.motion.reveal).toBe('none');
        expect(template.motion.parallax).toBe(false);
        expect(template.motion.stickyNav).toBe(false);
      }
    }
  });

  it('declares a motion personality on every template', () => {
    for (const template of TEMPLATES) {
      expect(template.motion).toBeDefined();
      expect(typeof template.motion.hover).toBe('string');
    }
  });
});

describe('recommendations', () => {
  it('puts templates built for the category first and still returns the rest', () => {
    const ranked = recommendedTemplates('Mobile Shop');
    // Both the standard and the premium electronics design match, and both
    // rank above every template that does not.
    const matching = ranked.filter((t) => t.businessTypes.includes('Mobile Shop'));
    expect(matching.length).toBeGreaterThan(1);
    expect(ranked.slice(0, matching.length)).toEqual(matching);
    expect(ranked).toHaveLength(TEMPLATES.length);
  });

  it('ranks the standard tier above premium within a match', () => {
    const ranked = recommendedTemplates('Mobile Shop');
    expect(ranked[0].tier).toBe('standard');
    expect(ranked[0].id).toBe('spec-grid');
  });

  it('never starts a new store on a premium template', () => {
    // Premium is a choice made in the gallery, not something provisioning does
    // on a merchant's behalf — a cinematic opening is the wrong first
    // impression for a store with no photographs yet.
    for (const category of ['Jewellery', 'Mobile Shop', 'Pet Shop', "Men's Wear", 'Grocery']) {
      expect(defaultTemplateFor(category).tier).toBe('standard');
    }
  });

  it('matches business categories case- and punctuation-insensitively', () => {
    expect(isRecommendedFor(getTemplate('silk-editorial')!, "women's wear")).toBe(true);
    expect(isRecommendedFor(getTemplate('silk-editorial')!, 'Womenswear')).toBe(true);
  });

  it('falls back to the full catalogue for an unknown category', () => {
    expect(recommendedTemplates('Submarine Parts')).toHaveLength(TEMPLATES.length);
    expect(recommendedTemplates(null)).toHaveLength(TEMPLATES.length);
  });

  it('always has a default template, even with no category', () => {
    expect(defaultTemplateFor(undefined)).toBeDefined();
    expect(defaultTemplateFor('Cosmetics').id).toBe('glow-beauty');
  });
});

describe('version pinning', () => {
  const current = getTemplate('urban-luxe')!.version;

  it('returns the pinned version when it exists', () => {
    expect(getTemplate('urban-luxe', current)!.version).toBe(current);
  });

  it('falls forward to the newest version when the pin is withdrawn', () => {
    // A store pinned to a version no longer published keeps its template and
    // gains the newest revision of it, rather than losing its design.
    const resolved = getTemplate('urban-luxe', 99);
    expect(resolved!.id).toBe('urban-luxe');
    expect(resolved!.version).toBe(current);
  });

  it('never falls back to an older version than the one pinned', () => {
    expect(getTemplate('urban-luxe', 1)!.version).toBeGreaterThanOrEqual(1);
  });

  it('returns null for an unknown id', () => {
    expect(getTemplate('does-not-exist')).toBeNull();
  });
});

describe('resolveTemplate', () => {
  const config = (over: Partial<StoreTemplateConfig> = {}): StoreTemplateConfig => ({
    templateId: 'urban-luxe',
    templateVersion: 1,
    customization: {},
    ...over,
  });

  it('renders the template a store points at', () => {
    expect(resolveTemplate(config()).template.id).toBe('urban-luxe');
  });

  it('falls back rather than throwing when the stored id is unknown', () => {
    const result = resolveTemplate(config({ templateId: 'deleted-template' }), {
      businessCategory: 'Grocery',
    });
    expect(result.fellBack).toBe(true);
    expect(result.template.id).toBe('daily-cart');
  });

  it('renders a default template for a store that has never chosen one', () => {
    const result = resolveTemplate(null, { businessCategory: 'Cosmetics' });
    expect(result.template.id).toBe('glow-beauty');
    expect(result.sections.length).toBeGreaterThan(0);
  });

  it('hides sections the merchant switched off', () => {
    const result = resolveTemplate(config({ customization: { hiddenSections: ['testimonials'] } }));
    expect(result.sections.map((s) => s.id)).not.toContain('testimonials');
  });

  it('refuses to hide a non-removable section', () => {
    const result = resolveTemplate(config({ customization: { hiddenSections: ['hero'] } }));
    expect(result.sections.map((s) => s.id)).toContain('hero');
  });

  it('applies the merchant order and appends sections they never sorted', () => {
    const result = resolveTemplate(
      config({ customization: { sectionOrder: ['trending', 'hero'] } }),
    );
    const ids = result.sections.map((s) => s.id);
    expect(ids[0]).toBe('trending');
    expect(ids[1]).toBe('hero');
    expect(ids).toContain('featured');
  });

  it('applies section heading overrides', () => {
    const result = resolveTemplate(
      config({ customization: { sectionText: { trending: { title: 'Hot this week' } } } }),
    );
    expect(result.sections.find((s) => s.id === 'trending')?.title).toBe('Hot this week');
  });

  it('previews another template without consulting the stored one', () => {
    const stored = config({ templateId: 'urban-luxe' });
    const result = resolveTemplate(stored, { overrideTemplateId: 'spec-grid' });
    expect(result.template.id).toBe('spec-grid');
    // The stored config is untouched — preview is read-only by construction.
    expect(stored.templateId).toBe('urban-luxe');
  });
});

describe('customisation survives template switching', () => {
  // The product guarantee: A → B → C → A returns the merchant to exactly the
  // design they left, because customisation is stored, not rebuilt.
  it('keeps stored customisation intact through a round trip', () => {
    const customization = {
      hiddenSections: ['testimonials'],
      sectionOrder: ['trending', 'hero'],
      sectionText: { trending: { title: 'Hot this week' } },
    };

    const a = resolveTemplate({ templateId: 'urban-luxe', templateVersion: 1, customization });
    const b = resolveTemplate({ templateId: 'spec-grid', templateVersion: 1, customization });
    const backToA = resolveTemplate({
      templateId: 'urban-luxe',
      templateVersion: 1,
      customization,
    });

    expect(a.sections.map((s) => s.id)).toEqual(backToA.sections.map((s) => s.id));
    expect(backToA.sections.find((s) => s.id === 'trending')?.title).toBe('Hot this week');
    // Spec Grid has no `trending` or `testimonials` section; the customisation
    // naming them is simply not applied there rather than corrupting the render.
    expect(b.sections.length).toBeGreaterThan(0);
    expect(b.template.id).toBe('spec-grid');
  });

  it('does not write the ignored ids back into the sanitised value', () => {
    const specGrid = getTemplate('spec-grid')!;
    const cleaned = sanitiseCustomization(specGrid, {
      hiddenSections: ['testimonials', 'offers'],
      sectionOrder: ['trending', 'brands'],
    });
    expect(cleaned.hiddenSections).toEqual(['offers']);
    expect(cleaned.sectionOrder).toEqual(['brands']);
  });
});

describe('builderSections', () => {
  it('lists every section with its visibility, in the merchant order', () => {
    const rows = builderSections({
      templateId: 'urban-luxe',
      templateVersion: 1,
      customization: { hiddenSections: ['testimonials'], sectionOrder: ['trending'] },
    });
    expect(rows).toHaveLength(getTemplate('urban-luxe')!.sections.length);
    expect(rows[0].section.id).toBe('trending');
    expect(rows.find((r) => r.section.id === 'testimonials')?.visible).toBe(false);
    expect(rows.find((r) => r.section.id === 'hero')?.visible).toBe(true);
  });
});

describe('defaultTemplateConfig', () => {
  it('produces a config the resolver accepts', () => {
    const cfg = defaultTemplateConfig("Men's Wear");
    expect(cfg.templateId).toBe('urban-luxe');
    expect(resolveTemplate(cfg).fellBack).toBe(false);
  });
});
