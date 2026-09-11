/**
 * @retailos/templates — the storefront presentation catalogue.
 *
 * Pure data and pure functions. No React, no database, no business logic, so
 * the API, the merchant console and the storefront can all agree on what a
 * template *is* without any of them depending on the others.
 *
 * The one rule this package exists to enforce: a template describes how a
 * store looks and never what a store sells. Switching one is a single-field
 * write against `store_settings`; products, orders, customers, payments and
 * inventory are not in scope and are not touched.
 */
export type {
  TemplateGroup,
  TemplateTier,
  TemplateMotion,
  RevealStyle,
  HoverStyle,
  SectionKind,
  ProductSource,
  TemplateSection,
  TemplateTheme,
  HeaderVariant,
  FooterVariant,
  ProductCardVariant,
  ProductDetailVariant,
  TemplateLayout,
  TemplateDefinition,
  TemplateCustomization,
  StoreTemplateConfig,
  ResolvedTemplate,
} from './types';

export { TEMPLATE_GROUPS, NO_MOTION } from './types';
export { TEMPLATES, FALLBACK_TEMPLATE_ID } from './registry';
export {
  listTemplates,
  getTemplate,
  templateExists,
  recommendedTemplates,
  templatesByTier,
  isRecommendedFor,
  defaultTemplateFor,
  defaultTemplateConfig,
  sanitiseCustomization,
  resolveTemplate,
  builderSections,
} from './resolve';
export {
  SECTIONS_PARAM,
  MAX_ENCODED_LENGTH,
  encodePreviewCustomization,
  decodePreviewCustomization,
} from './preview';
