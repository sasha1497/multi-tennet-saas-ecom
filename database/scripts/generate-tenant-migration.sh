#!/usr/bin/env bash
#
# Generates the next tenant migration by diffing the already-applied migrations
# against tenant/schema.prisma.
#
# The tenant schema stays the single source of truth; this script just turns a
# schema edit into reviewable SQL that the runtime migration runner can apply.
#
# Usage:
#   ./scripts/generate-tenant-migration.sh add_loyalty_points
#
# Requires a reachable PostgreSQL for the shadow database (docker compose up postgres).
set -euo pipefail

cd "$(dirname "$0")/.."

NAME="${1:-}"
if [[ -z "$NAME" ]]; then
  echo "usage: $0 <migration_name>   e.g. $0 add_loyalty_points" >&2
  exit 1
fi

if [[ ! "$NAME" =~ ^[a-z0-9_]+$ ]]; then
  echo "error: migration name must be lowercase letters, digits and underscores" >&2
  exit 1
fi

MIGRATIONS_DIR="tenant/migrations"
SHADOW_URL="${TENANT_SHADOW_DATABASE_URL:-postgresql://retailos:retailos_dev_password@localhost:5432/retailos_shadow}"

# Next sequence number, zero-padded to four digits.
LAST=$(find "$MIGRATIONS_DIR" -maxdepth 1 -type d -name '[0-9][0-9][0-9][0-9]_*' \
  -exec basename {} \; | sort | tail -1 || true)
if [[ -z "$LAST" ]]; then
  NEXT="0001"
else
  NEXT=$(printf "%04d" $((10#${LAST%%_*} + 1)))
fi

TARGET="$MIGRATIONS_DIR/${NEXT}_${NAME}"
mkdir -p "$TARGET"

echo "==> Diffing tenant/schema.prisma against $MIGRATIONS_DIR"
npx prisma migrate diff \
  --from-migrations "$MIGRATIONS_DIR" \
  --to-schema-datamodel tenant/schema.prisma \
  --shadow-database-url "$SHADOW_URL" \
  --script > "$TARGET/migration.sql"

if [[ ! -s "$TARGET/migration.sql" ]] || ! grep -qi '[a-z]' "$TARGET/migration.sql"; then
  echo "==> No schema changes detected; removing empty $TARGET"
  rm -rf "$TARGET"
  exit 0
fi

echo "==> Wrote $TARGET/migration.sql"
echo "    Review it, then restart the API — the runner applies it to every tenant."
