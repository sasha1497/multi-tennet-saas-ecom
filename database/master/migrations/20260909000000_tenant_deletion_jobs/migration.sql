-- Durable state for permanent tenant deletion.
--
-- Deleting a tenant spans three systems that cannot share a transaction: the
-- master database, the tenant's own database, and object storage. A crash
-- between any two of them leaves the work half done, so each step records
-- itself here and a retry resumes at the first one missing.
--
-- The table is deliberately not foreign-keyed to `tenants`: the job outlives
-- the row it deleted, which is the only way a completed deletion stays
-- inspectable.

CREATE TABLE "tenant_deletion_jobs" (
  "id"                   UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"            UUID NOT NULL,
  "tenant_slug"          VARCHAR(63) NOT NULL,
  "tenant_name"          VARCHAR(120) NOT NULL,
  "status"               "ProvisioningJobStatus" NOT NULL DEFAULT 'PENDING',
  "current_step"         VARCHAR(64),
  "completed_steps"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "attempts"             INTEGER NOT NULL DEFAULT 0,
  "last_error"           TEXT,
  "objects_deleted"      INTEGER NOT NULL DEFAULT 0,
  "database_name"        VARCHAR(63),
  "requested_by_user_id" UUID,
  "requested_by_email"   VARCHAR(255),
  "started_at"           TIMESTAMPTZ(6),
  "finished_at"          TIMESTAMPTZ(6),
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
  "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),

  CONSTRAINT "tenant_deletion_jobs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tenant_deletion_jobs_tenant_id_created_at_idx"
  ON "tenant_deletion_jobs" ("tenant_id", "created_at");

CREATE INDEX "tenant_deletion_jobs_status_created_at_idx"
  ON "tenant_deletion_jobs" ("status", "created_at");
