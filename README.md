# RetailOS

A multi-tenant e-commerce SaaS for local retail. One platform, one codebase, one
API — and a **separate physical database for every merchant**.

Each shop gets its own storefront on its own subdomain
(`kickzone.ourdomain.in`), its own admin console, and its own PostgreSQL
database. Shoppers browse and buy on the web or in the mobile app; merchants run
their catalog, inventory, orders and staff from the console; the platform team
manages tenants, plans and provisioning from a super-admin surface.

```
   kickzone.ourdomain.in ─┐
   abcstore.ourdomain.in ─┼─→ nginx ─→ storefront-web (Next.js)
 kumarstore.ourdomain.in ─┘                    │
                                               ▼
        admin.ourdomain.in ─→ merchant-web ─→ API (NestJS) ─→ master DB
                                               │                 (tenants,
              mobile app (Expo) ───────────────┤                  users, plans)
                                               │
                                               ├─→ tenant_kickzone
                                               ├─→ tenant_abcstore
                                               └─→ tenant_kumarstore
```

---

## Quick start

Requires Docker, Node 20+ and pnpm 9.

```bash
pnpm install
cp .env.example .env                 # defaults work as-is for local dev
pnpm docker:up:infra                 # postgres, mysql, redis, minio, mailpit
pnpm db:migrate:deploy               # master schema
pnpm db:seed                         # 3 demo tenants, each with its own database
pnpm dev                             # api :4000, storefront :3000, console :3001
```

Then open:

| Surface | URL | Sign in with |
| --- | --- | --- |
| KickZone storefront | http://kickzone.localhost:3000 | `priya@example.com` / `Password@123` |
| ABC Store storefront | http://abcstore.localhost:3000 | `vikram@example.com` / `Password@123` |
| Kumar Store storefront | http://kumarstore.localhost:3000 | `karthik@example.com` / `Password@123` |
| Merchant console | http://localhost:3001 | `owner@kickzone.dev` / `Password@123` |
| Platform admin | http://localhost:3001/platform | `admin@retailos.dev` / `SuperAdmin@123` |
| API docs (Swagger) | http://localhost:4000/docs | — |
| Mail catcher | http://localhost:8025 | — |
| Adminer | http://localhost:8082 | — |

`*.localhost` resolves to 127.0.0.1 in every modern browser, so subdomain
routing works locally with no `/etc/hosts` edits.

The whole stack — including the API, both web apps and nginx — runs in Docker
with `pnpm docker:up`, which serves everything through nginx on port 80.

---

## What's in the box

**Storefront (web + mobile)** — catalog with search, filters and categories,
product pages with variants and reviews, cart, coupons, address book, checkout
(online payment or cash on delivery), order history and tracking, wishlist,
notifications.

**Merchant console** — dashboard with revenue/order charts, products and
variants, categories, brands, image upload, inventory with stock adjustments and
low-stock thresholds, orders with status workflow, customers, coupons, review
moderation, sales/customer/inventory reports, store settings and branding, staff
management with roles.

**Platform admin** — tenant directory, tenant creation and provisioning,
subscription plans, entitlements, suspend/reactivate, per-tenant schema
migration, audit log, service health and queue depth.

**Under the hood** — database-per-tenant provisioning state machine, versioned
tenant migrations with advisory locking, JWT access tokens with refresh rotation
and reuse detection, granular `resource.action` RBAC, a payment-provider
abstraction with signature and webhook verification, idempotent checkout,
atomic inventory reservation, BullMQ workers, S3-compatible storage, structured
logging and Prometheus metrics.

---

## Repository layout

```
apps/
  api/                NestJS REST API — the only place business logic lives
  storefront-web/     Next.js 14 customer storefront (multi-tenant by host)
  merchant-web/       Next.js 14 merchant console + platform admin
  mobile/             Expo / React Native customer app
packages/
  types/              Shared domain types, enums, permission catalogue
  validation/         Zod schemas — one source of truth for API and clients
  config/             Env config, domain resolution, formatting, Tailwind preset
  api-client/         Typed API client shared by all three front-ends
  ui/                 Shared React components, design tokens, charts
  tsconfig/           Base TypeScript configs
  eslint-config/      Shared lint rules
database/
  master/             Master (control-plane) Prisma schema + migrations
  tenant/             Per-tenant Prisma schema + versioned SQL migrations
infrastructure/
  docker/             Dockerfiles, Postgres and MySQL init scripts
  nginx/              Reverse proxy config (wildcard subdomains)
  scripts/            Bootstrap and operational scripts
docs/                 Architecture, operations and reference documentation
```

