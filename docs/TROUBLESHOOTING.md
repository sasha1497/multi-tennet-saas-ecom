# Troubleshooting

Symptoms, causes and fixes — most of these were hit while building the system,
so the diagnosis is the one that actually worked.

---

## "Store not found" on every storefront

**Cause 1 — the tenant hostname is not reaching the API.** The tenant is
resolved from `X-Forwarded-Host` or `Host`. Anything in front that rewrites
`Host` to the upstream's name collapses every tenant into "unknown".

```bash
curl -s -H 'Host: kickzone.localhost' http://localhost/api/v1/store | jq -r '.data.store.storeName'
```

If that works but the browser does not, the proxy is the problem. nginx must set
both:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
```

**Cause 2 — server-side rendering cannot set `Host`.** `Host` is a forbidden
fetch header; `undici` drops it silently, so an SSR request that only sets `Host`
resolves to no tenant. The storefront sends `X-Forwarded-Host` instead, and the
API prefers it. If you add a new server-side fetch, use the shared `serverApi()`
helper rather than calling `fetch` directly.

**Cause 3 — the tenant genuinely does not exist or is not ACTIVE.**

```bash
docker exec retailos-postgres psql -U retailos -d retailos_master \
  -c "select slug, status from tenants order by slug;"
```

---

## "This store is temporarily unavailable" (SERVICE_UNAVAILABLE)

The API resolved the tenant but could not connect to its database.

```bash
docker logs retailos-api 2>&1 | grep "Failed to connect to tenant database"
```

**Most common cause: the recorded database address is unreachable from where the
API runs.** A tenant seeded from your host machine records `localhost:5433`,
which means nothing inside a container.

The connection manager handles this: for tenants on this deployment's own
cluster (`TENANT_CLUSTER_ID`), the configured `TENANT_DB_HOST`/`TENANT_DB_PORT`
win. So check that the cluster ids match:

```bash
docker exec retailos-postgres psql -U retailos -d retailos_master \
  -tAc "select cluster_id, host, port, database_name from tenant_databases;"
docker exec retailos-api printenv | grep TENANT_CLUSTER_ID
```

If they differ, the recorded address is used verbatim — which is correct for a
genuinely remote cluster and wrong if the ids simply drifted.

---

## `permission denied for table <something>`

Tenant migrations run as the **admin** role, so tables are owned by admin and
the per-tenant role has no rights on them.

```bash
pnpm db:tenant:migrate     # re-runs the privilege grants as well as any SQL
```

This is also the required step after restoring a database from backup.

---

## Port already in use

RetailOS deliberately avoids default ports (Postgres 5433, MySQL 3307, MinIO
9100/9101, Adminer 8082). If something else still conflicts, change the
`*_HOST_PORT` variable in `.env` rather than stopping the other project.

```bash
lsof -nP -iTCP:5433 -sTCP:LISTEN
```

---

## MySQL container restarts in a loop

```
[ERROR] unknown variable 'default-authentication-plugin=caching_sha2_password'
```

MySQL 8.4 **removed** that option; use `--authentication-policy` instead. If the
container crashed during first initialisation, its data directory is half-built
and must be discarded:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml rm -sf mysql
docker volume rm retailos_mysql-data
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d mysql
```

That removes only MySQL's volume. Postgres data — every tenant — is untouched.

---

## Prisma rejects `datasource.url`, or generates the wrong client

`npx prisma` may resolve a different major version than the workspace's. Always
use the workspace binary, from the repository root so the root `.env` is loaded:

```bash
./database/node_modules/.bin/prisma migrate deploy --schema=database/master/schema.prisma
```

The `pnpm db:*` scripts already do this.

---

## `too many clients already`

The connection wall. See [SCALING.md](SCALING.md#1-database-connections-the-first-real-wall).

Immediate mitigation:

```bash
TENANT_DB_CONNECTION_LIMIT=2
TENANT_POOL_MAX_CONNECTIONS=20
```

---

## Jobs are not being processed

```bash
docker logs retailos-worker --tail 50
curl -s $API/platform/system/queues -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" | jq
```

Check Redis' eviction policy — BullMQ requires `noeviction`, because an evicted
job key is a lost job:

```bash
docker exec retailos-redis redis-cli config get maxmemory-policy
```

---

## A tenant is stuck in PROVISIONING

Provisioning is resumable by design; a failure is left in place rather than
rolled back.

```bash
curl -s $API/platform/tenants/$TID/provisioning-jobs \
  -H "Authorization: Bearer $STOK" | jq '.[0] | {status, completedSteps, error}'

curl -X POST $API/platform/tenants/$TID/provision -H "Authorization: Bearer $STOK"
```

Re-running is safe: completed steps are skipped and every primitive is
idempotent.

---

## Validation errors have no field details

Fixed, but worth knowing the shape: `nestjs-zod` throws `ZodValidationException`,
not a bare `ZodError`. `AllExceptionsFilter` unwraps both and surfaces the first
field message as the top-level message with the rest in `details`.

---

## Everything 500s with an id in the request

A malformed identifier used to reach Prisma and raise a driver error. Now the
tenant selector is shape-checked in the guard, and Prisma's `P2023` maps to a
400. If you see a new 500 of this kind, the fix belongs at the boundary — add
the validation — rather than in the filter.

---

## Metro cannot resolve a module (mobile)

Under pnpm's isolated `node_modules` layout:

- **Do not set `disableHierarchicalLookup = true`.** It suits hoisted layouts;
  pnpm relies on per-package `node_modules`, and setting it breaks resolution of
  `@expo/metro-runtime` and others.
- **Do not set `unstable_enablePackageExports = true`** speculatively — it broke
  `react-native` resolution here.
- If a `@babel/runtime/helpers/*` import fails, add `@babel/runtime` as a
  **direct** dependency of the mobile app.

The working configuration, with the reasoning, is in
`apps/mobile/metro.config.js`.

---

## Web app build fails on the Tailwind preset type

`presets: [preset as Partial<Config>]`, plus the
`src/types/tailwind-preset.d.ts` module declaration each web app carries.

---

## Cross-tenant test failures

Treat these as **breaches, not flakes**. Before anything else, confirm the seed
is present — a missing seed produces confusing failures, which is why
`assertSeeded()` fails fast with an actionable message:

```bash
pnpm docker:up:infra && pnpm db:migrate:deploy && pnpm db:seed && pnpm test:e2e
```

If the seed is present and a test still fails, do not adjust the test. Find out
which layer stopped holding.

---

## Getting more detail

```bash
LOG_LEVEL=debug pnpm --filter @retailos/api dev
docker compose -f docker-compose.yml -f docker-compose.dev.yml logs -f api worker
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
```

Quote the `requestId` from the response — every log line for that request
carries it.
