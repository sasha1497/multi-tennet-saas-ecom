import { FALLBACK_TEMPLATE_ID, TEMPLATES } from './registry';
import type {
  ResolvedTemplate,
  StoreTemplateConfig,
  TemplateCustomization,
  TemplateDefinition,
  TemplateSection,
} from './types';

/** Every template in the catalogue, newest version of each id first. */
export function listTemplates(): TemplateDefinition[] {
  return [...TEMPLATES].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Looks a template up by id, honouring a pinned version.
 *
 * Version handling is deliberately forgiving in one direction only: an exact
 * version match always wins, and a store pinned to a version that has since
 * been withdrawn falls forward to the newest version of the same template
 * rather than losing its design entirely. It never falls *back* to an older
 * version than requested.
 */
export function getTemplate(id: string, version?: number): TemplateDefinition | null {
  const candidates = TEMPLATES.filter((t) => t.id === id);
  if (candidates.length === 0) return null;
  if (version !== undefined) {
    const exact = candidates.find((t) => t.version === version);
    if (exact) return exact;
  }
  return candidates.reduce((newest, t) => (t.version > newest.version ? t : newest));
}

export function templateExists(id: string): boolean {
  return TEMPLATES.some((t) => t.id === id);
}

/** Case- and punctuation-insensitive comparison for free-text business categories. */
function normaliseCategory(value: string): string {
  return value.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Templates designed for a business category, best match first, followed by
 * everything else. Always returns the full catalogue — a merchant is never
 * prevented from choosing a design, only guided towards a fitting one.
 */
export function recommendedTemplates(businessCategory?: string | null): TemplateDefinition[] {
  const all = listTemplates();
  if (!businessCategory) return all;

  const needle = normaliseCategory(businessCategory);
  const matches = all.filter((t) =>
    t.businessTypes.some((type) => normaliseCategory(type) === needle),
  );
  if (matches.length === 0) return all;

  const rest = all.filter((t) => !matches.includes(t));
  return [...matches, ...rest];
}

/** True when a template is one of the recommendations for a business category. */
export function isRecommendedFor(template: TemplateDefinition, businessCategory?: string | null): boolean {
  if (!businessCategory) return false;
  const needle = normaliseCategory(businessCategory);
  return template.businessTypes.some((type) => normaliseCategory(type) === needle);
}

/** The template a newly created store in this category starts on. */
export function defaultTemplateFor(businessCategory?: string | null): TemplateDefinition {
  const [first] = recommendedTemplates(businessCategory);
  return first ?? getTemplate(FALLBACK_TEMPLATE_ID)!;
}

/** The presentation config written for a store that has never chosen a template. */
export function defaultTemplateConfig(businessCategory?: string | null): StoreTemplateConfig {
  const template = defaultTemplateFor(businessCategory);
  return { templateId: template.id, templateVersion: template.version, customization: {} };
}

/**
 * Strips a customisation down to what the given template can actually honour.
 *
 * Run on read as well as on write. Customisation outlives the template it was
 * written against — a merchant who hides "testimonials", switches to a template
 * without that section and switches back should find it still hidden — so the
 * stored value is kept intact and only the *applied* value is filtered.
 */
export function sanitiseCustomization(
  template: TemplateDefinition,
  customization: TemplateCustomization | null | undefined,
): TemplateCustomization {
  if (!customization) return {};
  const known = new Set(template.sections.map((s) => s.id));
  const removable = new Set(template.sections.filter((s) => s.removable).map((s) => s.id));

  return {
    // A non-removable section can never be hidden, whatever is stored.
    hiddenSections: (customization.hiddenSections ?? []).filter((id) => removable.has(id)),
    shownSections: (customization.shownSections ?? []).filter((id) => known.has(id)),
    sectionOrder: (customization.sectionOrder ?? []).filter((id) => known.has(id)),
    sectionText: Object.fromEntries(
      Object.entries(customization.sectionText ?? {}).filter(([id]) => known.has(id)),
    ),
  };
}

/**
 * Whether a section renders, given the merchant's choices.
 *
 * Explicitly hidden wins; then explicitly shown; then the template's default.
 * Two lists rather than one so a template can ship an off-by-default section
 * that a merchant can still opt into.
 */
function isVisible(
  section: TemplateSection,
  hidden: ReadonlySet<string>,
  shown: ReadonlySet<string>,
): boolean {
  if (hidden.has(section.id)) return false;
  if (shown.has(section.id)) return true;
  return section.defaultVisible;
}

/**
 * Turns what the store has stored into what the storefront renders.
 *
 * This is the whole of "template switching" on the read side: point at another
 * template id and the same business data comes out through a different design.
 */
export function resolveTemplate(
  config: StoreTemplateConfig | null | undefined,
  options: { businessCategory?: string | null; overrideTemplateId?: string | null } = {},
): ResolvedTemplate {
  // A preview override never touches the stored config — it only changes which
  // definition this one render uses.
  const requestedId = options.overrideTemplateId ?? config?.templateId;
  const requestedVersion = options.overrideTemplateId ? undefined : config?.templateVersion;

  const template =
    (requestedId ? getTemplate(requestedId, requestedVersion) : null) ??
    defaultTemplateFor(options.businessCategory);

  const fellBack = Boolean(requestedId) && template.id !== requestedId;
  const custom = sanitiseCustomization(template, config?.customization);

  const hidden = new Set(custom.hiddenSections ?? []);
  const shown = new Set(custom.shownSections ?? []);
  const text = custom.sectionText ?? {};

  const sections = orderSections(template.sections, custom.sectionOrder ?? [])
    .filter((section) => isVisible(section, hidden, shown))
    .map((section) => {
      const override = text[section.id];
      if (!override) return section;
      return {
        ...section,
        title: override.title ?? section.title,
        subtitle: override.subtitle ?? section.subtitle,
      };
    });

  return { template, sections, fellBack };
}

/**
 * Applies the merchant's order, then appends anything they never sorted.
 *
 * Sections added by a later template version therefore appear at the end rather
 * than disappearing, which is what keeps a stored order forward-compatible.
 */
function orderSections(
  sections: readonly TemplateSection[],
  order: readonly string[],
): TemplateSection[] {
  if (order.length === 0) return [...sections];
  const byId = new Map(sections.map((s) => [s.id, s]));
  const sorted: TemplateSection[] = [];
  for (const id of order) {
    const section = byId.get(id);
    if (section) {
      sorted.push(section);
      byId.delete(id);
    }
  }
  for (const section of sections) {
    if (byId.has(section.id)) sorted.push(section);
  }
  return sorted;
}

/**
 * The sections a merchant sees in the store builder: every section the template
 * defines, in the merchant's order, each flagged with whether it is visible.
 */
export function builderSections(
  config: StoreTemplateConfig | null | undefined,
  options: { businessCategory?: string | null } = {},
): { section: TemplateSection; visible: boolean }[] {
  const template =
    (config?.templateId ? getTemplate(config.templateId, config.templateVersion) : null) ??
    defaultTemplateFor(options.businessCategory);
  const custom = sanitiseCustomization(template, config?.customization);
  const hidden = new Set(custom.hiddenSections ?? []);
  const shown = new Set(custom.shownSections ?? []);

  return orderSections(template.sections, custom.sectionOrder ?? []).map((section) => ({
    section: {
      ...section,
      title: custom.sectionText?.[section.id]?.title ?? section.title,
      subtitle: custom.sectionText?.[section.id]?.subtitle ?? section.subtitle,
    },
    visible: isVisible(section, hidden, shown),
  }));
}
