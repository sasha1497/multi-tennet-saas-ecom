-- Razorpay Partner OAuth for tenant payments.
--
-- Additive only. New nullable/defaulted columns on tenant_payment_configs and
-- payment_routes; no column is dropped, renamed or retyped.
--
-- Existing stores that pasted their own Razorpay keys keep working: they are
-- backfilled as connection_type 'keys' and, where a secret is present,
-- onboarding_status 'CONNECTED'.
--
-- Rollback:
--   DROP INDEX "payment_routes_provider_provider_payment_id_idx";
--   ALTER TABLE "payment_routes" DROP COLUMN "provider_payment_id";
--   DROP INDEX "tenant_payment_configs_provider_provider_account_id_key";
--   ALTER TABLE "tenant_payment_configs"
--     DROP COLUMN "connection_type", DROP COLUMN "onboarding_status",
--     DROP COLUMN "provider_account_id", DROP COLUMN "encrypted_access_token",
--     DROP COLUMN "encrypted_refresh_token", DROP COLUMN "access_token_expires_at",
--     DROP COLUMN "refresh_token_expires_at", DROP COLUMN "connected_at",
--     DROP COLUMN "status_reason";

ALTER TABLE "tenant_payment_configs"
  ADD COLUMN "connection_type"          VARCHAR(16) NOT NULL DEFAULT 'keys',
  ADD COLUMN "onboarding_status"        VARCHAR(24) NOT NULL DEFAULT 'NOT_CONNECTED',
  ADD COLUMN "provider_account_id"      VARCHAR(64),
  ADD COLUMN "encrypted_access_token"   TEXT,
  ADD COLUMN "encrypted_refresh_token"  TEXT,
  ADD COLUMN "access_token_expires_at"  TIMESTAMPTZ(6),
  ADD COLUMN "refresh_token_expires_at" TIMESTAMPTZ(6),
  ADD COLUMN "connected_at"             TIMESTAMPTZ(6),
  ADD COLUMN "status_reason"            VARCHAR(300);

UPDATE "tenant_payment_configs"
   SET "onboarding_status" = 'CONNECTED', "connected_at" = "updated_at"
 WHERE "encrypted_secret_key" IS NOT NULL OR "provider" = 'mock';

-- One Razorpay account can back one store. NULLs (not yet connected) are
-- allowed to repeat.
CREATE UNIQUE INDEX "tenant_payment_configs_provider_provider_account_id_key"
  ON "tenant_payment_configs" ("provider", "provider_account_id");

ALTER TABLE "payment_routes" ADD COLUMN "provider_payment_id" VARCHAR(128);
CREATE INDEX "payment_routes_provider_provider_payment_id_idx"
  ON "payment_routes" ("provider", "provider_payment_id");
