# Security

The product's core promise is that a request to `kickzone.ourdomain.in` can
never return ABC Store's data. Everything below serves that, or the integrity of
money and stock.

## Threat model

| Threat | Control |
| --- | --- |
| Tenant A reads or writes tenant B's data | Separate physical databases; connection-level isolation; verified tenant resolution; an automated isolation suite |
| A client forges its tenant identity | Tenant is derived server-side only; body/query `tenant_id` ignored; header hints revalidated against membership |
| A stolen shopper token used on another store | Customer tokens are bound to one tenant; the guard rejects a mismatch with the host |
| A revoked staff member keeps working | Membership re-read per request (30s cache), not trusted from the token |
| Stolen refresh token | Tokens stored hashed; rotation with reuse detection revokes the family |
| Database dump discloses tenant credentials | AES-256-GCM at rest with a versioned payload |
| Password database disclosure | scrypt with per-password salts |
| Payment tampering / replay | Signature verification, webhook verification, event deduplication, idempotency keys |
| Overselling under concurrency | Single conditional UPDATE + CHECK constraints |
| Order history rewritten by a catalog edit | Order lines are immutable snapshots |
| SQL injection | Parameterised queries throughout; validated + quoted identifiers in DDL |
| Enumeration and brute force | Redis rate limiting, stricter on auth routes; uniform error messages |
| Oversized payload DoS | Body-size cap ahead of parsing; upload limits and MIME allow-list |
| Information disclosure via errors | Stable error codes, no stack traces in production |

## Tenant isolation

Four layers, each independently sufficient to stop the common cases and jointly
sufficient to stop the uncommon ones.

**1. Physical.** Each tenant is a separate PostgreSQL database with its own
least-privilege role. A query that forgets a filter returns that tenant's own
rows, because the connection cannot see any others.

**2. Resolution.** Tenant identity comes from the hostname, a verified
membership, or a slug header that grants nothing — never from a request body or
query string. Subdomain parsing is strict about nesting, reserved names and
lookalike suffixes.

**3. Authorization.** `TenantGuard` verifies the caller against the resolved
tenant before any handler runs; `PermissionsGuard` then checks the specific
action. Deny-by-default at the authentication layer.

**4. Tested.** `apps/api/test/tenant-isolation.e2e-spec.ts` boots the real app
against real databases and attacks all of the above. The file opens by saying
what it is for:

> The single most important test file in this repository. The platform's core
> promise is that a request to `kickzone.ourdomain.in` can never, under any
> circumstance, return ABC Store's data. Each test below tries to defeat one
> layer. A failure here is a data breach, not a bug.

34 tests across five layers, including an explicit block of malicious
`tenant_id` injection attempts — through the request body, the query string, and
headers carrying SQL-injection-shaped values. Run with `pnpm test:e2e`.

## Secrets

- **Tenant database passwords** are encrypted with AES-256-GCM before they touch
  the master database. The stored payload is versioned — `v1.<iv>.<tag>.<ciphertext>` —
  so the scheme can be rotated without guessing at old records. The key comes
  from `CREDENTIALS_ENCRYPTION_KEY` and must be 32 bytes; anything else is
  rejected at boot rather than silently truncated.
- **Passwords** are scrypt-hashed with per-password salts.
- **Refresh tokens** are stored hashed.
- **Guest tokens** are signed and verified in constant time.
- **Nothing is committed.** `.env` is gitignored; `.env.example` contains only
  obvious placeholders (`dev_access_secret_change_me_…`) which the config layer
  rejects in production.

Never exposed to any client: database credentials, tenant database names, hosts
and ports, secret keys, private storage credentials. The isolation suite asserts
this rather than trusting it.

## Transport and headers

`helmet` sets the standard protections; HSTS is enabled in production only. The
API serves JSON exclusively, so CSP applies only to the Swagger UI.

**CORS** allows the platform domain and any of its subdomains. A static
allow-list is impossible — the set of origins grows every time a merchant signs
up — so the check is a suffix match against the configured platform domain and
nothing else. `ourdomain.in.evil.com` does not match, and there is a test for it.
In development only, a bare LAN IP is also allowed so a physical phone can reach
the API.

`trust proxy` is set to 1 so `req.ip` is the real client behind nginx or an ALB,
which is what makes rate limiting meaningful.

## Input handling

Every request body, query and param is validated by a Zod schema from
`@retailos/validation` — the same schemas the clients use, so the API and the UI
cannot disagree about what is valid. Unknown keys are stripped rather than
passed through, which is what makes a `tenantId` smuggled into a request body a
no-op rather than a question of whether some handler happens to read it.

Identifiers that reach the database as UUIDs are shape-checked first, so a
hand-crafted id produces a clean 400 rather than a driver error surfacing as a
500.

Uploads are capped by size and restricted by MIME type; files are stored under
generated keys, never under a client-supplied path.

## Payments

- Provider signatures are verified on every callback; a forged signature is
  rejected, and the isolation/smoke suites test exactly that.
- Webhooks are verified with the provider's webhook secret over the **raw body**,
  which is why the app is bootstrapped with `rawBody: true`.
- Provider events are deduplicated by event id in `webhook_events`, so a
  redelivered webhook cannot double-credit an order.
- Checkout accepts an `Idempotency-Key`; a repeat with the same key returns the
  original order instead of placing a second one.
- The gateway call happens **outside** the database transaction, so a slow
  provider cannot hold locks on inventory rows.

## Data integrity

- Money is integer minor units end to end. `orders_total_consistent` enforces
  that totals add up, with an explicit branch for tax-inclusive versus
  tax-exclusive pricing.
- Stock cannot go negative or over-reserve: a single conditional UPDATE does the
  reservation, and CHECK constraints backstop it.
- Order status changes are validated against an explicit transition map — no
  PENDING→DELIVERED jump, no reviving a refunded order, no self-transitions.
- Order lines are immutable snapshots of what was actually bought.

## Auditing

`platform_audit_logs` (master) records platform-level actions: tenant creation,
status changes, provisioning, plan and entitlement changes, and every
cross-tenant super-admin access. `tenant_audit_logs` (per tenant) records
merchant-level actions. Both record actor, action, target and time.

## Operational practices

- Run the API as a non-root user — the production image does.
- Do not publish database ports in production; `docker-compose.prod.yml` does
  not.
- Rotate `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` and
  `CREDENTIALS_ENCRYPTION_KEY` on any suspicion of exposure. Rotating the
  encryption key requires re-encrypting `tenant_databases.encrypted_password`;
  the versioned payload prefix is what makes that safe to do incrementally.
- Keep `SWAGGER_ENABLED=false` in production unless the API is deliberately
  public.

## Reporting a vulnerability

Contact the repository owner directly. Please do not open a public issue.
