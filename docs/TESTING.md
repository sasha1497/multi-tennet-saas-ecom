# Testing

## Strategy

Three layers, weighted by where the risk actually is.

**Unit tests** cover pure logic where a mistake is silent and expensive: money
arithmetic, cryptography, domain parsing and the permission/transition
catalogues. These need no databases and run in seconds.

**Integration (e2e) tests** cover tenant isolation. They boot the real
application against real databases, because the behaviour under test — host
resolution, per-tenant connection routing, guard ordering — lives in the
interaction between middleware, guards and Prisma. Mocking any of it would test
the mocks, not the guarantee.

**A smoke suite** exercises complete user journeys through HTTP against a
running stack.

## Running the tests

```bash
# Unit — no dependencies needed
pnpm test

# Cross-tenant isolation — needs the databases and seed data
pnpm docker:up:infra
pnpm db:migrate:deploy
pnpm db:seed
pnpm test:e2e
```

Current state: **42 unit tests** (2 suites) and **34 isolation tests** (1 suite),
all passing.

If the seed is missing, the e2e suite fails immediately with an actionable
message rather than 34 confusing assertion failures — `assertSeeded()` in
`apps/api/test/helpers.ts` exists for exactly that.

## The isolation suite

`apps/api/test/tenant-isolation.e2e-spec.ts` is the most important test file in
the repository. Its docblock says so:

> The platform's core promise is that a request to `kickzone.ourdomain.in` can
> never, under any circumstance, return ABC Store's data. Each test below tries
> to defeat one layer. A failure here is a data breach, not a bug.

It is organised as five layers plus an attack block.

**Layer 1 — each tenant has its own database.** Distinct database per tenant;
the API never returns tenant database credentials; credentials are stored
encrypted, never in plain text.

**Layer 2 — the Host header decides the tenant.** Each hostname gets its own
store and its own catalog; a product slug from one tenant 404s on another;
unknown hostnames, reserved subdomains and nested subdomains that merely
*contain* a tenant slug (`evil.kickzone.localhost`) are all refused.

**Layer 3 — a shopper token works in exactly one store.** The token works on its
own store and is rejected on every other, across the orders list, the address
book and checkout. Another tenant's order cannot be fetched by id. A spoofed
`X-Tenant-Slug` that contradicts the token is ignored.

**Layer 4 — merchant access requires a live membership.** An owner reads their
own store; an `X-Tenant-Id` naming a store they do not belong to is rejected on
every merchant surface, on reads and writes alike; a fabricated tenant id is
rejected; each owner sees only their own catalog and customers.

**Layer 5 — audience and privilege boundaries.** Shopper tokens are refused on
merchant routes and merchant tokens on shopper routes; merchant tokens are
refused on platform routes; unauthenticated and forged tokens are refused; RBAC
holds *within* a tenant (a MANAGER cannot manage staff); a super admin can read
across tenants and only a super admin can.

**Malicious `tenant_id` injection attempts.** A `tenantId` in the request body is
ignored. A `tenantId` in the query string is ignored. A malformed tenant header
— including SQL-injection-shaped values like `'; DROP TABLE tenants; --` — is
rejected cleanly with a 4xx and no information leak, and the test then asserts
the `tenants` table is still there. An `X-Tenant-Slug` cannot escape membership
checks.

### Why real databases

An isolation test against mocks proves that the mocks are isolated. The bugs
that actually cause cross-tenant leaks are: a connection resolved from the wrong
place, a guard registered in the wrong order, a Prisma client cached under the
wrong key, a middleware reading the wrong header. None of those are visible with
a mocked data layer.

The suite runs with `maxWorkers: 1` and a 60-second timeout, and boots the app
in-process with supertest — so it needs the databases, but not a running dev
server.

## Unit tests

`apps/api/src/modules/cart/pricing.service.spec.ts` — the money calculator.
Subtotals, inclusive vs exclusive tax, per-product tax rates, free-shipping
thresholds measured against the *post-discount* value, percentage caps,
discounts that never exceed the goods' value, proportional line distribution
that re-sums exactly, and an all-integers assertion. It ends with
`assertConsistent`, which mirrors the `orders_total_consistent` CHECK constraint
in both tax modes — if the test and the constraint ever disagree, orders start
failing at write time, so the invariant is asserted here in the same form.

`apps/api/src/core/security/security.spec.ts` — scrypt round-trip, unique salts,
malformed-hash handling, absurd-parameter rejection; AES-GCM round-trip, tamper
detection, wrong-key rejection, 32-byte key enforcement; guest-token signing,
forgery rejection and constant-time comparison.

`packages/config/src/domain.spec.ts` — 20 tests on hostname resolution: reserved
subdomains, multi-label rejection, lookalike-suffix rejection
(`ourdomain.in.evil.com` must not pass a CORS suffix check).

`packages/types/src/permissions.spec.ts` — 19 tests asserting that no merchant
role holds a `platform.*` permission, that `ASSIGNABLE_STAFF_ROLES` excludes
OWNER and SUPER_ADMIN, and that the order-status transition map forbids
PENDING→DELIVERED jumps, reviving refunded orders, and self-transitions.

These last two are catalogue tests: they exist so a future edit that quietly
grants a merchant a platform permission, or adds a shortcut through the order
lifecycle, fails the build.

## Smoke suite

A 44-check curl script exercises the full journey against a running API:
storefront bootstrap, catalog isolation, customer login, cart, COD checkout,
idempotent replay, online payment with a forged-signature rejection, seven
cross-tenant probes, the merchant console (including an optimistic-lock conflict,
an illegal status transition and an RBAC denial), the platform admin, and the
validation error envelope. Last run: **44 passed, 0 failed**.

## What is not covered

Stated plainly rather than implied:

- No front-end component or browser tests. The web apps are verified by
  typecheck, lint, production build and manual exercise against the seeded data.
- No load or soak testing. [SCALING.md](SCALING.md) documents where the system
  is expected to break first, but those limits are reasoned, not measured.
- No mutation testing or coverage gate.
- Payment tests use the mock provider. The Razorpay adapter's signature and
  webhook verification are exercised by unit-level checks, not against the live
  sandbox.

See [FUTURE_ROADMAP.md](FUTURE_ROADMAP.md).

## CI

`.github/workflows/ci.yml` runs lint, typecheck, unit tests, a build, and the
isolation suite against service containers for PostgreSQL and Redis, on every
push and pull request. A separate job builds the Docker images.
