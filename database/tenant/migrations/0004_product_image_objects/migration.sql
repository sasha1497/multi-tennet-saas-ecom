-- ---------------------------------------------------------------------------
-- 0004 — Product images as object-storage references.
--
-- Before this migration a product image was a URL and nothing else. That is
-- enough to render one and not enough to *own* one: deleting a product could
-- not delete its files, a private bucket could not be used (the stored URL had
-- to be permanently readable), and nothing recorded what had actually been
-- uploaded.
--
-- So the row now carries the object's identity — bucket plus key — alongside
-- the metadata needed to manage it. The bytes stay in MinIO/S3; this table
-- holds a reference and nothing more.
--
-- `url` is kept and stays populated. Existing rows are untouched and keep
-- rendering from it; new rows resolve their URL from `object_key` at read time
-- (a presigned GET on a private bucket), and fall back to `url` when the key is
-- NULL. That is what makes this migration safe to apply to a live store with no
-- coordinated deploy and no backfill.
--
-- Idempotent, like every migration in this directory — the runner may re-apply
-- a partially completed migration after a failure.
-- ---------------------------------------------------------------------------

-- The object's address in the bucket. NULL for images uploaded before this
-- migration, which are still addressed by `url`.
ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS object_key VARCHAR(1024);

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS bucket VARCHAR(255);

-- What the merchant called the file. Display only — never used to build a key.
ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS file_name VARCHAR(255);

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS mime_type VARCHAR(120);

-- Bytes, as reported by the object store after the upload completed.
ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS size_bytes INTEGER;

ALTER TABLE product_images
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT NOW();

-- Two rows must never point at the same object: reordering and re-uploading
-- both go through "insert a row per object", and a duplicate would make
-- deleting one image delete the file the other still shows.
CREATE UNIQUE INDEX IF NOT EXISTS product_images_object_key_key
  ON product_images (object_key)
  WHERE object_key IS NOT NULL;

-- The catalogue reads primary-first, then sort order, on every product page.
CREATE INDEX IF NOT EXISTS product_images_product_primary_idx
  ON product_images (product_id, is_primary, sort_order);

-- ---------------------------------------------------------------------------
-- The order-line thumbnail, as an object reference.
--
-- `order_items` is an immutable snapshot, and its `image_url` was captured from
-- the product's stored URL at checkout. On a private bucket that URL is not
-- fetchable, so the snapshot needs the key as well: the line still records the
-- image it was placed with, and the API mints a presigned GET for it at read
-- time exactly as it does for a product page.
--
-- `image_url` is untouched and still authoritative for orders placed before
-- this migration.
-- ---------------------------------------------------------------------------

ALTER TABLE order_items
  ADD COLUMN IF NOT EXISTS image_key VARCHAR(1024);

COMMENT ON COLUMN order_items.image_key IS
  'Object key for the line thumbnail, snapshotted at checkout. Immutable, like every other column here.';

COMMENT ON COLUMN product_images.object_key IS
  'Key in the object store, e.g. tenants/<tenantId>/products/<productId>/<uuid>.webp. Source of truth for the file.';
COMMENT ON COLUMN product_images.bucket IS
  'Bucket the object lives in, recorded so a bucket migration can be audited.';
COMMENT ON COLUMN product_images.size_bytes IS
  'Size reported by the object store after upload. Metadata only — no image bytes are stored in this database.';
