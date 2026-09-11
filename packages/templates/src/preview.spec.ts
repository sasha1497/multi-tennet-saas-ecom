import {
  decodePreviewCustomization,
  encodePreviewCustomization,
  MAX_ENCODED_LENGTH,
} from './preview';
import { getTemplate } from './resolve';
import { resolveTemplate } from './resolve';
import type { TemplateCustomization } from './types';

describe('preview customisation codec', () => {
  const draft: TemplateCustomization = {
    hiddenSections: ['brands', 'testimonials'],
    shownSections: ['offers'],
    sectionOrder: ['hero', 'featured', 'categories'],
    sectionText: { featured: { title: 'The edit', subtitle: null } },
  };

  it('round-trips a draft unchanged', () => {
    expect(decodePreviewCustomization(encodePreviewCustomization(draft))).toEqual(draft);
  });

  it('survives non-Latin-1 text a merchant might type', () => {
    const withUnicode: TemplateCustomization = {
      hiddenSections: [],
      shownSections: [],
      sectionOrder: [],
      sectionText: { hero: { title: 'குழந்தைகள் — 50% தள்ளுபடி', subtitle: 'Naïve café' } },
    };
    const decoded = decodePreviewCustomization(encodePreviewCustomization(withUnicode));
    expect(decoded?.sectionText?.hero?.title).toBe('குழந்தைகள் — 50% தள்ளுபடி');
    expect(decoded?.sectionText?.hero?.subtitle).toBe('Naïve café');
  });

  it('produces a value short enough for a URL', () => {
    expect(encodePreviewCustomization(draft).length).toBeLessThan(MAX_ENCODED_LENGTH);
  });

  it('produces url-safe output that needs no further escaping', () => {
    const encoded = encodePreviewCustomization(draft);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(encodeURIComponent(encoded)).toBe(encoded);
  });

  // ── Everything below is the reason this value can be read from a URL ──────

  it.each([
    ['not base64 at all', 'not base64!!'],
    ['valid base64 that is not JSON', Buffer.from('hello').toString('base64url')],
    ['JSON that is not an object', Buffer.from('[1,2,3]').toString('base64url')],
    ['JSON null', Buffer.from('null').toString('base64url')],
    ['an empty string', ''],
  ])('rejects %s', (_label, value) => {
    expect(decodePreviewCustomization(value)).toBeNull();
  });

  it('rejects anything longer than the ceiling without parsing it', () => {
    expect(decodePreviewCustomization('A'.repeat(MAX_ENCODED_LENGTH + 1))).toBeNull();
  });

  it('drops fields of the wrong shape rather than trusting them', () => {
    const hostile = Buffer.from(
      JSON.stringify({
        hiddenSections: 'brands',
        shownSections: [{ nested: true }, 'offers'],
        sectionOrder: [1, 2, 'hero'],
        sectionText: { hero: 'not an object', featured: { title: 42 } },
        somethingElse: 'ignored',
      }),
    ).toString('base64url');

    expect(decodePreviewCustomization(hostile)).toEqual({
      hiddenSections: [],
      shownSections: ['offers'],
      sectionOrder: ['hero'],
      sectionText: { featured: { title: null, subtitle: null } },
    });
  });

  it('caps a heading rather than letting a URL set an unbounded one', () => {
    // Deliberately under the encoded ceiling: the point of this test is the
    // per-field cap, and a longer value would be rejected by the length guard
    // before it ever reached the field.
    const long = Buffer.from(
      JSON.stringify({ sectionText: { hero: { title: 'x'.repeat(1000) } } }),
    ).toString('base64url');
    expect(long.length).toBeLessThan(MAX_ENCODED_LENGTH);

    const title = decodePreviewCustomization(long)?.sectionText?.hero?.title;
    expect(title).toHaveLength(200);
  });
});

describe('previewing a draft against a template', () => {
  const config = {
    templateId: 'urban-luxe',
    templateVersion: 2,
    customization: { hiddenSections: ['offers'] },
  };

  it('renders the draft instead of what is stored', () => {
    const draft: TemplateCustomization = { hiddenSections: ['brands'] };
    const result = resolveTemplate(config, { overrideCustomization: draft });

    const ids = result.sections.map((s) => s.id);
    expect(ids).not.toContain('brands');
    // The stored hide is *replaced* by the draft, not merged into it — the
    // builder always sends a complete draft, so a merchant un-hiding a section
    // must see it come back.
    expect(ids).toContain('offers');
  });

  it('cannot hide a structural section however the draft is written', () => {
    const result = resolveTemplate(config, {
      overrideCustomization: { hiddenSections: ['hero'] },
    });
    expect(result.sections.map((s) => s.id)).toContain('hero');
  });

  it('ignores section ids the template does not have', () => {
    const result = resolveTemplate(config, {
      overrideCustomization: { sectionOrder: ['not-a-section', 'hero'] },
    });
    expect(result.sections).toHaveLength(
      getTemplate('urban-luxe', 2)!.sections.filter((s) => s.defaultVisible).length,
    );
  });

  it('leaves the stored config untouched', () => {
    const stored = { ...config, customization: { hiddenSections: ['offers'] } };
    resolveTemplate(stored, { overrideCustomization: { hiddenSections: ['brands'] } });
    expect(stored.customization).toEqual({ hiddenSections: ['offers'] });
  });
});
