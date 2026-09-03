#!/bin/bash
# ---------------------------------------------------------------------------
# Runs once, on first boot of an empty PostgreSQL data volume.
#
# Two jobs:
#   1. Give the application role CREATEDB + CREATEROLE. Tenant provisioning
#      creates a database *and* a least-privilege role per merchant, so the
#      control-plane user genuinely needs these — but not SUPERUSER.
#   2. Create the shadow database Prisma uses when generating tenant migrations.
# ---------------------------------------------------------------------------
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    ALTER ROLE "$POSTGRES_USER" CREATEDB CREATEROLE;

    -- Used only by \`prisma migrate diff --shadow-database-url\` during development.
    SELECT 'CREATE DATABASE retailos_shadow OWNER "$POSTGRES_USER"'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'retailos_shadow')\gexec

    -- Extensions the tenant schema relies on. Created here as superuser so the
    -- per-tenant migration does not need elevated privileges.
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
    CREATE EXTENSION IF NOT EXISTS unaccent;
EOSQL

echo "RetailOS: PostgreSQL initialised (CREATEDB granted, shadow database ready)"
