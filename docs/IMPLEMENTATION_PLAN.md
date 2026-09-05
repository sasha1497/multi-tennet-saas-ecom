# Implementation plan and delivery record

What was built, in what order, and what each phase produced. Written as a record
rather than a forecast — every phase below is complete unless stated otherwise.

## Approach

Build outward from the thing everything else depends on. Tenancy is not a
feature that can be added later: it determines the shape of the database layer,
the guards, the connection management and the tests. So it came first, and every
feature after it was built inside that constraint rather than retrofitted into
it.

The order was chosen so that each phase could be *verified* before the next
depended on it.

---

## Phase 1 — Foundations

Monorepo skeleton: pnpm workspaces + Turborepo, shared TypeScript and ESLint
configs, Prettier, the environment contract (`.env.example` with 100+ documented
variables), and the shared packages that everything else imports —
`@retailos/types`, `@retailos/validation`, `@retailos/config`.

**Verified by:** the workspace builds and typechecks with no application code
yet.

## Phase 2 — Data model

Master schema (15 models) and tenant schema (26 models). The constraint
migration (`0002_constraints_and_search`) that puts the invariants in the
database: total consistency, stock bounds, MRP ≥ price, partial unique indexes,
and the `pg_trgm` search indexes.

**Decisions made here:** database-per-tenant ([ADR-001](DECISION_LOG.md#adr-001)),
PostgreSQL primary with MySQL secondary ([ADR-002](DECISION_LOG.md#adr-002)),
money as integer minor units ([ADR-008](DECISION_LOG.md#adr-008)), immutable
order lines ([ADR-009](DECISION_LOG.md#adr-009)).

## Phase 3 — Tenancy core

The part everything else stands on: host resolution, the request context
(`AsyncLocalStorage`, [ADR-003](DECISION_LOG.md#adr-003)), the tenant connection
manager with its bounded LRU and busy counter
([ADR-005](DECISION_LOG.md#adr-005)), the tenant DDL service, the migration
runner with advisory locking and checksums
([ADR-006](DECISION_LOG.md#adr-006)), credential encryption, and the
provisioning state machine ([ADR-013](DECISION_LOG.md#adr-013)).

**Verified by:** seeding three tenants and confirming three physically separate
databases, each with encrypted credentials in the registry.

## Phase 4 — Auth and authorization

Two audiences, scrypt hashing ([ADR-007](DECISION_LOG.md#adr-007)), refresh
rotation with reuse detection, the permission catalogue, and the five-guard
pipeline in its load-bearing order — including `TenantGuard`, the security
centrepiece.

## Phase 5 — Commerce

Catalog, inventory with atomic reservation, the cart and its single pricing
calculator, coupons, the checkout transaction with the gateway call deliberately
outside it ([ADR-014](DECISION_LOG.md#adr-014)), order lifecycle with validated
transitions, and the payment provider abstraction with signature and webhook
verification.

## Phase 6 — Merchant and platform surfaces

The console API (45 endpoints), reports, staff management, store settings, and
the platform admin API for tenants, plans, entitlements, migrations and audit.

## Phase 7 — Front-ends

Storefront (17 routes) with server-rendered per-tenant theming
([ADR-012](DECISION_LOG.md#adr-012)); merchant console (23 routes) including the
platform admin; shared UI package with tokens, primitives and hand-drawn SVG
charts ([ADR-015](DECISION_LOG.md#adr-015)); the Expo mobile app with explicit
store selection.

## Phase 8 — Infrastructure

Three Compose files, Dockerfiles for the API and (parameterised) both web apps,
nginx with wildcard subdomain routing, Postgres and MySQL init scripts, and the
bootstrap, backup and restore scripts.

## Phase 9 — Testing

42 unit tests across pricing, security, domain resolution and the
permission/transition catalogues; the 34-test cross-tenant isolation suite; and
a 44-check end-to-end smoke script.

## Phase 10 — Documentation and CI

27 documents, the README, and the GitHub Actions workflow: lint, typecheck, unit
tests, build, the isolation suite against service containers, and Docker image
builds.

---

## Bugs found and fixed during the build

The ones worth recording, because each changed the design rather than just the
code.

**Tenant role had no privileges on migrated tables.** Migrations run as the
admin role, so tables were owned by admin and the application's least-privilege
role could not read them — `permission denied for table store_settings`. Fixed
by granting after every migration pass *and* setting `ALTER DEFAULT PRIVILEGES`
so future tables are granted automatically.

**The order-total CHECK constraint was wrong for inclusive pricing.** It assumed
tax-exclusive pricing while the store default is inclusive, double-counting tax
and rejecting every checkout. The fix was a modelling change — record
`tax_inclusive` on the order and branch the constraint — not a looser
constraint. [ADR-010](DECISION_LOG.md#adr-010).

**Storefront SSR resolved no tenant.** `Host` is a forbidden fetch header, so
`undici` silently dropped it and every server render said "store not found".
Fixed by sending `X-Forwarded-Host` and having the API prefer it — which nginx
also sets, so both paths agree.

**Validation errors carried no field details.** `nestjs-zod` throws
`ZodValidationException`, not a bare `ZodError`; the filter now unwraps both.

**Tenant database addresses were environment-specific.** The seed recorded
`localhost:5433` from the host machine, so the containerised API could not reach
any tenant. Fixed by separating recorded *placement* from configured
*reachability*. [ADR-016](DECISION_LOG.md#adr-016).

**A malformed `X-Tenant-Id` produced a 500.** Found by the isolation suite's own
injection block. Fixed at the boundary — shape-check in the guard, plus a `P2023`
mapping as a general backstop. [ADR-017](DECISION_LOG.md#adr-017).

**MySQL 8.4 crash loop.** `--default-authentication-plugin` was removed in 8.4;
the server refuses to start on the unknown variable.

**Metro could not resolve modules under pnpm.** `disableHierarchicalLookup` and
`unstable_enablePackageExports` both actively broke resolution; `@babel/runtime`
needed to be a direct dependency.

**A pricing test asserted the wrong total.** The test's amounts exceeded the
free-shipping threshold, so delivery was correctly free and the expectation was
wrong. Worth recording because the instinct is to change the code — the code was
right.

---

## Current state

| Check | Result |
| --- | --- |
| Lint (10 packages) | Clean, zero warnings |
| Typecheck (10 packages) | Clean |
| Unit tests | 42 passed |
| Cross-tenant isolation e2e | 34 passed |
| End-to-end smoke | 44 passed |
| Full Docker stack | 12 services healthy |
| Production images | API and both web apps build and run |
| Backup / restore | Exercised, single-tenant restore verified |

Roughly 45,000 lines of TypeScript across 254 files in 11 workspace packages.

---

## What is deliberately not built

Listed here rather than buried, because an honest scope boundary is more useful
than an implied one: merchant subscription billing (modelled, not charged),
cross-tenant analytics rollups, multi-location inventory, shipping-carrier
integration, front-end component tests, and load testing.

See [FUTURE_ROADMAP.md](FUTURE_ROADMAP.md).
