# Database

Two schemas, two generated Prisma clients, two migration mechanisms.

- **Master** — `database/master/schema.prisma`, one database
  (`retailos_master`), standard Prisma Migrate.
- **Tenant** — `database/tenant/schema.prisma`, N databases (`tenant_<slug>`),
  versioned SQL applied by our own runner.

PostgreSQL 16 is the primary engine for both.

## Master schema (control plane)

15 models. No shop data.

| Model | Purpose |
| --- | --- |
| `User` | Platform and merchant staff accounts (not shoppers) |
| `Session` | Refresh-token families with rotation and reuse detection |
| `VerificationToken` | Email verification and password reset |
| `Tenant` | A merchant: slug, name, status, plan |
| `TenantUser` | Membership: which user may act on which tenant, in what role |
| `Domain` | Hostnames mapped to tenants (subdomain and custom) |
| `TenantDatabase` | Placement + encrypted credentials for a tenant's database |
| `TenantProvisioningJob` | Provisioning state machine progress |
| `Plan` | Subscription plans and their limits |
| `Subscription` | A tenant's current plan and billing period |
| `FeatureEntitlement` | Per-tenant feature flags and quota overrides |
| `PaymentRoute` | Per-tenant payment provider configuration |
| `WebhookEvent` | Received provider events, for deduplication |
| `PlatformAuditLog` | Who did what across the platform |
| `TenantMigrationRecord` | Mirrored ledger of tenant migrations applied |

Shoppers are deliberately **not** in the master database. A customer of
KickZone is a row in `tenant_kickzone.customers` and nowhere else — the platform
does not maintain a cross-tenant identity for shoppers, so one merchant cannot
learn that a customer also shops elsewhere.

## Tenant schema (one per merchant)

26 models.

| Group | Models |
| --- | --- |
| Customers | `Customer`, `CustomerSession`, `Address`, `WishlistItem` |
| Catalog | `Category`, `Brand`, `Product`, `ProductImage`, `ProductVariant` |
| Inventory | `Inventory`, `InventoryTransaction` |
| Commerce | `Cart`, `CartItem`, `Coupon`, `CouponRedemption` |
| Orders | `Order`, `OrderItem`, `OrderStatusHistory`, `Payment` |
| Content | `Review`, `StoreSettings` |
| Ops | `StaffProfile`, `Notification`, `PushToken`, `TenantAuditLog`, `SchemaMigration` |

### Order lines are snapshots

`OrderItem` stores the product name, variant name, SKU, image, unit price, MRP,
tax rate and computed amounts **as they were at checkout**. It references the
product and variant ids for convenience, but reads never join back to the live
catalog for display.

This is not denormalisation for speed — it is correctness. A merchant renames a
product, changes its price or deletes a variant six months later; the invoice
from last March must still say what the customer actually bought and paid. An
order that mutates when the catalog changes is a legal and accounting problem,
not just a UX one.

### Money

Every amount is a non-negative **integer in the currency's minor unit** —
paise for INR. There are no `Float`, `Double` or `Decimal` price columns, so
there is no rounding drift and no ambiguity about what "12.345" meant.

