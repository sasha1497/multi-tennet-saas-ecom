#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# STOP EVERYTHING.
#
#   ./project-stop.sh          stop the app and the containers, KEEP all data
#   ./project-stop.sh --apps   stop only the app servers, leave databases up
#   ./project-stop.sh --wipe   stop everything AND DELETE every database
#
# Your data survives a normal stop. Only --wipe destroys it, and it asks first.
# ---------------------------------------------------------------------------
set -uo pipefail

cd "$(dirname "$0")"
LOGS="$(pwd)/.logs"
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.dev.yml"

if [ -t 1 ]; then
  B=$'\033[1m'; G=$'\033[32m'; Y=$'\033[33m'; R=$'\033[31m'; D=$'\033[2m'; N=$'\033[0m'
else
  B=''; G=''; Y=''; R=''; D=''; N=''
fi
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$1"; }
warn() { printf '  %s!%s %s\n' "$Y" "$N" "$1"; }

MODE=${1:-all}

printf '\n%s═══ RetailOS — stopping ═══%s\n\n' "$B" "$N"

# ------------------------------------------------------- app servers ------
printf '%s▸ Application servers%s\n' "$B" "$N"

STOPPED=0

# PIDs recorded by project-start.sh.
for name in api storefront console; do
  if [ -f "$LOGS/$name.pid" ]; then
    PID=$(cat "$LOGS/$name.pid" 2>/dev/null)
    if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
      kill "$PID" 2>/dev/null
      STOPPED=$((STOPPED + 1))
    fi
    rm -f "$LOGS/$name.pid"
  fi
done

# Anything still holding a port, however it was started (a stray `pnpm dev`, a
# previous session, an editor's terminal). Port-based is the reliable check.
sleep 1
for port in 4000 3000 3001 8081; do
  PIDS=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "$PIDS" | xargs kill 2>/dev/null
    sleep 1
    STILL=$(lsof -nP -iTCP:$port -sTCP:LISTEN -t 2>/dev/null)
    [ -n "$STILL" ] && echo "$STILL" | xargs kill -9 2>/dev/null
    STOPPED=$((STOPPED + 1))
  fi
done

pkill -f "turbo run dev" 2>/dev/null
pkill -f "expo start" 2>/dev/null

if [ "$STOPPED" -gt 0 ]; then ok "stopped $STOPPED server(s)"; else ok "no app servers were running"; fi

if [ "$MODE" = "--apps" ]; then
  printf '\n%sDatabases left running.%s Restart the app with ./project-start.sh\n\n' "$D" "$N"
  exit 0
fi

# --------------------------------------------------------- containers -----
printf '\n%s▸ Containers%s\n' "$B" "$N"

if ! docker info >/dev/null 2>&1; then
  warn "Docker is not running — nothing to stop"
  printf '\n'
  exit 0
fi

if [ "$MODE" = "--wipe" ]; then
  printf '\n  %sThis DELETES every database, including all three demo shops%s\n' "$R$B" "$N"
  printf '  and anything you created in them. It cannot be undone.\n\n'
  printf '  Type %sdelete%s to confirm: ' "$B" "$N"
  read -r CONFIRM
  if [ "$CONFIRM" != "delete" ]; then
    printf '\n  Cancelled — nothing was deleted.\n\n'
    exit 1
  fi
  $COMPOSE down -v >/dev/null 2>&1
  ok "containers stopped and ALL DATA DELETED"
  printf '\n  %sNext ./project-start.sh will rebuild and re-seed from scratch.%s\n\n' "$D" "$N"
  exit 0
fi

$COMPOSE down >/dev/null 2>&1
ok "containers stopped (all data kept)"

cat <<EOF

${D}Your databases are intact. Start again with:${N}

    ./project-start.sh

EOF
