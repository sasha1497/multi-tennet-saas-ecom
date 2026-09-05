#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# One command to go from a fresh clone to a running, seeded development stack.
#
#   pnpm bootstrap
#
# Safe to re-run: every step is either idempotent or explicitly skipped when it
# has already happened.
# ---------------------------------------------------------------------------
set -euo pipefail

cd "$(dirname "$0")/../.."
ROOT=$(pwd)

bold() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$1"; }
die()  { printf '  \033[31m✗\033[0m %s\n' "$1" >&2; exit 1; }

bold "1/6  Checking prerequisites"

command -v node >/dev/null || die "Node 20+ is required"
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ is required (found $(node -v))"
ok "node $(node -v)"

command -v pnpm >/dev/null || die "pnpm 9 is required — run: corepack enable && corepack prepare pnpm@9.15.9 --activate"
ok "pnpm $(pnpm -v)"

docker info >/dev/null 2>&1 || die "Docker is not running"
ok "docker $(docker version --format '{{.Server.Version}}')"

bold "2/6  Environment"

if [ -f .env ]; then
  ok ".env already exists (leaving it alone)"
else
  cp .env.example .env
  ok "created .env from .env.example"
  printf '      Development defaults are fine locally. Generate real secrets before deploying.\n'
fi

bold "3/6  Installing dependencies"
pnpm install --frozen-lockfile
ok "workspace installed"

bold "4/6  Starting infrastructure"
pnpm docker:up:infra

# Wait for PostgreSQL rather than guessing at a sleep duration.
printf '      waiting for postgres'
for _ in $(seq 1 60); do
  if docker exec retailos-postgres pg_isready -U "${POSTGRES_USER:-retailos}" >/dev/null 2>&1; then
    printf '\n'; ok "postgres is accepting connections"; break
  fi
  printf '.'; sleep 2
done
docker exec retailos-postgres pg_isready -U "${POSTGRES_USER:-retailos}" >/dev/null 2>&1 \
  || die "postgres did not become ready — check: docker logs retailos-postgres"

bold "5/6  Building shared packages and generating clients"
pnpm --filter @retailos/types --filter @retailos/config \
     --filter @retailos/validation --filter @retailos/api-client run build
pnpm prisma:generate
pnpm --filter @retailos/database run build
ok "packages built, Prisma clients generated"

bold "6/6  Database"
pnpm db:migrate:deploy
ok "master schema applied"

# Seeding is skipped if tenants already exist, so a re-run does not duplicate
# demo data or re-provision databases.
EXISTING=$(docker exec retailos-postgres psql -U "${POSTGRES_USER:-retailos}" \
  -d "${POSTGRES_DB:-retailos_master}" -tAc "SELECT count(*) FROM tenants" 2>/dev/null || echo 0)

if [ "${EXISTING:-0}" -gt 0 ]; then
  ok "$EXISTING tenants already present (skipping seed — use pnpm db:reset to start over)"
else
  pnpm db:seed
  ok "seeded 3 demo tenants, each with its own database"
fi

cat <<'EOF'

──────────────────────────────────────────────────────────────────────────────
Ready. Start everything with:

    pnpm dev

Then open:

    http://kickzone.localhost:3000     storefront   priya@example.com / Password@123
    http://abcstore.localhost:3000     storefront   vikram@example.com / Password@123
    http://kumarstore.localhost:3000   storefront   karthik@example.com / Password@123
    http://localhost:3001              console      owner@kickzone.dev / Password@123
    http://localhost:3001/platform     platform     admin@retailos.dev / SuperAdmin@123
    http://localhost:4000/docs         API docs
    http://localhost:8025              mail catcher

Prove tenant isolation:

    pnpm test:e2e
──────────────────────────────────────────────────────────────────────────────
EOF