Business logic lives in `apps/api` and nowhere else. The web apps and the mobile
app are clients of the same REST API and share the same types, schemas and
client package — there is no second implementation of pricing, stock or
permissions to drift out of sync.

---

## Documentation

Start with the first three.

| Document | What it covers |
| --- | --- |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, request lifecycle, module map |
| [TENANCY.md](docs/TENANCY.md) | How tenants are resolved, isolated and provisioned |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Local setup, day-to-day workflows |
| [REQUIREMENTS.md](docs/REQUIREMENTS.md) | Functional and non-functional scope |
| [DATABASE.md](docs/DATABASE.md) | Master and tenant schemas, indexes, constraints |
| [DATABASE_PROVISIONING.md](docs/DATABASE_PROVISIONING.md) | The provisioning state machine and migration runner |
| [AUTHENTICATION.md](docs/AUTHENTICATION.md) | Tokens, sessions, RBAC, permission catalogue |
| [SECURITY.md](docs/SECURITY.md) | Threat model and the controls that answer it |
| [API.md](docs/API.md) | Conventions, error envelope, endpoint reference |
| [API_EXAMPLES.md](docs/API_EXAMPLES.md) | Copy-pasteable curl walkthroughs |
| [PAYMENT.md](docs/PAYMENT.md) | Provider abstraction, webhooks, idempotency |
| [NOTIFICATIONS.md](docs/NOTIFICATIONS.md) | Email, SMS and push delivery |
| [WEB.md](docs/WEB.md) | Storefront and console front-end architecture |
| [MOBILE.md](docs/MOBILE.md) | Expo app structure, store selection, builds |
| [TESTING.md](docs/TESTING.md) | Test strategy, running the isolation suite |
| [DOCKER.md](docs/DOCKER.md) | Compose files, images, healthchecks |
| [DEPLOYMENT.md](docs/DEPLOYMENT.md) | Production deployment procedure |
| [STARTUP_DEPLOYMENT.md](docs/STARTUP_DEPLOYMENT.md) | Cheapest viable production setup |
| [AWS_ARCHITECTURE.md](docs/AWS_ARCHITECTURE.md) | Two reference AWS topologies |
| [SCALING.md](docs/SCALING.md) | Where it breaks first and what to do |
| [COST_OPTIMIZATION.md](docs/COST_OPTIMIZATION.md) | Cost model and levers |
| [MONITORING.md](docs/MONITORING.md) | Logs, metrics, health, alerting |
| [BACKUP_AND_RECOVERY.md](docs/BACKUP_AND_RECOVERY.md) | Backup strategy, restore drills |
| [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md) | Symptoms → causes → fixes |
| [DECISION_LOG.md](docs/DECISION_LOG.md) | Architecture decision records |
| [IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md) | Build phases and what was delivered |
| [FUTURE_ROADMAP.md](docs/FUTURE_ROADMAP.md) | Deliberate gaps and what comes next |

---

## Tenant isolation

This is the promise the product is built on, so it is tested rather than
asserted:

```bash
pnpm docker:up:infra && pnpm db:migrate:deploy && pnpm db:seed
pnpm test:e2e
```

`apps/api/test/tenant-isolation.e2e-spec.ts` boots the real application against
the real databases and attacks it from five directions: separate databases,
host-based resolution, shopper tokens pointed at the wrong store, merchant
tokens without a membership, and audience/privilege boundaries — plus a block of
deliberate `tenant_id` injection attempts through the body, the query string and
headers. See [SECURITY.md](docs/SECURITY.md) and [TESTING.md](docs/TESTING.md).

---

## Common commands

```bash
pnpm dev                  # every app in watch mode
pnpm build                # build everything (turbo, cached)
pnpm lint                 # eslint, zero warnings tolerated
pnpm typecheck            # tsc --noEmit across the workspace
pnpm test                 # unit tests
pnpm test:e2e             # cross-tenant isolation suite (needs the databases)

pnpm db:migrate           # create a master migration
pnpm db:migrate:deploy    # apply master migrations
pnpm db:tenant:migrate    # apply tenant migrations to every tenant database
pnpm db:seed              # demo tenants and data
pnpm db:studio            # Prisma Studio on the master database

pnpm docker:up            # full stack in Docker, behind nginx on :80
pnpm docker:up:infra      # just the backing services
pnpm docker:logs          # tail everything
pnpm docker:down          # stop (keeps volumes)
```

## License

Unlicensed / proprietary. See the repository owner.
