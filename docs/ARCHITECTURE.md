# Architecture

## The shape of the system

RetailOS is one API serving three clients across many tenants. Every merchant
gets an isolated PostgreSQL database; the platform keeps a single master
database that knows which merchants exist and where their data lives.

```
                    ┌──────────────────────────────────────────┐
  kickzone.*  ──┐   │                 nginx                    │
  abcstore.*  ──┼──▶│  *.ourdomain.in  → storefront-web :3000   │
  kumarstore.*──┘   │  admin.ourdomain.in → merchant-web :3001  │
                    │  /api/*          → api :4000              │
                    └──────────────────────────────────────────┘
                                       │
   ┌───────────────┬───────────────────┼───────────────────┐
   ▼               ▼                   ▼                   ▼
storefront-web  merchant-web       mobile (Expo)      external
 (Next SSR)      (Next SPA)                           webhooks
   │               │                   │                   │
   └───────────────┴─────────┬─────────┴───────────────────┘
                             ▼
                   ┌──────────────────┐        ┌──────────┐
                   │  API (NestJS)    │───────▶│  Redis   │
                   │  REST /api/v1    │        │ cache,   │
                   └──────────────────┘        │ locks,   │
                      │            │           │ BullMQ   │
                      │            │           └──────────┘
                      │            │                 ▲
                      ▼            ▼                 │
              ┌─────────────┐  ┌──────────────┐   ┌──────────┐
              │  master DB  │  │ tenant DBs   │   │  worker  │
              │  (Postgres) │  │ (Postgres)   │◀──│ (BullMQ) │
              │             │  │ tenant_x     │   └──────────┘
              │ tenants     │  │ tenant_y     │
              │ users       │  │ tenant_z     │        ┌───────┐
              │ plans       │  └──────────────┘        │  S3 / │
              │ audit       │                          │ MinIO │
              └─────────────┘                          └───────┘
```

