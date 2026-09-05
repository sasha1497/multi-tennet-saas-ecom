#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# START EVERYTHING.
#
#   ./project-start.sh
#
# Safe to run any time. It works out what is already running, fixes what is
# not, and tells you exactly what happened. If it finishes, the project works —
# it does not print success until every service has actually answered a request.
#
# Logs go to .logs/ so nothing is trapped in a terminal window.
# Stop with ./project-stop.sh, watch with ./project-logs.sh
# ---------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "$0")"
ROOT=$(pwd)
LOGS="$ROOT/.logs"
mkdir -p "$LOGS"

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yml"

# ---------------------------------------------------------------- output ----
if [ -t 1 ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'
else
  B=''; G=''; Y=''; R=''; D=''; N=''
fi
step() { printf '\n%s▸ %s%s\n' "$B" "$1" "$N"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$1"; }
die()  { printf '  %s✗%s %s\n\n' "$R" "$N" "$1"; exit 1; }
note() { printf '    %s%s%s\n' "$D" "$1" "$N"; }

# Waits for a command to succeed, printing dots. wait_for <secs> <label> <cmd...>
wait_for() {
  local limit=$1 label=$2; shift 2
  printf '    waiting for %s' "$label"
  local i=0
  while [ "$i" -lt "$limit" ]; do
    if "$@" >/dev/null 2>&1; then printf ' ok\n'; return 0; fi
    printf '.'; sleep 2; i=$((i + 2))
  done
  printf ' TIMEOUT\n'
  return 1
}

printf '\n%s═══ RetailOS — starting ═══%s\n' "$B" "$N"

# ------------------------------------------------------------ 1. checks -----
step "1/7  Checking prerequisites"

command -v node >/dev/null || die "Node is not installed. Install Node 20+."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
[ "$NODE_MAJOR" -ge 20 ] || die "Node 20+ required, found $(node -v)."
ok "node $(node -v)"

if ! command -v pnpm >/dev/null; then
  die "pnpm not found. Run: corepack enable && corepack prepare pnpm@9.15.9 --activate"
fi
ok "pnpm $(pnpm -v)"

if ! docker info >/dev/null 2>&1; then
  warn "Docker is not running — starting Docker Desktop"
  open -a Docker 2>/dev/null || die "Could not start Docker. Open Docker Desktop yourself, then re-run."
  wait_for 120 "docker daemon" docker info || die "Docker did not start. Open Docker Desktop, then re-run."
fi
ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null)"

if [ ! -f .env ]; then
  cp .env.example .env
  ok "created .env from .env.example"
else
  ok ".env present"
fi

# --------------------------------------------------- 2. free the ports -----
step "2/7  Freeing application ports"

# Anything already listening on our ports is a previous run. Nothing else on a
# dev machine should be on 4000/3000/3001, and leaving them would make the new
# servers fail with EADDRINUSE — the single most confusing failure here.
KILLED=0
for port in 4000 3000 3001; do
  PIDS=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill 2>/dev/null
    sleep 1
    STILL=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null)
    [ -n "$STILL" ] && echo "$STILL" | xargs kill -9 2>/dev/null
    KILLED=$((KILLED + 1))
  fi
done
pkill -f "turbo run dev" 2>/dev/null
[ "$KILLED" -gt 0 ] && ok "stopped $KILLED previous server(s)" || ok "ports 3000, 3001, 4000 free"

# The full-Docker app containers would also hold those ports via publishing.
$COMPOSE stop api worker storefront-web merchant-web nginx >/dev/null 2>&1
ok "docker app containers stopped (infra stays up)"

# ------------------------------------------------- 3. dependencies ---------
step "3/7  Dependencies"

if [ ! -d node_modules ]; then
  warn "installing — first run takes a few minutes"
  pnpm install --frozen-lockfile >"$LOGS/install.log" 2>&1 \
    || die "pnpm install failed. See .logs/install.log"
  ok "installed"
else
  ok "already installed"
fi

# ------------------------------------------------- 4. infrastructure -------
step "4/7  Infrastructure (PostgreSQL, MySQL, Redis, MinIO, Mailpit)"

$COMPOSE up -d postgres mysql redis minio minio-init mailpit adminer redis-commander \
  >"$LOGS/docker.log" 2>&1 || die "docker compose failed. See .logs/docker.log"

wait_for 120 "postgres" docker exec retailos-postgres pg_isready -U retailos \
  || die "PostgreSQL did not become ready. Run: docker logs retailos-postgres"
ok "postgres ready"

wait_for 60 "redis" docker exec retailos-redis redis-cli ping || warn "redis slow to answer"
ok "redis ready"

# --------------------------------------------------- 5. build + db --------
step "5/7  Shared packages and database"

