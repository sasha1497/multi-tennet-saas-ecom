# Decision log

Architecture decision records. Each states the context, the decision, the
alternatives that were rejected and why, and the consequences we accepted.

---

<a id="adr-000"></a>

## ADR-000 — The specification is the source of truth

**Context.** The brief referenced two uploaded inputs — a requirements document
and a UI reference screenshot. Neither existed in the working directory; it
contained only a zero-byte file named `txt`.

**Decision.** Treat the written specification in the brief as the sole source of
truth, state the absence plainly rather than inventing the missing content, and
proceed.

**Consequence.** Visual design follows the spec's description and ordinary
retail-console conventions rather than a specific mockup. Where the spec was
silent, the choice is recorded as an ADR below.

---

<a id="adr-001"></a>

## ADR-001 — Database per tenant

**Context.** Merchants are independent businesses. A leak between two of them is
not a bug report, it is a breach.

**Decision.** Every tenant gets a separate physical PostgreSQL database
(`tenant_<slug>`) with its own least-privilege role. A single master database
holds the control plane.

**Rejected: shared schema with a `tenant_id` column.** Cheapest to operate, but
it makes isolation a property of every query anyone ever writes. One forgotten
`WHERE tenant_id = ?` in one report is a cross-tenant leak, and the blast radius
of a single mistake is the whole platform.

**Rejected: schema per tenant in one database.** Better than a shared column,
but `search_path` is per-connection state — a pooled connection that keeps a
stale `search_path` is exactly the class of bug we are trying to eliminate. It
also shares one database's connection limit, WAL and backup unit.

**Consequences accepted.** More connections to manage (hence the pooled
connection manager); migrations run N times (hence the migration runner);
cross-tenant analytics needs a separate rollup path. In exchange, isolation is a
property of the *connection*, and a coding mistake degrades from "data breach"
to "wrong rows within the right store". Per-tenant backup, restore, relocation
and true deletion come free.

---

<a id="adr-002"></a>

## ADR-002 — PostgreSQL primary, MySQL secondary

**Context.** The brief requires MySQL in the Docker stack. The platform's needs
point at PostgreSQL.

**Decision.** PostgreSQL 16 for the master and all tenant databases. MySQL 8.4
runs as a secondary compatibility service holding no authoritative data.

**Why PostgreSQL for the real work.** Partial unique indexes (one default
address per customer, one primary image per product) expressed as constraints
rather than application code; `pg_trgm` for typo-tolerant search without a
separate search service; advisory locks, which the migration runner depends on;
richer CHECK constraints; and clean `CREATE DATABASE` ergonomics for per-tenant
provisioning.

**Why MySQL is still there.** The software Indian local retailers are migrating
*from* is overwhelmingly MySQL-based. The service is a landing zone for legacy
imports, a mirror for on-premise tools that can only speak MySQL, and proof that
the connection works. It is behind a profile in production.

---

<a id="adr-003"></a>

## ADR-003 — AsyncLocalStorage instead of request-scoped providers

**Context.** The tenant, the principal and the request id must be reachable from
anywhere in a request.

**Decision.** Keep them in an `AsyncLocalStorage` store
(`core/context/request-context.ts`).

**Rejected: NestJS `Scope.REQUEST`.** It re-instantiates the entire dependency
subtree of anything that touches the context — on every request, including
services that hold database clients. The performance cost is real and the
lifecycle surprises are worse.

**Additional benefit.** The context flows into BullMQ job handlers, so a worker
processing a tenant's job resolves tenants and permissions exactly as a
controller does, with no parallel plumbing.

---

<a id="adr-004"></a>

## ADR-004 — Tenant identity is established server-side, never accepted from the client

**Context.** The single most important security property of the platform.

**Decision.** Three trusted inputs, each verified: the hostname (storefront), a
live `tenant_users` membership (console), and a slug header that resolves a
public storefront and grants nothing (mobile). A tenant id in a request body or
query string is ignored, always. `X-Tenant-Id` is a *hint* — shape-checked, then
run through the same membership check — that can only select among tenants the
caller already belongs to.

**Consequence.** An owner with several stores needs an explicit selector, and the
console must send it. That is a small ergonomic cost for a guarantee that holds
even if a handler is written carelessly.

---

<a id="adr-005"></a>

## ADR-005 — Pooled per-tenant Prisma clients with a bounded LRU

**Context.** N tenant databases, each needing a Prisma client, against one
PostgreSQL `max_connections`.

