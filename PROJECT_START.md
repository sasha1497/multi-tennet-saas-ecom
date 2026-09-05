# Project start — how to run RetailOS

Everything in this file has been run and verified on this machine. If a command
here fails, that is a bug, not a typo.

For deeper reference see [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md),
[docs/DOCKER.md](docs/DOCKER.md), [docs/MOBILE.md](docs/MOBILE.md) and
[docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

---

## 0. Prerequisites

```bash
node -v          # must be 20+
pnpm -v          # must be 9.x  →  corepack enable && corepack prepare pnpm@9.15.9 --activate
docker info      # Docker Desktop must be running
```

If Docker is not running, start it and wait — everything below depends on it:

```bash
open -a Docker
until docker info >/dev/null 2>&1; do sleep 2; done
```

---

## 1. First run on a clean machine

```bash
pnpm install
cp .env.example .env
pnpm docker:up:infra          # postgres, mysql, redis, minio, mailpit, adminer
pnpm db:migrate:deploy        # master schema
pnpm db:seed                  # 3 demo tenants, each with its OWN database
pnpm dev                      # api :4000, storefront :3000, console :3001
```

Or do all of it in one command:

```bash
pnpm bootstrap
```

`bootstrap` checks prerequisites, creates `.env` if missing, installs, starts
infrastructure, waits for PostgreSQL to actually accept connections, builds the
shared packages, generates the Prisma clients, migrates, and seeds — skipping
the seed if tenants already exist, so it is safe to re-run.

---

## 2. THE ONE THING THAT WILL TRIP YOU UP

There are **two ways to run this project, and they are mutually exclusive.**
Both want ports 3000, 3001 and 4000.

| | Mode A — Local dev | Mode B — Full Docker |
| --- | --- | --- |
| **Use it for** | Writing code | Verifying a deploy |
| **Runs in Docker** | Infra only | Everything |
| **Runs on host** | API + both web apps | Nothing |
| **Hot reload** | Yes | Web only (bind mounts) |
| **URLs** | `kickzone.localhost:3000` | `kickzone.localhost` (port 80) |
| **Start** | `pnpm docker:up:infra` then `pnpm dev` | `pnpm docker:up` |

Starting one without stopping the other gives `EADDRINUSE` on 3000/3001/4000.
That is the only thing wrong — nothing is broken.

**Switching A → B:**

```bash
pkill -f "turbo run dev"      # stop the host servers
pnpm docker:up                # full stack behind nginx on :80
```

**Switching B → A:**

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml stop api worker storefront-web merchant-web nginx
pnpm dev
```

---

## 3. Mode A — Local development (use this day to day)

```bash
pnpm docker:up:infra
pnpm dev
```

`pnpm dev` runs all three apps in parallel through Turborepo, in watch mode.

### What you get

| URL | Surface | Sign in with |
| --- | --- | --- |
| http://kickzone.localhost:3000 | KickZone storefront (footwear) | `priya@example.com` / `Password@123` |
| http://abcstore.localhost:3000 | ABC Store (stationery) | `vikram@example.com` / `Password@123` |
| http://kumarstore.localhost:3000 | Kumar Mobile Store (phones) | `karthik@example.com` / `Password@123` |
| http://localhost:3001 | Merchant console | `owner@kickzone.dev` / `Password@123` |
| http://localhost:3001/platform | Platform admin | `admin@retailos.dev` / `SuperAdmin@123` |
| http://localhost:4000/api/v1 | REST API | — |
| http://localhost:4000/docs | Swagger UI | — |

Every seeded account uses `Password@123` except the super admin, which uses
`SuperAdmin@123`. Each tenant also has `staff@<slug>.dev` as a MANAGER.

**Open the three storefronts side by side.** Different shop name, different
catalog, different brand colour — all from a single running process, each
reading a physically separate database. That is the whole product in one glance.

`*.localhost` resolves to 127.0.0.1 in every modern browser, so no `/etc/hosts`
editing is needed.

### Running one app at a time

```bash
pnpm --filter @retailos/api dev              # :4000
pnpm --filter @retailos/storefront-web dev   # :3000
pnpm --filter @retailos/merchant-web dev     # :3001
pnpm --filter @retailos/mobile dev           # Expo, :8081
```

---

## 4. Mode B — Full Docker stack

```bash
pnpm docker:up          # builds if needed, starts all 12 services
pnpm docker:logs        # tail everything
pnpm docker:down        # stop, keep data
```

Everything is served through nginx on port 80, so **no port numbers**:

| URL | Surface |
| --- | --- |
| http://kickzone.localhost | Storefront |
| http://abcstore.localhost | Storefront |
| http://admin.localhost | Merchant console |
| http://api.localhost/api/v1/health | API health |

### Checking it is healthy

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps

# All three tenants from one deployment
for t in kickzone abcstore kumarstore; do
  curl -s -H "Host: $t.localhost" http://localhost/api/v1/store \
    | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['store']['storeName'])"
done
# KickZone
# ABC Store
# Kumar Mobile Store
```

Expected: 12 services, all `healthy` (adminer has no probe).

### Other Docker commands

```bash
pnpm docker:up:infra       # just the backing services (for Mode A)
pnpm docker:build          # rebuild images
pnpm docker:down:volumes   # DESTROYS all data, including every tenant database
pnpm docker:prod           # production overlay
```

---

## 5. Backend API

### Health and docs

```bash
curl -s http://localhost:4000/api/v1/health | jq        # full report
curl -s http://localhost:4000/api/v1/health/live        # liveness
curl -s http://localhost:4000/api/v1/health/ready       # dependencies reachable
open http://localhost:4000/docs                         # Swagger
```

### Talking to a tenant

The API decides which shop you mean from the **Host header** — never from a
request body or query string. With curl, set it explicitly:

```bash
API=http://localhost:4000/api/v1

curl -s -H 'Host: kickzone.localhost' $API/store | jq '.data.store.storeName'
curl -s -H 'Host: kickzone.localhost' "$API/products?limit=5" | jq -r '.data[].name'
```

### Sign in as a shopper

```bash
CTOK=$(curl -s -H 'Host: kickzone.localhost' -X POST $API/auth/customer/login \
  -H 'Content-Type: application/json' \
  -d '{"identifier":"priya@example.com","password":"Password@123"}' \
  | jq -r '.data.tokens.accessToken')

curl -s -H 'Host: kickzone.localhost' -H "Authorization: Bearer $CTOK" \
  $API/auth/customer/me | jq '.data.customer.email'
```

### Sign in as a merchant

The console has no tenant hostname — the tenant comes from your membership:

```bash
MTOK=$(curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"owner@kickzone.dev","password":"Password@123"}' \
  | jq -r '.data.tokens.accessToken')

curl -s $API/merchant/dashboard -H "Authorization: Bearer $MTOK" | jq '.data'
```

### Prove tenant isolation by hand

```bash
# A KickZone shopper token aimed at another store
curl -s -H 'Host: kumarstore.localhost' -H "Authorization: Bearer $CTOK" \
  $API/orders | jq -r '.error.code'
# FORBIDDEN

# A shopper token on merchant routes
curl -s $API/merchant/orders -H "Authorization: Bearer $CTOK" | jq -r '.error.code'
# FORBIDDEN
```

More worked examples: [docs/API_EXAMPLES.md](docs/API_EXAMPLES.md).

---

## 6. Front end

Both web apps are Next.js 14 (app router).

**Storefront** (`apps/storefront-web`, port 3000) renders *every* merchant's shop
from one deployment. The tenant comes from the hostname; the merchant's colours
are injected server-side as CSS custom properties before anything paints, so
there is no flash of the wrong brand.

**Merchant console** (`apps/merchant-web`, port 3001) is the back office plus, for
super admins, the platform admin at `/platform`.

```bash
pnpm --filter @retailos/storefront-web dev
pnpm --filter @retailos/merchant-web dev

pnpm --filter @retailos/storefront-web build   # production build
```

Details: [docs/WEB.md](docs/WEB.md).

---

## 7. Mobile app

```bash
pnpm --filter @retailos/mobile dev
```

Then press `i` for the iOS simulator, `a` for Android, or scan the QR code with
Expo Go.

**The script is `dev`, not `start`.**

### Running on a physical phone

A phone cannot reach `localhost` on your Mac — `localhost` on a phone means the
phone. Point the app at your machine's LAN IP:

```bash
ipconfig getifaddr en0        # e.g. 192.168.0.100
```

Then in `.env`:

```bash
EXPO_PUBLIC_API_URL=http://192.168.0.100:4000/api/v1
EXPO_PUBLIC_PLATFORM_DOMAIN=localhost
```

**This changes every time you join a different network.** If the app loads but
shows no shops, check this first — it is the most common cause.

### Choosing a store

A phone has no hostname, so the app selects a store explicitly (the discover
screen, or by scanning a QR code the merchant displays) and then sends
`X-Tenant-Slug`. That header resolves a public storefront exactly as a hostname
would — and grants exactly as much: nothing.

### Verifying it bundles

```bash
curl -s -o /dev/null -w "%{http_code} %{size_download}\n" \
  "http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true"
# 200, ~8 MB
```

Note the entry is `expo-router/entry`, so `/index.bundle` returns 404 — that is
expected, not a fault.

Production export:

```bash
pnpm --filter @retailos/mobile exec expo export --platform ios
```

Details: [docs/MOBILE.md](docs/MOBILE.md).

---

## 8. Database

```bash
pnpm db:studio            # Prisma Studio on the master database
pnpm db:migrate           # create a master migration (dev)
pnpm db:migrate:deploy    # apply master migrations
pnpm db:tenant:migrate    # apply tenant migrations to EVERY tenant database
pnpm db:seed              # re-seed demo data
pnpm db:reset             # wipe master and re-seed
```

Browse any database in Adminer (http://localhost:8082): server `postgres`, user
`retailos`, password from `.env`.

See the separation for yourself:

```bash
docker exec retailos-postgres psql -U retailos -d retailos_master \
  -c "select datname from pg_database where datname like 'tenant_%';"
```

```
 tenant_kickzone
 tenant_abcstore
 tenant_kumarstore
```

Always use the workspace Prisma binary, not `npx prisma`, which may resolve a
different major version:

```bash
./database/node_modules/.bin/prisma --version
```

---

## 9. Tests

```bash
pnpm lint             # eslint — warnings are errors
pnpm typecheck        # tsc --noEmit across all 10 packages
pnpm test             # 81 unit tests
pnpm test:e2e         # 34 cross-tenant isolation tests  ← the important one
pnpm build            # build everything
```

`pnpm test:e2e` needs the databases and seed data, but **not** a running dev
server — it boots the app in-process:

```bash
pnpm docker:up:infra && pnpm db:migrate:deploy && pnpm db:seed && pnpm test:e2e
```

A failure there is a data breach, not a flake. Do not "fix" it by changing the
test. See [docs/TESTING.md](docs/TESTING.md).

---

## 10. Dev tools

| URL | Tool | Use |
| --- | --- | --- |
| http://localhost:8025 | Mailpit | Every outbound email lands here |
| http://localhost:8082 | Adminer | Browse master or any tenant database |
| http://localhost:8083 | Redis Commander | Cache keys, rate limits, locks, BullMQ |
| http://localhost:9101 | MinIO console | Uploaded product images |

---

## 11. Ports

RetailOS avoids the default ports so it can run beside your other projects.

| Port | Service |
| --- | --- |
| 3000 | Storefront (Mode A) |
| 3001 | Merchant console (Mode A) |
| 4000 | API (Mode A) |
| 8081 | Expo / Metro |
| 80 | nginx (Mode B) |
| 5433 | PostgreSQL |
| 3307 | MySQL |
| 6379 | Redis |
| 9100 / 9101 | MinIO API / console |
| 8025 | Mailpit |
| 8082 | Adminer |
| 8083 | Redis Commander |

All overridable via `*_HOST_PORT` in `.env`.

Find what is holding a port:

```bash
lsof -nP -iTCP:4000 -sTCP:LISTEN
```

---

## 12. Stopping everything

```bash
pkill -f "turbo run dev"        # host dev servers
pkill -f "expo start"           # Expo
pnpm docker:down                # containers, keeps data

pnpm docker:down:volumes        # DESTROYS every database. Only when you mean it.
```

---

## 13. Quick fixes

**`EADDRINUSE` on 3000/3001/4000** — Mode A and Mode B are both running. Stop
one. See section 2.

**"Store not found" on every storefront** — the tenant hostname is not reaching
the API. Test the API directly:
`curl -s -H 'Host: kickzone.localhost' http://localhost:4000/api/v1/store`

**"This store is temporarily unavailable"** — the API cannot reach the tenant's
database. Check `docker logs retailos-api | grep "Failed to connect"`. Usually
the cluster id in `tenant_databases` does not match `TENANT_CLUSTER_ID`.

**`permission denied for table …`** — run `pnpm db:tenant:migrate`, which
re-applies the privilege grants. Also required after restoring a backup.

**MySQL restarting in a loop** — it aborted mid-initialisation. Remove only its
volume (Postgres data is untouched):

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml rm -sf mysql
docker volume rm retailos_mysql-data
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mysql
```

**Mobile app shows no shops** — `EXPO_PUBLIC_API_URL` is pointing at the wrong
IP. See section 7.

**Docker daemon not running** — `open -a Docker`, then wait for it.

Fuller list: [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

---

## 14. Backups

```bash
./infrastructure/scripts/backup.sh                              # all databases
./infrastructure/scripts/restore.sh <backup-dir> tenant_kickzone  # ONE tenant
```

Restoring a single merchant leaves every other merchant untouched — that is the
practical payoff of a database per tenant. After any restore:

```bash
pnpm db:tenant:migrate          # re-applies grants
docker compose restart api worker
```

See [docs/BACKUP_AND_RECOVERY.md](docs/BACKUP_AND_RECOVERY.md).