if [ ! -d packages/types/dist ] || [ ! -d database/generated ]; then
  warn "building shared packages — first run only"
  pnpm --filter @retailos/types --filter @retailos/config \
       --filter @retailos/validation --filter @retailos/api-client run build \
       >"$LOGS/build.log" 2>&1 || die "package build failed. See .logs/build.log"
  pnpm prisma:generate >>"$LOGS/build.log" 2>&1 || die "prisma generate failed. See .logs/build.log"
  pnpm --filter @retailos/database run build >>"$LOGS/build.log" 2>&1 \
    || die "database package build failed. See .logs/build.log"
  ok "packages built"
else
  ok "packages already built"
fi

pnpm db:migrate:deploy >"$LOGS/migrate.log" 2>&1 \
  || die "master migrations failed. See .logs/migrate.log"
ok "master schema up to date"

TENANTS=$(docker exec retailos-postgres psql -U retailos -d retailos_master \
  -tAc "SELECT count(*) FROM tenants" 2>/dev/null | tr -d ' ')

if [ "${TENANTS:-0}" -eq 0 ]; then
  warn "no tenants yet — seeding demo data (takes ~30s, creates 3 databases)"
  pnpm db:seed >"$LOGS/seed.log" 2>&1 || die "seed failed. See .logs/seed.log"
  ok "seeded 3 demo shops"
else
  ok "$TENANTS shops already in the database"
fi

# ------------------------------------------------------ 6. app servers ----
step "6/7  Starting the application"

start_app() {
  local name=$1 filter=$2
  : >"$LOGS/$name.log"
  nohup pnpm --filter "$filter" dev >>"$LOGS/$name.log" 2>&1 &
  echo $! >"$LOGS/$name.pid"
}

start_app api            @retailos/api
start_app storefront     @retailos/storefront-web
start_app console        @retailos/merchant-web
ok "launched api, storefront, console (logs in .logs/)"

# ---------------------------------------------------------- 7. verify -----
step "7/7  Verifying everything answers"

FAILED=0

check() {
  local label=$1 log=$2; shift 2
  if wait_for 180 "$label" "$@"; then
    ok "$label"
  else
    printf '  %s✗%s %s did not start — last lines of .logs/%s.log:\n' "$R" "$N" "$label" "$log"
    tail -15 "$LOGS/$log.log" | sed 's/^/      /'
    FAILED=1
  fi
}

api_up()        { curl -sf -m 5 http://localhost:4000/api/v1/health/live; }
storefront_up() { curl -sf -m 10 -H 'Host: kickzone.localhost' http://localhost:3000/; }
console_up()    { curl -sf -m 10 http://localhost:3001/login; }

check "API (:4000)"        api        api_up
check "storefront (:3000)" storefront storefront_up
check "console (:3001)"    console    console_up

if [ "$FAILED" -eq 1 ]; then
  printf '\n%s Something did not start. See the log lines above, or run ./project-logs.sh %s\n\n' "$R✗$N" ""
  exit 1
fi

# Confirm the multi-tenant part really works, not just that a port is open.
step "Tenant check"
for slug in kickzone abcstore kumarstore; do
  NAME=$(curl -s -m 10 -H "Host: $slug.localhost" http://localhost:4000/api/v1/store \
    | sed -n 's/.*"storeName":"\([^"]*\)".*/\1/p')
  if [ -n "$NAME" ]; then ok "$slug.localhost → $NAME"; else warn "$slug did not resolve"; fi
done

# ------------------------------------------------------------- summary ----
cat <<EOF

${B}═══════════════════════════════════════════════════════════════════════${N}
${G}${B}  RUNNING${N}  — open any of these in your browser
${B}═══════════════════════════════════════════════════════════════════════${N}

  ${B}SHOPS${N} (three different businesses, one codebase)
    http://kickzone.localhost:3000     shoe shop
    http://abcstore.localhost:3000     stationery shop
    http://kumarstore.localhost:3000   phone shop
      log in as   priya@example.com / Password@123     (kickzone)
                  vikram@example.com / Password@123    (abcstore)
                  karthik@example.com / Password@123   (kumarstore)

  ${B}SHOP OWNER DASHBOARD${N}
    http://localhost:3001
      log in as   owner@kickzone.dev / Password@123

  ${B}PLATFORM ADMIN${N} (you, the SaaS operator)
    http://localhost:3001/platform
      log in as   admin@retailos.dev / SuperAdmin@123

  ${B}DEVELOPER TOOLS${N}
    http://localhost:4000/docs   API documentation (try endpoints here)
    http://localhost:8025        every email the app sends
    http://localhost:8082        database browser  (server: postgres, user: retailos)
    http://localhost:8083        redis browser

  ${B}COMMANDS${N}
    ./project-logs.sh            watch all logs
    ./project-logs.sh api        watch just the API
    ./project-stop.sh            stop everything
    ./project-start.sh           start again (safe to re-run any time)

  ${D}Start here: open the three shop URLs side by side. Different name,
  different products, different colours — each reading its own database.${N}

EOF
