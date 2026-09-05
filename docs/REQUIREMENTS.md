# Requirements

What the system is required to do, and how each requirement is met. This is the
scope the build was measured against.

## Context

Local retailers — a shoe shop, a stationery store, a mobile-phone dealer — need
an online storefront without running software themselves. RetailOS is one
platform hosting many such shops, each with its own branded storefront on its
own subdomain, its own admin console, and **its own database**.

Three surfaces over one API: a customer storefront (web), a merchant and
platform console (web), and a customer mobile app.

## Functional requirements

### Multi-tenancy

| # | Requirement | Status |
| --- | --- | --- |
| T1 | Each merchant has an isolated database | ✅ `tenant_<slug>`, own role |
| T2 | A master database holds the control plane | ✅ 15 models, no shop data |
| T3 | Tenants resolve from subdomain | ✅ Strict parsing, reserved names |
| T4 | Tenant identity is established server-side | ✅ Never from body or query |
| T5 | Tenant provisioning is automated | ✅ Queued 5-step state machine |
| T6 | Provisioning is idempotent and resumable | ✅ Recorded steps, lock, idempotent primitives |
| T7 | Tenant migrations run across all databases | ✅ Runner with advisory lock and checksums |
| T8 | Tenants can be suspended and deleted | ✅ Status machine; guarded deprovision |

### Customer storefront

| # | Requirement | Status |
| --- | --- | --- |
| C1 | Browse catalog by category and brand | ✅ |
| C2 | Search with typo tolerance | ✅ `pg_trgm` GIN |
| C3 | Product detail with variants, images, reviews | ✅ |
| C4 | Cart, including before signing in | ✅ Signed guest tokens + merge |
| C5 | Coupons | ✅ Percentage and fixed, caps, minimums |
| C6 | Address book | ✅ One default enforced by index |
| C7 | Checkout — online payment and COD | ✅ Idempotent |
| C8 | Order history and tracking | ✅ |
| C9 | Cancel an order while it is still cancellable | ✅ PENDING/CONFIRMED/PROCESSING |
| C10 | Wishlist | ✅ |
| C11 | Reviews | ✅ Merchant-moderated |
| C12 | Per-merchant branding | ✅ Server-rendered theme |

### Merchant console

| # | Requirement | Status |
| --- | --- | --- |
| M1 | Dashboard with revenue and orders | ✅ Charts |
| M2 | Product CRUD with variants and images | ✅ |
| M3 | Categories and brands | ✅ |
| M4 | Inventory with adjustments and thresholds | ✅ Optimistic locking, audit trail |
| M5 | Order queue with a status workflow | ✅ Validated transitions |
| M6 | Customer list and detail | ✅ |
| M7 | Coupon management | ✅ |
| M8 | Review moderation | ✅ |
| M9 | Sales, customer and inventory reports | ✅ |
| M10 | Store profile and branding | ✅ |
| M11 | Staff with roles | ✅ Owner cannot mint another owner |
| M12 | Image upload | ✅ S3-compatible, MIME allow-list |

### Platform admin

| # | Requirement | Status |
| --- | --- | --- |
| P1 | Tenant directory and detail | ✅ |
| P2 | Create and provision tenants | ✅ |
| P3 | Suspend and reactivate | ✅ |
| P4 | Plans and entitlements | ✅ |
| P5 | Per-tenant migration | ✅ |
| P6 | Audit log | ✅ |
| P7 | Service health and queue depth | ✅ |

### Mobile

| # | Requirement | Status |
| --- | --- | --- |
| A1 | Browse, search, product detail | ✅ |
| A2 | Cart and checkout | ✅ |
| A3 | Order history | ✅ |
| A4 | Store selection without a hostname | ✅ Discover / QR scan → `X-Tenant-Slug` |
| A5 | Per-merchant theming | ✅ |

## Non-functional requirements

### Security

| # | Requirement | Status |
| --- | --- | --- |
| S1 | Tenant isolation is a critical guarantee | ✅ Four layers ([SECURITY.md](SECURITY.md)) |
| S2 | Automated cross-tenant isolation tests | ✅ 34 tests, 5 layers + injection block |
| S3 | Tenant id never trusted from body/query/arbitrary headers | ✅ Verified header hints only |
| S4 | Credentials never stored as plain text | ✅ AES-256-GCM, versioned payload |
| S5 | Never expose DB credentials, internal DB info, secrets, storage creds | ✅ Asserted by tests |
| S6 | No stack traces in production | ✅ Stable error codes + request id |
| S7 | Secrets never committed | ✅ `.env` ignored; example holds placeholders |
| S8 | Short-lived access tokens + refresh rotation | ✅ With reuse detection |
| S9 | Granular RBAC | ✅ 28 `resource.action` permissions |
| S10 | Rate limiting | ✅ Redis, stricter on auth |
| S11 | Payment signature and webhook verification | ✅ Constant-time, fails closed |

### Data integrity

| # | Requirement | Status |
| --- | --- | --- |
| D1 | Money is exact | ✅ Integer minor units end to end |
| D2 | Order lines are immutable snapshots | ✅ Catalog edits never rewrite history |
| D3 | Stock cannot go negative or oversell | ✅ Conditional UPDATE + CHECK constraints |
| D4 | Concurrent stock edits are safe | ✅ Optimistic concurrency, 409 on conflict |
| D5 | Order totals always add up | ✅ DB CHECK with a tax-inclusive branch |
| D6 | Duplicate checkout is impossible | ✅ Idempotency keys |
| D7 | Duplicate webhooks are impossible | ✅ Event deduplication |

### Engineering

| # | Requirement | Status |
| --- | --- | --- |
| E1 | Monorepo, pnpm + Turborepo | ✅ 10 packages |
| E2 | One API, no duplicated business logic | ✅ Shared types, schemas, client |
| E3 | Docker Compose: base, dev, prod | ✅ Healthchecks, restart policies, volumes |
| E4 | MySQL present in the stack | ✅ Secondary compatibility service ([ADR-002](DECISION_LOG.md#adr-002)) |
| E5 | Reverse proxy with wildcard subdomains | ✅ nginx |
| E6 | Structured logging and metrics | ✅ pino + Prometheus |
| E7 | Background workers | ✅ BullMQ: provisioning, notifications, maintenance |
| E8 | CI | ✅ Lint, typecheck, unit, isolation e2e, image builds |
| E9 | Documentation | ✅ 27 documents + README |

## Assumptions

Stated because they shaped the design:

- **Indian retail.** INR, paise, GST, tax-inclusive shelf pricing by default,
  COD as a first-class payment method, Razorpay as the default gateway.
- **Small catalogs per merchant.** Hundreds to low thousands of SKUs, which is
  why `pg_trgm` is enough and no search service is needed.
- **Bursty, skewed traffic.** A few active shops at a time, which is what makes
  a bounded connection pool with idle eviction the right shape.
- **One region.** No multi-region replication or data residency requirements.

## Out of scope

Deliberately, for the MVP:

- Merchant subscription billing (modelled, not charged)
- Cross-tenant analytics warehouse
- Multi-warehouse or multi-location inventory
- Shipping-carrier integration and label printing
- Marketing automation, abandoned-cart flows, unsubscribe management
- Front-end component tests and load testing

See [FUTURE_ROADMAP.md](FUTURE_ROADMAP.md) for what comes next and why.
