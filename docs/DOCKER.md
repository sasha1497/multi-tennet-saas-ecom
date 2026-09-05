# Docker

Three compose files, layered.

| File | Role |
| --- | --- |
| `docker-compose.yml` | The base stack. Every service, healthchecks, networking, volumes. No published database ports, no dev tooling |
| `docker-compose.dev.yml` | Development overlay. Publishes ports, bind-mounts source, adds MinIO, Mailpit, Adminer and Redis Commander |
| `docker-compose.prod.yml` | Production overlay. Memory limits, log rotation, `restart: always`, API replicas, no exposed databases |

```bash
pnpm docker:up        # base + dev  — the whole stack, nginx on :80
pnpm docker:up:infra  # just postgres, mysql, redis, minio, mailpit, adminer
pnpm docker:prod      # base + prod
pnpm docker:logs      # tail everything
pnpm docker:down      # stop, keep volumes
```

## Services

| Service | Image | Purpose |
| --- | --- | --- |
| `postgres` | postgres:16-alpine | Master database + every tenant database |
| `mysql` | mysql:8.4 | Secondary compatibility service (see below) |
| `redis` | redis:7-alpine | Cache, rate limits, locks, BullMQ |
| `api` | built | The REST API |
| `worker` | built (same image) | BullMQ processors |
| `storefront-web` | built | Customer storefront |
| `merchant-web` | built | Merchant console + platform admin |
| `nginx` | nginx:1.27-alpine | Reverse proxy, wildcard subdomain routing |
| `minio` + `minio-init` | quay.io/minio | S3-compatible storage (dev) |
| `mailpit` | axllent/mailpit | Catches outbound email (dev) |
| `adminer` | adminer | Database browser (dev) |
| `redis-commander` | rediscommander | Redis browser (dev) |

Every long-running service has a healthcheck, and dependants wait on
`condition: service_healthy` rather than merely `service_started` — so the API
does not start racing an uninitialised database.

## Images

**`infrastructure/docker/api.Dockerfile`** — multi-stage: `base` → `deps` →
`build` → `prod-deps` → `runtime`. The final image contains no build toolchain,
runs as the non-root `node` user, and carries the compiled API, the generated
Prisma clients with their query engines, and the tenant migration SQL (the
runtime runner reads it from disk).

One image serves both the API and the worker — `dist/main.js` and
`dist/worker.js` share every module, so building twice would only double CI time
and risk drift.

`bookworm-slim` rather than Alpine: Prisma's query engine ships a glibc build,
and the musl variant is an extra download and a recurring source of surprises.

**`infrastructure/docker/web.Dockerfile`** — one file builds *both* Next.js
apps; they differ only in `APP_NAME` and `APP_PORT`, passed as build args. Uses
Next's `output: 'standalone'`, so the runtime stage carries a self-contained
server plus exactly the traced dependencies rather than a full install.

**`*.dev.Dockerfile`** — development variants that keep dev dependencies and run
the watch-mode servers against bind-mounted source.

Both production images build from the **repository root** as context, because
this is a pnpm workspace and the apps depend on local packages.

## Networking

One user-defined bridge network, `retailos`. Services address each other by
service name — `postgres:5432`, `redis:6379`, `minio:9000` — which is why
Compose overrides `TENANT_DB_HOST` and friends for the API and worker.

nginx is the only service that needs to be reachable from outside in production.

## Ports

Published host ports are parameterised so RetailOS can run alongside other
projects. Defaults in `.env`:

| Variable | Default | Service |
| --- | --- | --- |
| `POSTGRES_HOST_PORT` | 5433 | PostgreSQL |
| `MYSQL_HOST_PORT` | 3307 | MySQL |
| `REDIS_HOST_PORT` | 6379 | Redis |
| `MINIO_HOST_PORT` / `MINIO_CONSOLE_HOST_PORT` | 9100 / 9101 | MinIO |
| `ADMINER_HOST_PORT` | 8082 | Adminer |
| `REDIS_COMMANDER_HOST_PORT` | 8083 | Redis Commander |
| `NGINX_HTTP_PORT` | 80 | nginx |

In production, `docker-compose.prod.yml` publishes **no** database ports at all.

## Volumes

| Volume | Contents |
| --- | --- |
| `postgres-data` | Master and all tenant databases |
| `mysql-data` | Compatibility schema |
| `redis-data` | Redis persistence |
| `minio-data` | Uploaded media |
| `api-storage` | Local-driver file storage |

`pnpm docker:down` keeps them. `pnpm docker:down:volumes` deletes everything,
including every tenant database.

## nginx

`infrastructure/nginx/conf.d/retailos.conf` has three server blocks:

- `*.ourdomain.in` (wildcard) → `storefront-web`
- `admin.ourdomain.in` → `merchant-web`
- `/api/` on any host → `api`

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
```

Both are load-bearing. The API resolves the tenant from the incoming hostname,
so a proxy that rewrote `Host` to the upstream's name would collapse every
tenant into "unknown". `X-Forwarded-Host` is what the storefront's server-side
rendering can actually set — `Host` is a forbidden fetch header, so `undici`
drops it silently — and the API prefers it.

## Redis configuration

Redis runs with `--maxmemory-policy noeviction`. BullMQ requires it: an evicted
job key is a lost job. Cache keys carry their own TTLs, so nothing depends on
eviction to stay bounded.

## MySQL

MySQL 8.4 is a **secondary compatibility service** holding no authoritative
data — see [DATABASE.md](DATABASE.md#why-mysql-is-in-the-stack). In production
it sits behind a Compose profile and is not started by default:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile compat up -d
```

Note for anyone editing its command: MySQL 8.4 **removed**
`--default-authentication-plugin`, and the server refuses to start on the
unknown variable. Use `--authentication-policy` instead.

## Building

```bash
pnpm docker:build     # via compose

# Or directly
docker build -f infrastructure/docker/api.Dockerfile -t retailos/api .
docker build -f infrastructure/docker/web.Dockerfile \
  --build-arg APP_NAME=storefront-web --build-arg APP_PORT=3000 \
  -t retailos/storefront-web .
```

## Verifying a running stack

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml ps

curl -s -H 'Host: api.localhost' http://localhost/api/v1/health | jq

for t in kickzone abcstore kumarstore; do
  curl -s -H "Host: $t.localhost" http://localhost/api/v1/store | jq -r '.data.store.storeName'
done
```

Expected: three different shop names from the same deployment.

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) for port conflicts, unhealthy
containers, "store not found", and tenant connection failures.
