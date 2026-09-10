# Multi-tenancy

Every merchant on RetailOS gets a **separate physical PostgreSQL database**. The
platform keeps one master database that records which merchants exist, who may
act on them, and where their data lives.

## Why database-per-tenant

The alternatives were a shared schema with a `tenant_id` column on every table,
or a schema-per-tenant layout in one database.

A shared `tenant_id` column makes isolation a property of _every query anyone
ever writes_. One forgotten `WHERE tenant_id = ?` in one report, one `findMany`
without a filter, and a merchant sees a competitor's customers. The blast radius
of a single mistake is the whole platform.

With database-per-tenant, isolation is a property of the _connection_. A query
that forgets a filter returns that tenant's own rows, because the connection
cannot see any others. The failure mode of a coding mistake degrades from "data
breach" to "wrong rows within the right store."

It also gives us, for free: per-tenant backup and restore, per-tenant point-in-time
recovery, the ability to move a large merchant to their own hardware, and a clean
answer to "delete my data" — drop the database.

The costs are real and we accept them: more connections to manage (see the
connection pool below), migrations must run N times (see the migration runner),
and cross-tenant analytics needs a separate rollup path. See
[ADR-001](DECISION_LOG.md#adr-001).

## The two databases

**Master** (`retailos_master`) — the control plane. Tenants, admin users,
memberships, domains, plans, subscriptions, entitlements, provisioning jobs,
tenant database placement and credentials, webhook events, the platform audit
log and the tenant migration ledger. No shop data whatsoever.

**Tenant** (`tenant_<slug>`) — one per merchant. Customers, addresses, catalog,
inventory, carts, orders, payments, reviews, coupons, store settings, staff
profiles, notifications and that tenant's own audit log. No reference to any
other tenant.

Full model listings are in [DATABASE.md](DATABASE.md).

## Resolving the tenant

**The rule: tenant identity is established server-side. It is never read from a
request body or query string.**

There are exactly three trusted inputs, and each is verified.

### 1. Hostname (storefront)

`kickzone.ourdomain.in` → the tenant whose domain record matches. The middleware
in `core/tenant/tenant-resolver.middleware.ts` reads:

```ts
const host = req.header('x-forwarded-host')?.split(',')[0]?.trim() || req.header('host');
```

`X-Forwarded-Host` takes precedence because nginx sets it, and because Next.js
server-side rendering has no alternative: `Host` is a forbidden fetch header, so
`undici` silently drops any attempt to set it. This is not a trust escalation —
resolving a hostname grants _nothing_ on its own. It selects which public
storefront to render; every privileged action still requires a token and a
membership check.

Subdomain parsing is strict (`packages/config/src/domain.ts`):

- exactly one label below the platform domain — `evil.kickzone.ourdomain.in` is
  rejected, not treated as `kickzone`;
- reserved subdomains (`www`, `api`, `admin`, `app`, …) never resolve to a tenant;
- lookalike suffixes are rejected — `ourdomain.in.evil.com` does not match.

### 2. Verified membership (merchant console)

The console lives on `admin.ourdomain.in`, which is not a tenant hostname. The
tenant therefore comes from the caller's identity: a live row in
`tenant_users` linking that user to that tenant.

Membership is re-read on every request (with a 30-second cache), not taken from
the token, so revoking a staff member's access takes effect almost immediately
rather than when their token expires.

### 3. Tenant slug header (mobile)

A phone has no hostname to offer, so the app sends `X-Tenant-Slug: kickzone`.
This resolves a storefront exactly as a hostname would, and grants exactly as
much: nothing. A merchant token plus `X-Tenant-Slug` pointing at someone else's
shop is rejected, and there is a test for precisely that.

### What about `X-Tenant-Id`?

The console sends it to choose which of _its own_ stores to act on, for an
owner who runs several. `TenantGuard` treats it as a **hint**: it is
shape-checked as a UUID, then run through the same membership check as
everything else. It can only ever select among tenants the caller already
belongs to — it can never add one. A hint naming a store the caller does not
belong to is a 403, and the attempt is logged.

## TenantGuard

`apps/api/src/common/guards/tenant.guard.ts` enforces six rules:

1. A tenant resolved from the host is authoritative for storefront traffic.
2. A **customer** token is bound to one tenant. If its `tid` claim does not match
   the host's tenant, the request is refused — this is what stops a KickZone
   shopper's token from reading ABC Store's data by aiming it at a different
   hostname.
3. An **admin** token may act on a tenant only if a live `tenant_users` row says
   so. The token's own `tid` is not sufficient on its own.
4. `X-Tenant-Id` is a hint, validated by the same membership check.
5. A super admin may act cross-tenant, and every such request is logged.
6. `SUSPENDED` / `PROVISIONING` / `DELETING` / `DELETED` tenants are refused
   unless the route opts out with `@AllowInactiveTenant()`.

## Connections

`TenantConnectionManager` (`core/database/tenant-connection.manager.ts`) hands a
service the Prisma client for the current tenant.

- Clients are pooled in a bounded LRU (`TENANT_POOL_MAX_CONNECTIONS`).
- Idle clients are evicted after `TENANT_POOL_IDLE_TIMEOUT_MS`.
- A busy counter prevents evicting a client with a query in flight — without it,
  a long report could have its connection closed underneath it.
- Each client gets a small `connection_limit` (`TENANT_DB_CONNECTION_LIMIT`,
  default 5) so N active tenants cannot exhaust PostgreSQL's `max_connections`.

Credentials are read from the master registry on a pool miss and decrypted in
memory (AES-256-GCM). They are deliberately **not** cached in Redis.

### Placement vs. reachability

`tenant_databases` records where a tenant's database _is_: `cluster_id`, `host`,
`port`, `database_name`, `username`, `encrypted_password`.

How to _reach_ the local cluster depends on who is asking — the API in a
container reaches Postgres as `postgres:5432`, a developer on the host reaches
the same server as `localhost:5433`, and production reaches an RDS endpoint. So
for tenants placed on this deployment's own cluster (`TENANT_CLUSTER_ID`), the
configured `TENANT_DB_HOST`/`TENANT_DB_PORT` win; tenants on any _other_ cluster
keep the recorded address. That is what makes multi-cluster placement work while
keeping one seeded database usable from both inside and outside Docker.

## Provisioning a new tenant

Creating a tenant is a job, not a request handler — it creates a database, runs
migrations and seeds defaults, which is far too slow and too failure-prone for a
synchronous HTTP call. `POST /api/v1/platform/tenants` writes the tenant row and
enqueues a provisioning job; the worker runs the state machine:

```
CREATE_DATABASE → RUN_MIGRATIONS → SEED_DEFAULTS → CONFIGURE_BRANDING → ACTIVATE
```

Every step is idempotent and each completed step is recorded, so a retry after a
crash resumes rather than restarts. A distributed lock stops two workers
provisioning the same tenant at once. Full detail, including failure handling and
the migration runner, is in
[DATABASE_PROVISIONING.md](DATABASE_PROVISIONING.md).

## Deleting a tenant

The mirror image of provisioning, and the most destructive operation on the
platform. `DELETE /api/v1/platform/tenants/:id`, super admin only.

A tenant occupies three systems that cannot share a transaction — rows in the
master control plane, an entire PostgreSQL database of its own, and a prefix in
object storage. There is no way to remove all three atomically, so deletion is a
**resumable step machine** rather than a pretence at one:

```
REVOKE_ACCESS → PURGE_STORAGE → DROP_DATABASE → PURGE_MASTER_RECORDS → FINALISE
```

Each completed step is recorded in `tenant_deletion_jobs`. A failure stops the
pipeline with the step and the reason attached; calling the endpoint again
resumes from the first step that never finished. The property that matters when
a destructive operation half-fails is not that it cannot — it is that the
system is never left in an _unknown_ state.

The order carries the safety:

- **Access is revoked first.** Status goes to `DELETING`, sessions scoped to the
  tenant are killed, memberships are deactivated, the routing cache and the
  pooled connection are dropped. `TenantGuard` already refuses `DELETING`
  exactly as it refuses `DELETED`, so from this point the store cannot
  authenticate, be routed to, serve a request, or have a presigned URL minted
  for it — _even if every later step fails_.
- **Storage goes before the database**, because the database is what tells us
  which objects existed. Dropping it first would leave a bucket full of files
  with nothing left to say whose they were.
- **`FINALISE` verifies rather than assumes.** It re-checks that the tenant row,
  the registry row and the objects are actually gone, so "every step reported
  success" becomes "the tenant is not there any more". If anything survived, the
  job fails and says so instead of reporting a clean deletion.

Because the tenant's data is one physical database and nothing else is in it,
the products, orders, customers, categories, coupons, inventory, reviews,
addresses, notifications, store settings and template configuration all go at
once. There is no per-table deletion order to get right and no chance of missing
a table — which is the same property that makes database-per-tenant worth its
operational cost in the first place.

### Three gates

None of which the front end can satisfy on its own:

1. `@SuperAdminOnly()` on the controller.
2. `platform.tenants.delete`, a permission no merchant role holds — not even
   `OWNER`. Split from `platform.tenants.manage` because suspending a store and
   destroying it are not the same authority.
3. The store's own slug, in the body, checked against the tenant the server
   loaded. The id in the path is a uuid nobody reads; without a second, human
   identifier the only thing between "suspend the wrong store" and "destroy the
   wrong store" is one misclick.

### What is deliberately kept

- **Platform audit logs.** They are the platform's record _about_ a tenant, not
  the tenant's data — and they include the record of this deletion. Deleting
  them would erase the evidence that it happened. `TENANT_DELETED` and
  `TENANT_DELETION_FAILED` both outlive the tenant, because the audit table has
  no foreign key to `tenants`.
- **The deletion job**, for the same reason.
- **Users who belong to another store.** A person may work for two merchants.
  Their membership of this tenant goes; their account does not. Only accounts
  left with no store at all are removed, and never a super admin.
- **Everything shared.** Plans, feature definitions, other tenants' anything.

### Testing it

`apps/api/test/tenant-deletion.e2e-spec.ts` provisions a throwaway tenant, fills
it with data across all three systems, deletes it, and then asserts as much
about what _survived_ as about what went — the seeded tenants sit alongside it
throughout and must come out untouched. `tenant-deletion.service.spec.ts` covers
the partial-failure and resume behaviour against fakes.

## Testing the guarantee

`apps/api/test/tenant-isolation.e2e-spec.ts` boots the real app against real
databases and attacks the guarantee from five directions plus a block of
deliberate injection attempts. Run it with `pnpm test:e2e`. See
[TESTING.md](TESTING.md) and [SECURITY.md](SECURITY.md).
