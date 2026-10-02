-- Refund records for gateway refunds.
--
-- Purely additive: one new table. Nothing existing is altered. (Prisma's diff
-- also proposed dropping the hand-written trigram search indexes and touching
-- product_images — that is drift it cannot see, not part of this change, and
-- was deliberately removed.)
--
-- Rollback: DROP TABLE "payment_refunds";

CREATE TABLE "payment_refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "reason" VARCHAR(300),
    "provider_refund_id" VARCHAR(128),
    "idempotency_key" VARCHAR(128) NOT NULL,
    "failure_reason" VARCHAR(500),
    "created_by" UUID,
    "processed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payment_refunds_provider_refund_id_key" ON "payment_refunds"("provider_refund_id");
CREATE UNIQUE INDEX "payment_refunds_idempotency_key_key" ON "payment_refunds"("idempotency_key");
CREATE INDEX "payment_refunds_payment_id_idx" ON "payment_refunds"("payment_id");

ALTER TABLE "payment_refunds"
  ADD CONSTRAINT "payment_refunds_payment_id_fkey"
  FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
