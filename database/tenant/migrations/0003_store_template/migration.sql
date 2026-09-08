-- ---------------------------------------------------------------------------
-- 0003 — Storefront template (presentation layer).
--
-- Adds the three columns that decide how a store *looks*. Nothing here relates
-- to what a store *sells*: no table holding products, variants, orders, order
-- items, customers, payments, inventory or coupons is referenced, so applying
-- this migration cannot alter a single business record.
--
-- All three columns are nullable or defaulted, so existing stores keep working
-- untouched: a NULL `template_id` means "no design chosen yet" and the API
-- resolves one from the tenant's business category at render time.
--
-- Idempotent, like every migration in this directory — the runner may re-apply
-- a partially completed migration after a failure.
-- ---------------------------------------------------------------------------

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS template_id VARCHAR(64);

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS template_version INTEGER NOT NULL DEFAULT 1;

ALTER TABLE store_settings
  ADD COLUMN IF NOT EXISTS template_customization JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN store_settings.template_id IS
  'Storefront design id from the @retailos/templates catalogue. Presentation only.';
COMMENT ON COLUMN store_settings.template_version IS
  'Catalogue version the merchant adopted. Pinned so a template update cannot restyle a live store.';
COMMENT ON COLUMN store_settings.template_customization IS
  'Merchant section overrides: hiddenSections, shownSections, sectionOrder, sectionText.';
