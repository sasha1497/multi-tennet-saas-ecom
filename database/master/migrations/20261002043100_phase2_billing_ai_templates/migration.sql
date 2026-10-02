-- Phase 2: subscription invoices, template publish state, AI usage metering.
--
-- Purely additive: three new tables and two new enum types. No existing table
-- or column is altered, so every current tenant, subscription and entitlement
-- reads exactly as before, and template switching is unaffected (it stays a
-- write to the tenant database's `store_settings`).
--
-- Rollback (safe at any time; nothing else references these tables):
--   DROP TABLE "ai_generations";
--   DROP TABLE "template_publications";
--   DROP TABLE "subscription_invoices";
--   DROP TYPE "AiGenerationStatus";
--   DROP TYPE "InvoiceStatus";
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261002043100_phase2_billing_ai_templates';

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'VOID');

-- CreateEnum
CREATE TYPE "AiGenerationStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "subscription_invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "reference" VARCHAR(128) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'PENDING',
    "plan_code" VARCHAR(32) NOT NULL,
    "plan_name" VARCHAR(80) NOT NULL,
    "amount" INTEGER NOT NULL,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "period_start" TIMESTAMPTZ(6) NOT NULL,
    "period_end" TIMESTAMPTZ(6) NOT NULL,
    "paid_at" TIMESTAMPTZ(6),
    "failure_reason" VARCHAR(500),
    "provider" VARCHAR(32) NOT NULL DEFAULT 'simulated',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscription_invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_publications" (
    "template_id" VARCHAR(64) NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(500),
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "template_publications_pkey" PRIMARY KEY ("template_id")
);

-- CreateTable
CREATE TABLE "ai_generations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "kind" VARCHAR(48) NOT NULL,
    "input_hash" VARCHAR(64) NOT NULL,
    "status" "AiGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "output" JSONB,
    "provider" VARCHAR(32) NOT NULL,
    "model" VARCHAR(64) NOT NULL,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "error" VARCHAR(500),
    "user_id" UUID,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "ai_generations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "subscription_invoices_reference_key" ON "subscription_invoices"("reference");

-- CreateIndex
CREATE INDEX "subscription_invoices_tenant_id_created_at_idx" ON "subscription_invoices"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "subscription_invoices_status_created_at_idx" ON "subscription_invoices"("status", "created_at");

-- CreateIndex
CREATE INDEX "ai_generations_tenant_id_created_at_idx" ON "ai_generations"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "ai_generations_tenant_id_kind_input_hash_idx" ON "ai_generations"("tenant_id", "kind", "input_hash");

-- AddForeignKey
ALTER TABLE "subscription_invoices" ADD CONSTRAINT "subscription_invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_generations" ADD CONSTRAINT "ai_generations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
