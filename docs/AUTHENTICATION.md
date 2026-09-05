# Authentication and authorization

There are two distinct populations, and they never share a token.

- **Admin audience** — platform staff and merchant staff. Rows in the master
  database's `users` table, linked to tenants through `tenant_users`.
- **Customer audience** — shoppers. Rows in a *tenant's* `customers` table. A
  customer of KickZone exists only in `tenant_kickzone`.

A token carries its audience, and the guards refuse to honour one on the other's
routes. A shopper token on `/merchant/*` is a 403, and so is a merchant token on
`/customers/me`.

Keeping shoppers out of the master database is deliberate: the platform never
maintains a cross-tenant shopper identity, so no merchant can learn that a
customer also shops with a competitor.

## Tokens

**Access token** — a short-lived JWT, 15 minutes by default
(`JWT_ACCESS_TTL`). Claims include the subject, the audience, the role, the
resolved permissions and — for customers — `tid`, the tenant the token is bound
to. It is a bearer token; the API never trusts anything else in the request to
establish identity.

**Refresh token** — 30 days by default (`JWT_REFRESH_TTL`), stored **hashed** in
`sessions` (admins) or `customer_sessions` (customers). A stolen database dump
does not yield usable refresh tokens.

### Rotation with reuse detection

Every refresh issues a new refresh token and supersedes the old one. If a
*superseded* token is ever presented again, the entire session family is
revoked immediately.

The reasoning: a superseded refresh token being replayed means either the
legitimate client retried (harmless — it will simply re-authenticate) or someone
stole the token and is racing the real user. There is no way to tell these apart,
so the safe response is to end the family and make everyone sign in again. This
turns token theft from indefinite access into a single-use window that
self-reports.

Both session tables carry a `session_id`, so a single device can be signed out
without ending the user's other sessions.

## Password hashing

`scrypt` from Node's own `crypto` module, with a self-describing stored format:

```
scrypt$N=16384,r=8,p=1$<salt-b64>$<hash-b64>
```

Parameters live in the hash, so they can be raised later and old hashes still
verify (and can be transparently upgraded on next login).

scrypt was chosen over bcrypt and argon2 specifically to avoid a native build
dependency. `bcrypt` and `argon2` are compiled addons: they break on Node
upgrades, need build toolchains in Docker images, and complicate ARM/x86 builds.
`crypto.scrypt` is memory-hard, in the standard library, and needs none of that.
See [ADR-007](DECISION_LOG.md#adr-007).

Verification uses a constant-time comparison, and a malformed stored hash
returns `false` rather than throwing.

## Guard pipeline

Registered globally in `apps/api/src/app.module.ts`. **Order is load-bearing.**

```
RateLimitGuard → JwtAuthGuard → TenantGuard → PermissionsGuard → FeatureGuard
```

| Guard | Responsibility |
| --- | --- |
| `RateLimitGuard` | Per-IP and per-route counters in Redis; stricter on auth routes |
| `JwtAuthGuard` | Verifies the bearer token. **Deny by default** — a route is private unless explicitly marked `@Public()` |
| `TenantGuard` | Establishes *and verifies* the tenant (see [TENANCY.md](TENANCY.md)) |
| `PermissionsGuard` | Checks the route's required `resource.action` against the caller's permissions |
| `FeatureGuard` | Checks the tenant's plan entitlements |

Deny-by-default matters more than it sounds: with an allow-by-default guard, a
new controller written on a Friday is public until someone remembers to protect
it. Here, forgetting the decorator makes the route inaccessible — a loud,
harmless failure instead of a silent leak.

## Roles

| Role | Who | Scope |
| --- | --- | --- |
| `SUPER_ADMIN` | Platform operator | Every permission, cross-tenant, audited |
| `OWNER` | The merchant | Every tenant-scoped permission for their own store |
| `MANAGER` | Senior staff | Everything operational except staff management, store settings and subscription |
| `STAFF` | Shop floor | Read the catalog, update inventory, read and progress orders |
| `CUSTOMER` | Shopper | Their own cart, orders, addresses, reviews |

Roles are resolved to a permission set at token issue and re-checked against the
live membership on every request, so a demotion takes effect within the
membership cache window (30 seconds) rather than at token expiry.

## Permissions

Granular `resource.action` strings, defined once in
`packages/types/src/permissions.ts` and shared by the API and every client — so
the console hides a button for exactly the same reason the API would refuse the
call.

```
products.read      products.create   products.update    products.delete
categories.read    categories.manage brands.read        brands.manage
inventory.read     inventory.update
orders.read        orders.update     orders.cancel      orders.refund
customers.read     customers.update
coupons.read       coupons.manage
reviews.read       reviews.moderate
reports.read
store.manage       store.design
staff.read         staff.manage
subscription.read  subscription.manage
files.upload
```

Platform-only permissions are a separate namespace and are deliberately absent
from every merchant role — asserted by a unit test, so no future edit can quietly
grant `platform.*` to an OWNER.

`ASSIGNABLE_STAFF_ROLES` excludes `OWNER` and `SUPER_ADMIN`: an owner can invite
managers and staff, but cannot mint another owner or escalate anyone to platform
level from the console.

## Endpoints

```
POST /auth/register            create a merchant account + tenant
POST /auth/login               admin audience
GET  /auth/me                  current admin principal
POST /auth/switch-tenant       change active tenant (must be a member)
GET  /auth/check-slug          subdomain availability

POST /auth/customer/register   shopper, on a tenant hostname
POST /auth/customer/login      shopper
GET  /auth/customer/me         current shopper

POST /auth/refresh             rotate the refresh token
POST /auth/logout              revoke the session
POST /auth/change-password     revokes other sessions
```

## Guest carts

A shopper can fill a cart before signing in. The API issues a signed **guest
token** (`X-Guest-Token`), which identifies a cart and nothing else — it grants
no read access to any customer data. On login, `POST /cart/merge` folds the
guest cart into the customer's cart. The token is signed, so a guessed or
tampered value is rejected rather than pointed at someone else's cart.

## What is never exposed

Database credentials, internal tenant database names, hosts and ports, secret
keys and private storage credentials never appear in any API response — asserted
by the isolation test suite, not just by convention. Stack traces are never
returned in production; errors carry a stable code and a request id instead.