**Decision.** A bounded LRU of clients with idle eviction, a busy counter that
prevents evicting a client mid-query, and a small per-client `connection_limit`.

**Rejected: one client per tenant, created on demand and never released.** Works
until the hundredth tenant exhausts the connection limit and every tenant fails
at once.

**Rejected: a single client with `SET search_path` per query.** That is ADR-001's
rejected schema-per-tenant model wearing a different hat.

**Consequence.** A cold tenant pays a connection-establishment cost on its first
request after eviction. Acceptable: local retail traffic is bursty and heavily
skewed, so the working set of active tenants is small.

---

<a id="adr-006"></a>

## ADR-006 — Versioned SQL tenant migrations with a custom runner

**Context.** Prisma Migrate targets one database with one shadow database. We
have N, provisioned at different times, possibly mid-deploy.

**Decision.** Tenant migrations are versioned SQL directories applied by our own
runner: advisory lock, checksum verification, per-migration transaction, a
ledger in the tenant's own `schema_migrations` table, and a mirrored ledger in
the master database. The SQL is *generated* from `tenant/schema.prisma` with
`prisma migrate diff`, so the Prisma schema remains the source of truth.

**Rejected: shelling out to `prisma migrate deploy` per tenant.** Slow (a process
per tenant), fragile in a container without the CLI, and it gives no central
view of which tenant is on which version.

**Consequence.** We own a SQL statement splitter — which must, and does, handle
comments, quoting, escapes and dollar-quoted bodies — and we own the failure
modes. In exchange, migrating 500 tenants is a loop with a progress report, and
the platform admin can see every tenant's schema version.

---

<a id="adr-007"></a>

## ADR-007 — scrypt for password hashing

**Context.** Passwords need a memory-hard hash. bcrypt and argon2 are the
conventional picks.

**Decision.** `crypto.scrypt` from Node's standard library, with a
self-describing stored format (`scrypt$N=16384,r=8,p=1$salt$hash`) so parameters
can be raised later without invalidating existing hashes.

**Why not bcrypt/argon2.** Both are native addons. They break on Node upgrades,
require build toolchains in the Docker image, and complicate multi-architecture
builds. scrypt is memory-hard, in the standard library, and needs none of that.

**Consequence.** scrypt is a slightly less fashionable choice than argon2id. The
parameters are recorded per hash, so raising them later is a login-time upgrade
rather than a migration.

---

<a id="adr-008"></a>

## ADR-008 — Money as integer minor units

**Decision.** Every monetary amount is a non-negative integer in the currency's
minor unit (paise). No floats, no decimals, anywhere in a price path.

**Consequence.** Every client must format for display, and every developer must
remember that `129900` is ₹1,299. In exchange there is no rounding drift, and the
database can enforce that totals add up.

`BigInt` is used only for lifetime aggregates, with a JSON serialisation bridge
installed at boot because `JSON.stringify` throws on `BigInt`.

---

<a id="adr-009"></a>

## ADR-009 — Order lines are immutable snapshots

**Decision.** `order_items` stores the product name, variant, SKU, image, unit
price, MRP, tax rate and computed amounts as they were at checkout. Reads never
join back to the live catalog for display.

**Why.** A merchant renames a product, changes its price, or deletes a variant
six months later. The invoice from last March must still say what the customer
actually bought and paid. An order that mutates with the catalog is an accounting
and legal problem, not a UX one.

---

<a id="adr-010"></a>

## ADR-010 — `tax_inclusive` recorded on the order

**Context.** Indian retail quotes tax-inclusive prices: a ₹1,180 shelf price
already contains ₹180 of GST. Some businesses quote exclusive. The database
CHECK constraint on order totals must be true for both.

**Decision.** Record the convention on the order itself and make the constraint
conditional:

```sql
total_amount = subtotal - discount_amount + shipping_amount
             + (CASE WHEN tax_inclusive THEN 0 ELSE tax_amount END)
```

**How it was found.** The original constraint assumed exclusive pricing while the
store default is inclusive, double-counting tax — checkout failed at write time
during development. The fix was a modelling change, not a looser constraint: a
store can change its setting later, and historical orders must stay valid.

---

<a id="adr-011"></a>

## ADR-011 — Zod as the single validation source

**Decision.** Schemas live in `@retailos/validation`. The API validates with them
through `nestjs-zod` (which also generates the OpenAPI document); the web apps
validate forms with the same objects; the mobile app imports them too.

