-- CreateTable
CREATE TABLE "tenant_payment_configs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" VARCHAR(32) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "environment" VARCHAR(16) NOT NULL DEFAULT 'test',
    "public_key" VARCHAR(255),
    "encrypted_secret_key" TEXT,
    "encrypted_webhook_secret" TEXT,
    "currency" VARCHAR(3) NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "tenant_payment_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tenant_payment_configs_tenant_id_idx" ON "tenant_payment_configs"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_payment_configs_tenant_id_provider_key" ON "tenant_payment_configs"("tenant_id", "provider");

-- AddForeignKey
ALTER TABLE "tenant_payment_configs" ADD CONSTRAINT "tenant_payment_configs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
