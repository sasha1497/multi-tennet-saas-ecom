-- ---------------------------------------------------------------------------
-- 0002 — Integrity constraints, search indexes and the store-settings singleton.
--
-- Prisma's schema language cannot express CHECK constraints, partial indexes or
-- trigram search indexes, so they live here. Everything is written to be
-- re-runnable: the migration runner is idempotent, but so is each statement.
-- ---------------------------------------------------------------------------

-- Trigram search. This is what lets `ILIKE '%shoe%'` stay fast enough that we do
-- not need Elasticsearch for the MVP (see docs/DECISION_LOG.md ADR-011).
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;

CREATE INDEX IF NOT EXISTS products_search_text_trgm_idx
  ON products USING GIN (search_text gin_trgm_ops);

CREATE INDEX IF NOT EXISTS products_name_trgm_idx
  ON products USING GIN (name gin_trgm_ops);

-- Storefront listing hot path: published, undeleted products newest-first.
CREATE INDEX IF NOT EXISTS products_published_idx
  ON products (published_at DESC)
  WHERE status = 'PUBLISHED' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS products_featured_published_idx
  ON products (sold_count DESC)
  WHERE is_featured = true AND status = 'PUBLISHED' AND deleted_at IS NULL;

-- Slug lookups always filter out soft-deleted rows.
CREATE INDEX IF NOT EXISTS products_slug_active_idx
  ON products (slug)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS customers_search_trgm_idx
  ON customers USING GIN (
    (coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' ||
     coalesce(email, '') || ' ' || coalesce(phone, '')) gin_trgm_ops
  );

CREATE INDEX IF NOT EXISTS orders_number_trgm_idx
  ON orders USING GIN (order_number gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Integrity constraints
-- ---------------------------------------------------------------------------

-- store_settings holds exactly one row. Forcing the id keeps every code path
-- honest without a trigger.
ALTER TABLE store_settings
  DROP CONSTRAINT IF EXISTS store_settings_singleton;
ALTER TABLE store_settings
  ADD CONSTRAINT store_settings_singleton CHECK (id = 'singleton');

-- Stock can never go negative, and we can never reserve more than we hold.
-- These are the last line of defence behind the application's row locking.
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_quantity_non_negative;
ALTER TABLE inventory
  ADD CONSTRAINT inventory_quantity_non_negative CHECK (quantity >= 0);

ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_reserved_non_negative;
ALTER TABLE inventory
  ADD CONSTRAINT inventory_reserved_non_negative CHECK (reserved >= 0);

ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_reserved_within_quantity;
ALTER TABLE inventory
  ADD CONSTRAINT inventory_reserved_within_quantity CHECK (reserved <= quantity);

-- Money: prices are non-negative and MRP is never below the selling price, so a
-- discount percentage can never come out negative in the UI.
ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_price_non_negative;
ALTER TABLE product_variants
  ADD CONSTRAINT product_variants_price_non_negative CHECK (price >= 0 AND mrp >= 0);

ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS product_variants_mrp_gte_price;
ALTER TABLE product_variants
  ADD CONSTRAINT product_variants_mrp_gte_price CHECK (mrp >= price);

ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_quantity_positive;
ALTER TABLE cart_items
  ADD CONSTRAINT cart_items_quantity_positive CHECK (quantity > 0);

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_quantity_positive;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_quantity_positive CHECK (quantity > 0);

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_amounts_non_negative;
ALTER TABLE order_items
  ADD CONSTRAINT order_items_amounts_non_negative
  CHECK (unit_price >= 0 AND line_total >= 0 AND tax_amount >= 0 AND discount_amount >= 0);

-- An order's total must actually equal its parts. This has caught more bugs in
-- pricing refactors than any test.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_total_consistent;
ALTER TABLE orders
  ADD CONSTRAINT orders_total_consistent
  CHECK (total_amount = subtotal - discount_amount + tax_amount + shipping_amount);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_amounts_non_negative;
ALTER TABLE orders
  ADD CONSTRAINT orders_amounts_non_negative
  CHECK (subtotal >= 0 AND discount_amount >= 0 AND tax_amount >= 0
         AND shipping_amount >= 0 AND total_amount >= 0);

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_refund_within_amount;
ALTER TABLE payments
  ADD CONSTRAINT payments_refund_within_amount
  CHECK (refunded_amount >= 0 AND refunded_amount <= amount);

ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_rating_range;
ALTER TABLE reviews
  ADD CONSTRAINT reviews_rating_range CHECK (rating BETWEEN 1 AND 5);

ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_discount_value_positive;
ALTER TABLE coupons
  ADD CONSTRAINT coupons_discount_value_positive CHECK (discount_value > 0);

ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_percentage_within_100;
ALTER TABLE coupons
  ADD CONSTRAINT coupons_percentage_within_100
  CHECK (discount_type <> 'PERCENTAGE' OR discount_value <= 100);

ALTER TABLE coupons DROP CONSTRAINT IF EXISTS coupons_window_ordered;
ALTER TABLE coupons
  ADD CONSTRAINT coupons_window_ordered
  CHECK (starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at);

-- A customer must be reachable by at least one channel, otherwise they can
-- never log in or receive an order update.
ALTER TABLE customers DROP CONSTRAINT IF EXISTS customers_contact_present;
ALTER TABLE customers
  ADD CONSTRAINT customers_contact_present CHECK (email IS NOT NULL OR phone IS NOT NULL);

-- Exactly one default address per customer.
CREATE UNIQUE INDEX IF NOT EXISTS addresses_one_default_per_customer
  ON addresses (customer_id)
  WHERE is_default = true AND deleted_at IS NULL;

-- Exactly one primary image per product.
CREATE UNIQUE INDEX IF NOT EXISTS product_images_one_primary
  ON product_images (product_id)
  WHERE is_primary = true;

-- A logged-in customer holds at most one active cart.
CREATE UNIQUE INDEX IF NOT EXISTS carts_one_per_customer
  ON carts (customer_id)
  WHERE customer_id IS NOT NULL;