**Consequence.** A schema change breaks the build of every client that has not
caught up — which is the point. The API and the UI cannot disagree about what is
valid, and the API docs cannot drift from what the API accepts.

One constraint this imposes: no regex lookbehind, because Hermes (React Native)
does not support it. `hostnameSchema` is written without it.

---

<a id="adr-012"></a>

## ADR-012 — Runtime tenant theming via CSS custom properties

**Context.** One storefront deployment must render N brand identities.

**Decision.** The root layout resolves the tenant server-side, fetches its
branding, and injects `--color-primary`, `--color-accent` and `--radius` on
`<html>`. Tailwind's preset consumes them as
`rgb(var(--color-primary) / <alpha-value>)`.

**Rejected: a build per tenant.** Does not scale past a handful of merchants and
makes onboarding a deployment.

**Rejected: client-side theming after hydration.** Produces a visible flash of
the wrong brand colour on every page load.

**Consequence.** The correct brand paints on first byte, from one deployment.

---

<a id="adr-013"></a>

## ADR-013 — Provisioning as an idempotent, resumable job

**Decision.** Tenant creation is a queued state machine
(`CREATE_DATABASE → RUN_MIGRATIONS → SEED_DEFAULTS → CONFIGURE_BRANDING →
ACTIVATE`) with recorded steps, idempotent primitives and a distributed lock. A
failure leaves the tenant in place to be resumed, never rolled back.

**Why not roll back.** Dropping a half-created database loses whatever did
succeed and risks destroying data if the failure was spurious — a network blip
or a transient connection limit. A resumable failure is strictly safer than a
destructive one.

---

<a id="adr-014"></a>

## ADR-014 — Payment gateway calls outside the database transaction

**Decision.** The checkout transaction re-validates lines, reserves stock,
allocates the order number, snapshots line items, redeems the coupon, creates the
payment record and clears the cart. The gateway call happens *after* it commits.

**Why.** A payment provider can take seconds or hang. Holding row locks on
inventory for the duration would serialise every checkout behind the slowest
gateway call. Idempotency keys and webhook deduplication cover the window
between commit and confirmation.

---

<a id="adr-015"></a>

## ADR-015 — Single-hue data visualisation with text-carried identity

**Context.** Dashboard charts must be readable by colour-blind users and legible
in both themes.

**Decision.** One validated hue for chart data, with series identity carried by
text labels rather than colour. Status colours are reserved for status.

**Consequence.** Charts convey less through colour alone and more through
labelling, which is the point. The palette was checked for contrast against the
actual rendered surfaces in both themes; the tokens live in
`packages/ui/src/styles.css` (`--viz-series-1` and the status palette), declared
for light, `prefers-color-scheme: dark`, and an explicit `[data-theme]`
override.

---

<a id="adr-016"></a>

## ADR-016 — Tenant DB address: recorded placement, configured reachability

**Context.** `tenant_databases` records each tenant's `host` and `port`. The same
row is read by the API inside a container (`postgres:5432`), by a developer on
the host (`localhost:5433`), and in production (an RDS endpoint). A single
recorded address cannot be right for all three.

**Decision.** `cluster_id` is the logical placement. For tenants on *this*
deployment's own cluster (`TENANT_CLUSTER_ID`), the configured
`TENANT_DB_HOST`/`TENANT_DB_PORT` win; tenants on any other cluster keep the
recorded address.

**Consequence.** One seeded database is usable from inside and outside Docker
without rewriting rows, and multi-cluster placement still works — a tenant moved
to a different cluster is reached at its recorded address.

**How it was found.** The full Docker stack returned "store temporarily
unavailable" for every tenant, because the seed had recorded `localhost:5433`
from the host machine.

---

<a id="adr-017"></a>

## ADR-017 — Malformed identifiers are rejected before the data layer

**Context.** A hand-crafted `X-Tenant-Id` that is not a UUID reached Prisma and
raised a driver error, surfacing as a 500.

**Decision.** Shape-check the tenant selector in `TenantGuard` before it reaches
the database, and map Prisma's `P2023` ("inconsistent column data") to a 400 in
the exception filter as a general backstop.

**Note on what this is not.** Prisma parameterises its queries, so the value was
never an injection risk. It was an information-disclosure and hygiene problem: a
500 tells an attacker their input reached the data layer, and an unhandled error
is not a reasoned response. Found by the isolation suite's injection block.
