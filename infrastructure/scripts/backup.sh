#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Backs up the master database and EVERY tenant database.
#
#   ./infrastructure/scripts/backup.sh [destination-dir]
#
# Per-tenant dumps rather than one cluster-wide dump: restoring a single
# merchant who deleted their catalog by mistake should not require restoring
# every other merchant to the same point in time. That is the whole practical
# payoff of database-per-tenant, and it only exists if the backups are per
# tenant too.
#
# Cron:
#   0 2 * * * /opt/retailos/infrastructure/scripts/backup.sh >> /var/log/retailos-backup.log 2>&1
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/../.."

STAMP=$(date -u +%Y-%m-%dT%H-%M-%SZ)
DEST=${1:-/var/backups/retailos}/$STAMP
PGUSER=${POSTGRES_USER:-retailos}
CONTAINER=${POSTGRES_CONTAINER:-retailos-postgres}
RETAIN_DAYS=${BACKUP_RETAIN_DAYS:-7}

mkdir -p "$DEST"
echo "Backing up to $DEST"

psql_q() {
  docker exec -i "$CONTAINER" psql -U "$PGUSER" -d postgres -tAc "$1"
}

# Roles and their (hashed) passwords. Without these a restore onto a fresh
# server produces databases that no tenant role can connect to.
docker exec -i "$CONTAINER" pg_dumpall -U "$PGUSER" --globals-only \
  | gzip > "$DEST/globals.sql.gz"
echo "  ✓ globals (roles, grants)"

DBS=$(psql_q "SELECT datname FROM pg_database WHERE datname = 'retailos_master' OR datname LIKE 'tenant_%' ORDER BY datname")

COUNT=0
for db in $DBS; do
  # Custom format: compressed, and restorable selectively with pg_restore.
  docker exec -i "$CONTAINER" pg_dump -U "$PGUSER" -Fc "$db" > "$DEST/$db.dump"
  SIZE=$(du -h "$DEST/$db.dump" | cut -f1)
  echo "  ✓ $db ($SIZE)"
  COUNT=$((COUNT + 1))
done

# A manifest makes a restore a lookup rather than an inspection.
{
  echo "timestamp=$STAMP"
  echo "databases=$COUNT"
  echo "postgres_version=$(docker exec -i "$CONTAINER" postgres --version | awk '{print $3}')"
  echo "git_sha=$(git rev-parse HEAD 2>/dev/null || echo unknown)"
} > "$DEST/MANIFEST"

echo "  ✓ $COUNT databases dumped"

# Off-site copy. Configure an rclone remote named "backups" (R2, S3, B2 …).
if command -v rclone >/dev/null && [ -n "${BACKUP_REMOTE:-}" ]; then
  rclone copy "$DEST" "$BACKUP_REMOTE/$STAMP"
  echo "  ✓ uploaded to $BACKUP_REMOTE/$STAMP"
else
  echo "  ! no off-site copy (set BACKUP_REMOTE and install rclone)"
  echo "    A backup on the same disk as the database is not a backup."
fi

# Prune local copies only. Off-site retention is the remote's lifecycle policy.
find "$(dirname "$DEST")" -maxdepth 1 -type d -mtime "+$RETAIN_DAYS" -name '20*' -exec rm -rf {} + 2>/dev/null || true
echo "Done. Local retention: ${RETAIN_DAYS} days."
