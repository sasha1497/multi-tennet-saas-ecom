#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Restores a backup produced by backup.sh.
#
#   ./infrastructure/scripts/restore.sh <backup-dir>                 # everything
#   ./infrastructure/scripts/restore.sh <backup-dir> tenant_kickzone # one tenant
#
# Restoring ONE tenant is the common case: a merchant deleted their catalog and
# wants yesterday back, while every other merchant carries on untouched.
#
# This script DROPS AND RECREATES the databases it restores. It asks first.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/../.."

SRC=${1:?usage: restore.sh <backup-dir> [database-name]}
ONLY=${2:-}
PGUSER=${POSTGRES_USER:-retailos}
CONTAINER=${POSTGRES_CONTAINER:-retailos-postgres}

[ -d "$SRC" ] || { echo "No such backup directory: $SRC" >&2; exit 1; }
[ -f "$SRC/MANIFEST" ] && cat "$SRC/MANIFEST"

if [ -n "$ONLY" ]; then
  TARGETS="$ONLY"
  [ -f "$SRC/$ONLY.dump" ] || { echo "No dump for $ONLY in $SRC" >&2; exit 1; }
else
  TARGETS=$(find "$SRC" -name '*.dump' -exec basename {} .dump \; | sort)
fi

echo
echo "About to DROP and restore these databases:"
for db in $TARGETS; do echo "  - $db"; done
echo
read -r -p "Type 'restore' to continue: " CONFIRM
[ "$CONFIRM" = "restore" ] || { echo "Aborted."; exit 1; }

# Roles first: a database restored without its owning role has no one able to
# connect to it. Errors are tolerated because existing roles are not an error.
if [ -f "$SRC/globals.sql.gz" ] && [ -z "$ONLY" ]; then
  echo "Restoring roles and grants..."
  gunzip -c "$SRC/globals.sql.gz" | docker exec -i "$CONTAINER" psql -U "$PGUSER" -d postgres >/dev/null 2>&1 || true
  echo "  ✓ globals"
fi

for db in $TARGETS; do
  # Braced: an unbraced $db immediately followed by a multibyte character is
  # swallowed into the variable name by some bash builds.
  echo "Restoring ${db}..."

  # Existing sessions would block the DROP.
  docker exec -i "$CONTAINER" psql -U "$PGUSER" -d postgres -tAc \
    "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid()" >/dev/null

  docker exec -i "$CONTAINER" psql -U "$PGUSER" -d postgres -c "DROP DATABASE IF EXISTS \"$db\"" >/dev/null
  docker exec -i "$CONTAINER" psql -U "$PGUSER" -d postgres -c "CREATE DATABASE \"$db\"" >/dev/null

  docker exec -i "$CONTAINER" pg_restore -U "$PGUSER" -d "$db" --no-owner --role="$PGUSER" < "$SRC/$db.dump"
  echo "  ✓ $db"
done

cat <<'EOF'

Restore complete.

Two things to check before declaring victory:

  1. Tenant roles can still connect. Migrations run as the admin role, so
     table ownership must be re-granted after a restore:

         pnpm db:tenant:migrate      # re-runs grants as well as any pending SQL

  2. The API's cached tenant connections point at the old databases. Restart it:

         docker compose restart api worker

Then verify a storefront actually serves:

     curl -s -H 'Host: kickzone.localhost' http://localhost/api/v1/store | jq -r '.data.store.storeName'
EOF
