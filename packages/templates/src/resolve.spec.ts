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

describe('recommendations', () => {
  it('puts templates built for the category first and still returns the rest', () => {
    const ranked = recommendedTemplates('Mobile Shop');
    expect(ranked[0].id).toBe('spec-grid');
    expect(ranked).toHaveLength(TEMPLATES.length);
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
  it('returns the pinned version when it exists', () => {
    expect(getTemplate('urban-luxe', 1)!.version).toBe(1);
  });

  it('falls forward to the newest version when the pin is withdrawn', () => {
    const resolved = getTemplate('urban-luxe', 99);
    expect(resolved!.id).toBe('urban-luxe');
    expect(resolved!.version).toBe(1);
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
    const backToA = resolveTemplate({ templateId: 'urban-luxe', templateVersion: 1, customization });

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