MySQL also runs in the stack as a secondary compatibility service. It holds no
authoritative data — see [DATABASE.md](DATABASE.md#why-mysql-is-in-the-stack).

## Why one API, three clients

The storefront, the console and the mobile app do not share business logic by
convention — they share it by construction. Pricing, stock reservation, coupon
validity, order-state transitions and permission checks exist once, in
`apps/api`, and every client reaches them over the same REST endpoints.

What the clients share instead of logic:

- `@retailos/types` — domain types, enums, the permission catalogue, the legal
  order-status transition map.
- `@retailos/validation` — Zod schemas. The API validates with them (via
  `nestjs-zod`, which also generates the OpenAPI document); the web apps
  validate forms with the same objects; the mobile app imports them too.
- `@retailos/api-client` — a typed client with envelope unwrapping and
  single-flight token refresh.

A price rule can therefore only be wrong in one place, and a schema change
breaks the build of every client that has not caught up.

## Request lifecycle

A storefront request, end to end:

```
1. nginx            sets X-Forwarded-Host, proxies to the API
2. RequestContext   AsyncLocalStorage store created; request id assigned
3. TenantResolver   middleware reads the host → looks up the tenant (cached)
4. RateLimitGuard   per-IP / per-route counters in Redis
5. JwtAuthGuard     verifies the bearer token; deny-by-default
6. TenantGuard      *verifies* the tenant against the caller's identity
7. PermissionsGuard checks the required resource.action against the role
8. FeatureGuard     checks the tenant's plan entitlements
9. ZodValidationPipe validates body / query / params
10. Controller      thin: parses input, calls a service
11. Service         business logic; gets a Prisma client for *this* tenant
12. TransformInterceptor wraps the result in the response envelope
13. AllExceptionsFilter maps anything thrown to a stable error shape
```

Guard order is registration order in `apps/api/src/app.module.ts` and is
load-bearing: authentication must precede tenant verification, which must
precede permission checks, which must precede plan entitlements.

### Request context without request-scoped providers

The tenant, the authenticated principal and the request id live in an
`AsyncLocalStorage` store (`core/context/request-context.ts`), not in a
request-scoped provider. NestJS's `Scope.REQUEST` would re-instantiate the
entire dependency subtree of anything that touches the context on every
request — including services holding database clients. `AsyncLocalStorage` also
survives into BullMQ job handlers, so a worker processing a tenant's job has the
same context a controller would. See [ADR-003](DECISION_LOG.md#adr-003).

## Tenant routing

Tenant identity is established server-side and never read from a request body or
query string. In summary:

- **Storefront traffic** — the tenant comes from the `Host` (or
  `X-Forwarded-Host` when a proxy or Next's SSR is in front). A customer's token
  is bound to one tenant and must agree with the host.
- **Merchant console traffic** — there is no tenant hostname, so the tenant
  comes from the caller's verified `tenant_users` membership. An `X-Tenant-Id`
  header may *select* among stores the caller already belongs to; it can never
  add one.
- **Mobile** — sends `X-Tenant-Slug`, which resolves a storefront exactly as a
  hostname would and grants nothing beyond that.

The full rule set, with the reasoning for each, is in
[TENANCY.md](TENANCY.md) and enforced by `common/guards/tenant.guard.ts`.

## Data access

`TenantConnectionManager` (`core/database/`) hands services a Prisma client
bound to the current tenant's database. It keeps a bounded LRU pool of clients,
evicts idle ones, refuses to evict a client with in-flight work, and gives each
client a small `connection_limit` so N tenants do not exhaust PostgreSQL's
`max_connections`. Credentials come from the master database, AES-256-GCM
encrypted at rest.

The master client is a plain singleton — there is only ever one master database.

## Modules

`apps/api/src/`

| Path | Responsibility |
| --- | --- |
| `config/` | Env parsing and validation; fails fast at boot |
| `core/context/` | AsyncLocalStorage request context |
| `core/database/` | Master client, tenant connection manager, tenant DDL |
| `core/tenant/` | Host resolution, tenant lookup, membership checks |
| `core/security/` | Password hashing, credential encryption, token hashing |
| `core/cache/` | Redis cache with tenant-scoped keys |
| `core/queue/` | BullMQ queues and job producers |
| `core/storage/` | S3-compatible and local file storage |
| `core/logger/` | Structured pino logging with request correlation |
| `core/observability/` | Prometheus metrics, health probes |
| `common/guards/` | Rate limit, JWT, tenant, permissions, feature |
| `common/filters/` | The single exception filter |
| `common/interceptors/` | Logging, response envelope |
| `modules/auth/` | Registration, login, refresh rotation, tenant switching |
| `modules/storefront/` | Public catalog reads |
| `modules/cart/` | Cart mutations and the pricing calculator |
| `modules/orders/` | Checkout, order lifecycle, reservations |
| `modules/payments/` | Provider abstraction, verification, webhooks |
| `modules/customers/` | Profile, addresses, wishlist, notifications |
| `modules/merchant/` | The console API (catalog, inventory, orders, staff…) |
| `modules/inventory/` | Stock movements and thresholds |
| `modules/catalog/` | Product/category/brand writes |
| `modules/coupons/` | Coupon definition and redemption |
| `modules/reviews/` | Review submission and moderation |
| `modules/reports/` | Sales, customer and inventory reporting |
| `modules/staff/` | Staff invitation and role assignment |
| `modules/store/` | Store settings and branding |
| `modules/tenants/` | Tenant provisioning and migration orchestration |
| `modules/platform/` | Super-admin surface |
| `modules/entitlements/` | Plan limits and feature flags |
| `modules/audit/` | Audit trail |
| `modules/notifications/` | Email/SMS/push dispatch |
| `modules/health/` | Liveness, readiness, metrics |
| `worker/` | BullMQ processors: provisioning, notifications, maintenance |

## Workers

`apps/api/src/worker.ts` boots the same `AppModule` with the HTTP layer omitted
and registers three processors:

- **provisioning** — runs the tenant provisioning state machine.
- **notifications** — sends order and account emails, SMS and push.
- **maintenance** — releases stale stock reservations, prunes expired sessions
  and tokens, refreshes report aggregates.

Because it is the same module graph, a worker resolves tenants, permissions and
Prisma clients exactly as the API does.

## Front-ends

**storefront-web** renders each tenant's shop from one deployment. The root
layout resolves the tenant server-side from the incoming host, fetches the
store's branding, and injects the merchant's colours as CSS custom properties on
`<html>` — so the correct brand paints on first byte with no flash of the wrong
colour.

**merchant-web** is a client-rendered console over the same API, plus the
platform-admin routes under `/platform`, which are visible only to a super
admin.

**mobile** is an Expo app using expo-router with the same api-client and Zod
schemas. It selects a store explicitly (there is no hostname on a phone) and
sends `X-Tenant-Slug`.

See [WEB.md](WEB.md) and [MOBILE.md](MOBILE.md).

## Failure and consistency

- **Money** is stored as integer minor units. No floats anywhere in a price path.
- **Order lines are snapshots.** Editing a product later never rewrites history.
- **Stock** is reserved by a single conditional `UPDATE … WHERE quantity -
  reserved >= n`, with CHECK constraints as a backstop, so overselling is
  impossible even under concurrency.
- **Checkout is idempotent** on an `Idempotency-Key`, and the payment gateway
  call happens outside the database transaction so a slow gateway cannot hold
  locks.
- **Webhooks** are signature-verified and deduplicated by provider event id.

## Related reading

[TENANCY.md](TENANCY.md) · [DATABASE.md](DATABASE.md) ·
[SECURITY.md](SECURITY.md) · [DECISION_LOG.md](DECISION_LOG.md)
