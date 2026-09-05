# Development

## Prerequisites

- Node 20+
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.15.9 --activate`)
- Docker Desktop (or any Docker with Compose v2)

## First run

```bash
pnpm install
cp .env.example .env
pnpm docker:up:infra          # postgres, mysql, redis, minio, mailpit, adminer
pnpm db:migrate:deploy        # master schema
pnpm db:seed                  # 3 demo tenants, each with its own database
pnpm dev                      # api :4000, storefront :3000, console :3001
```

`.env.example` is configured for this flow — the API runs on your machine and
reaches the containers on their published ports. When the API itself runs in
Docker, Compose supplies the in-network addresses (`postgres:5432`,
`redis:6379`) and overrides these values.

### Published ports

RetailOS deliberately avoids the default ports so it can run alongside other
projects on the same machine:

| Service | Host port | In-network |
| --- | --- | --- |
| PostgreSQL | 5433 | `postgres:5432` |
| MySQL | 3307 | `mysql:3306` |
| Redis | 6379 | `redis:6379` |
| MinIO API / console | 9100 / 9101 | `minio:9000` |
| Mailpit | 8025 | `mailpit:1025` (SMTP) |
| Adminer | 8082 | — |
| Redis Commander | 8083 | — |
| nginx | 80 | — |

All of them are overridable via `*_HOST_PORT` variables in `.env`.

## Seed data

`pnpm db:seed` creates a super admin, three tenants with their own databases,
and a realistic catalog for each:

| Tenant | Domain | Sells | Owner | Customer |
| --- | --- | --- | --- | --- |
| KickZone | `kickzone.localhost` | footwear | `owner@kickzone.dev` | `priya@example.com` |
| ABC Store | `abcstore.localhost` | stationery & home | `owner@abcstore.dev` | `vikram@example.com` |
| Kumar Mobile Store | `kumarstore.localhost` | phones & accessories | `owner@kumarstore.dev` | `karthik@example.com` |

Every seeded account uses `Password@123`; the super admin
(`admin@retailos.dev`) uses `SuperAdmin@123`. Each tenant also has a
`staff@<slug>.dev` MANAGER account.

`*.localhost` resolves to 127.0.0.1 in every modern browser, so subdomain
routing works with no `/etc/hosts` changes.

## Everyday commands

```bash
pnpm dev                  # everything, in watch mode
pnpm --filter @retailos/api dev          # just the API
pnpm --filter @retailos/storefront-web dev

pnpm lint                 # eslint; warnings are errors
pnpm typecheck            # tsc --noEmit everywhere
pnpm test                 # unit tests
pnpm test:e2e             # cross-tenant isolation suite
pnpm format               # prettier

pnpm docker:up            # full stack in Docker behind nginx :80
pnpm docker:logs          # tail everything
pnpm docker:down          # stop, keep data
pnpm docker:down:volumes  # stop and delete all data
```

## Working on the database

The master schema and the tenant schema are separate Prisma schemas with
separate generated clients.

**Master** — ordinary Prisma migrations:

```bash
pnpm db:migrate           # create + apply a migration in dev
pnpm db:migrate:deploy    # apply pending migrations
pnpm db:studio            # browse the master database
```

**Tenant** — the schema is authored in `database/tenant/schema.prisma`, but the
migrations that actually run are versioned SQL files under
`database/tenant/migrations/`, applied by our own runner (see
[DATABASE_PROVISIONING.md](DATABASE_PROVISIONING.md)). To add one:

1. Edit `database/tenant/schema.prisma`.
2. Generate the SQL diff into a new numbered directory:

```bash
./database/node_modules/.bin/prisma migrate diff \
  --from-schema-datamodel database/tenant/schema.prisma@previous \
  --to-schema-datamodel  database/tenant/schema.prisma \
  --script > database/tenant/migrations/0003_your_change/migration.sql
```

   In practice: keep a copy of the previous schema, diff against it, or diff
   from the shadow database. Hand-written SQL is fine too — the runner does not
   care where the file came from, only that it is versioned and checksummed.

3. Apply it to every tenant:

```bash
pnpm db:tenant:migrate
```

Migrations are checksummed. Editing a file that has already been applied is
detected and refused — add a new migration instead.

### Regenerating clients

```bash
pnpm prisma:generate
```

Note: always use the workspace binary (`./database/node_modules/.bin/prisma`)
rather than `npx prisma`, which may resolve a different major version and reject
the schema.

## Project conventions

**Business logic lives in `apps/api`.** The web and mobile apps call the API.
If you find yourself computing a price, checking a permission or validating a
state transition in a client, it belongs in a service instead.

**Types and schemas are shared, not duplicated.** Add domain types to
`@retailos/types`, validation to `@retailos/validation`. Both are consumed by the
API and every client, so a change breaks the build of anything that has not
caught up — which is the point.

**Money is an integer in the minor unit.** Paise, not rupees. There are no
floats in a price path anywhere, and the database enforces it.

**Controllers are thin.** Parse, delegate, return. Anything longer than about
ten lines probably belongs in a service.

**Errors go through `AppException`.** `Errors.notFound()`, `Errors.forbidden()`
and friends produce the documented error envelope with a stable code. Never
throw a raw string.

**Every tenant-scoped query goes through the tenant Prisma client.** Never reach
for the master client to read shop data.

## Debugging

**API logs** are structured JSON via pino, pretty-printed in development. Every
line carries `requestId`, and tenant-scoped lines carry `tenantId` and
`tenantSlug`.

**Swagger** is at http://localhost:4000/docs, generated from the same Zod schemas
the API validates with.

**Adminer** (http://localhost:8082) browses any database — the master or any
`tenant_*`. Server `postgres`, user `retailos`, password from `.env`.

**Redis Commander** (http://localhost:8083) shows cache keys, rate-limit
counters, locks and BullMQ queues.

**Mailpit** (http://localhost:8025) catches every outbound email.

## Mobile

```bash
pnpm --filter @retailos/mobile start
```

The Expo app cannot use `*.localhost`, so it selects a store explicitly and
sends `X-Tenant-Slug`. Point `EXPO_PUBLIC_API_URL` at your machine's LAN IP
(e.g. `http://192.168.1.20:4000/api/v1`) to run on a physical device. See
[MOBILE.md](MOBILE.md).

## Troubleshooting

See [TROUBLESHOOTING.md](TROUBLESHOOTING.md) — it covers port conflicts,
"store not found", tenant connection failures, permission-denied on tenant
tables, and Metro resolution errors under pnpm.
