#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# WATCH THE LOGS.
#
#   ./project-logs.sh              everything, live (Ctrl-C to quit)
#   ./project-logs.sh api          just the API
#   ./project-logs.sh storefront   just the customer site
#   ./project-logs.sh console      just the merchant dashboard
#   ./project-logs.sh db           PostgreSQL
#   ./project-logs.sh docker       all containers
#   ./project-logs.sh errors       only errors, across everything
#   ./project-logs.sh status       what is running right now (no tailing)
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

WHAT=${1:-all}

missing() {
  printf '\n  No log file yet for %s.\n  Start the project first:  ./project-start.sh\n\n' "$1"
  exit 1
}

case "$WHAT" in
  # ------------------------------------------------------------- status ---
  status)
    printf '\n%s═══ What is running ═══%s\n\n' "$B" "$N"

    printf '%sApplication%s\n' "$B" "$N"
    check_port() {
      local port=$1 label=$2 url=$3
      if curl -sf -m 5 -o /dev/null "$url" 2>/dev/null; then
        printf '  %s✓%s %-22s :%s  responding\n' "$G" "$N" "$label" "$port"
      elif lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
        printf '  %s!%s %-22s :%s  port open but not answering (still starting?)\n' "$Y" "$N" "$label" "$port"
      else
        printf '  %s✗%s %-22s :%s  not running\n' "$R" "$N" "$label" "$port"
      fi
    }
    check_port 4000 "API"        "http://localhost:4000/api/v1/health/live"
    check_port 3000 "Storefront" "http://localhost:3000/"
    check_port 3001 "Console"    "http://localhost:3001/login"

    # Mobile is started separately and on purpose, so its absence is normal —
    # a red cross here would suggest something is broken when nothing is.
    if curl -sf -m 5 -o /dev/null http://localhost:8081/status 2>/dev/null; then
      printf '  %s✓%s %-22s :8081  responding\n' "$G" "$N" "Expo (mobile)"
    else
      printf '  %s·%s %-22s        not started  %s(optional: pnpm --filter @retailos/mobile dev)%s\n' \
        "$D" "$N" "Expo (mobile)" "$D" "$N"
    fi

    printf '\n%sContainers%s\n' "$B" "$N"
    if docker info >/dev/null 2>&1; then
      $COMPOSE ps --format '{{.Service}}|{{.State}}|{{.Health}}' 2>/dev/null | sort | \
      while IFS='|' read -r svc state health; do
        [ -z "$svc" ] && continue
        if [ "$health" = "healthy" ] || { [ -z "$health" ] && [ "$state" = "running" ]; }; then
          printf '  %s✓%s %-22s %s\n' "$G" "$N" "$svc" "${health:-running}"
        elif [ "$health" = "starting" ]; then
          # Inside its healthcheck start period — normal for the first minute.
          printf '  %s·%s %-22s starting up\n' "$Y" "$N" "$svc"
        else
          printf '  %s✗%s %-22s %s %s\n' "$R" "$N" "$svc" "$state" "$health"
        fi
      done
      [ -z "$($COMPOSE ps -q 2>/dev/null)" ] && printf '  %s✗%s no containers running\n' "$R" "$N"
    else
      printf '  %s✗%s Docker is not running\n' "$R" "$N"
    fi

    printf '\n%sShops%s\n' "$B" "$N"
    for slug in kickzone abcstore kumarstore; do
      NAME=$(curl -s -m 5 -H "Host: $slug.localhost" http://localhost:4000/api/v1/store 2>/dev/null \
        | sed -n 's/.*"storeName":"\([^"]*\)".*/\1/p')
      if [ -n "$NAME" ]; then
        printf '  %s✓%s %-22s %s\n' "$G" "$N" "$slug.localhost" "$NAME"
      else
        printf '  %s✗%s %-22s not resolving\n' "$R" "$N" "$slug.localhost"
      fi
    done
    printf '\n'
    ;;

  # ------------------------------------------------------------- errors ---
  errors)
    printf '\n%s═══ Errors only ═══%s\n' "$B" "$N"
    printf '%sCtrl-C to quit. Nothing appearing is good news.%s\n\n' "$D" "$N"
    [ -d "$LOGS" ] || missing "the app"
    # -i so ERROR/error/Error all match; the API logs JSON with "level":"error".
    tail -f "$LOGS"/*.log 2>/dev/null | grep --line-buffered -iE "error|exception|failed|ECONN|EADDRINUSE"
    ;;

  # ------------------------------------------------------------- docker ---
  docker)
    docker info >/dev/null 2>&1 || { printf '\n  Docker is not running.\n\n'; exit 1; }
    $COMPOSE logs -f --tail=100
    ;;

  db|database|postgres)
    docker info >/dev/null 2>&1 || { printf '\n  Docker is not running.\n\n'; exit 1; }
    docker logs -f --tail=100 retailos-postgres
    ;;

  # -------------------------------------------------------- one service ---
  api|storefront|console)
    [ -f "$LOGS/$WHAT.log" ] || missing "$WHAT"
    printf '\n%s═══ %s ═══%s  %sCtrl-C to quit%s\n\n' "$B" "$WHAT" "$N" "$D" "$N"
    tail -f -n 200 "$LOGS/$WHAT.log"
    ;;

  # ---------------------------------------------------------------- all ---
  all)
    [ -d "$LOGS" ] && ls "$LOGS"/*.log >/dev/null 2>&1 || missing "the app"
    printf '\n%s═══ All application logs ═══%s\n' "$B" "$N"
    printf '%sCtrl-C to quit.  For one service: ./project-logs.sh api%s\n\n' "$D" "$N"
    # tail -f on several files prints a ==> filename <== header when the source
    # changes, which is what makes interleaved output readable.
    tail -f -n 50 "$LOGS"/api.log "$LOGS"/storefront.log "$LOGS"/console.log 2>/dev/null
    ;;

  *)
    printf '\nUnknown option: %s\n\n' "$WHAT"
    sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