`BigInt` appears only for lifetime aggregates (a customer's total spend), with a
JSON serialisation bridge installed at boot because `JSON.stringify` throws on
`BigInt`.

### Inventory

`Inventory` holds `quantity`, `reserved` and a `version` column.

- **Available** stock is `quantity - reserved`.
- Reservation is a single conditional statement —
  `UPDATE … SET reserved = reserved + n WHERE quantity - reserved >= n` — so two
  concurrent checkouts cannot both succeed on the last unit. The row is either
  updated or it is not; there is no read-then-write window.
- A CHECK constraint (`inventory_reserved_within_quantity`) is the backstop: even
  a buggy future code path cannot leave the table in an impossible state.
- Manual adjustments from the console use the `version` column for optimistic
  concurrency, so two staff editing the same stock level get a 409 rather than a
  silent overwrite.

Every change writes an `InventoryTransaction` row, so stock is auditable.

## Constraints

`database/tenant/migrations/0002_constraints_and_search/migration.sql` is where
the invariants live. The database enforces them because application code is not
the only thing that ever writes to a database.

**Order totals must add up:**

```sql
ALTER TABLE orders
  ADD CONSTRAINT orders_total_consistent
  CHECK (
    total_amount = subtotal - discount_amount + shipping_amount
                 + (CASE WHEN tax_inclusive THEN 0 ELSE tax_amount END)
  );
```

The `tax_inclusive` branch is essential. Indian retail quotes tax-inclusive
prices: the shelf price of ₹1,180 already contains ₹180 of GST. Adding the tax
again would double-count it. Exclusive pricing adds tax on top. One column on
the order records which convention was in force *at the time*, so the constraint
stays true even if the store later changes its setting.

Other constraints:

| Constraint | Guarantees |
| --- | --- |
| `inventory_reserved_within_quantity` | Reserved never exceeds stock; neither goes negative |
| `product_variants_mrp_gte_price` | A "discount" is never an increase |
| `customers_contact_present` | A customer has an email or a phone |
| `addresses_one_default_per_customer` | Partial unique index: at most one default address |
| `product_images_one_primary` | Partial unique index: at most one primary image |
| `carts_one_per_customer` | Partial unique index: one active cart |

## Indexes

Beyond the obvious foreign keys and lookup columns:

- **Trigram GIN indexes** (`pg_trgm`) on product name, description and SKU, so
  storefront search tolerates typos and partial words without a separate search
  service.
- **Partial indexes** on `orders(status)` for the open-orders view, which is the
  console's most frequent query and only ever cares about a few statuses.
- **Composite indexes** matching the actual sort orders used by list endpoints,
  so pagination does not degrade to a sort of the whole table.

`pg_trgm` and `unaccent` are created by
`infrastructure/docker/postgres/init/01-init.sh` and by the provisioning step
for each new tenant database.

## Migrations

**Master** uses Prisma Migrate:

```bash
pnpm db:migrate           # dev: create and apply
pnpm db:migrate:deploy    # prod: apply pending
```

**Tenant** migrations are versioned SQL directories applied by a runtime runner
because there are N databases and Prisma Migrate is built for one. The runner
takes a PostgreSQL advisory lock, verifies checksums, applies each migration in
its own transaction, and records it in the tenant's `schema_migrations` table
plus a mirrored ledger in the master database. Detail and rationale:
[DATABASE_PROVISIONING.md](DATABASE_PROVISIONING.md) and
[ADR-006](DECISION_LOG.md#adr-006).

```bash
pnpm db:tenant:migrate    # apply to every tenant database
```

## Privileges

Migrations run as the admin role, which means tables are *owned* by the admin
role. The per-tenant least-privilege role (`tu_<slug>`) that the application
actually connects with therefore has no rights on them by default — this
manifested during development as `permission denied for table store_settings`.

`TenantDdlService.grantTenantPrivileges()` runs after every migration pass and
grants the tenant role rights on all tables and sequences;
`grantSchemaPrivileges()` additionally sets `ALTER DEFAULT PRIVILEGES` so tables
created by *future* migrations are granted automatically.

Every identifier used in DDL is validated against a strict pattern and quoted.
No user-supplied string is ever interpolated into DDL.

## Why MySQL is in the stack

MySQL 8.4 runs as a **secondary compatibility service**. It holds no
authoritative data and the application does not read from it on any request
path.

It exists because local Indian retail software — the billing and inventory
packages merchants are migrating *from* — is overwhelmingly MySQL-based. The
service gives us a place to land a legacy import, mirror a tenant directory for
an on-premise tool that can only speak MySQL, and prove the connection in CI.
`infrastructure/docker/mysql/init/01-init.sql` creates
`legacy_product_import`, `tenant_directory_mirror` and `compat_healthcheck`.

PostgreSQL is the primary engine for both the master and tenant databases
because we depend on things MySQL does not offer as well: partial unique
indexes, `pg_trgm` search, advisory locks for the migration runner, rich CHECK
constraints, and `CREATE DATABASE` ergonomics for per-tenant provisioning. See
[ADR-002](DECISION_LOG.md#adr-002).

In production, MySQL sits behind a Compose profile and is not started by
default.
