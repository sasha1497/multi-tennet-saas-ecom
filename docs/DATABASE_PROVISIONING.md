# Tenant provisioning

Creating a merchant means creating a database, a role, a schema and a set of
defaults. That is far too slow and too failure-prone for a synchronous HTTP
handler, so it runs as a job.

```
POST /api/v1/platform/tenants
        │
        ├─ writes the Tenant row (status PROVISIONING)
        ├─ writes the Domain row (<slug>.ourdomain.in)
        └─ enqueues a provisioning job
                │
                ▼
        worker: provisioning processor
                │
   CREATE_DATABASE → RUN_MIGRATIONS → SEED_DEFAULTS → CONFIGURE_BRANDING → ACTIVATE
                │
                └─ tenant status becomes ACTIVE; the storefront goes live
```

The merchant sees a "setting up your store" screen and is redirected when the
tenant activates. Provisioning a tenant on a warm machine takes a few seconds.

## Idempotency

The requirement is blunt: provisioning must be idempotent, and retries must not
create duplicate tenants or corrupted databases. Three mechanisms deliver that.

**1. Recorded steps.** Each finished step is appended to
`tenant_provisioning_jobs.completed_steps`. A retry skips what is already done
and resumes at the first step not recorded — a crash between `RUN_MIGRATIONS`
and `SEED_DEFAULTS` does not re-run migrations.

**2. Idempotent primitives.** Even if a step *does* run twice, nothing breaks:
`CREATE DATABASE` and `CREATE ROLE` are existence-checked, the migration runner
consults its own ledger, and seeding uses upserts.

**3. A distributed lock.** Only one worker provisions a given tenant at a time,
so two queued retries cannot interleave.

**Failures are left in place, never rolled back.** A half-created database can be
resumed; dropping it loses whatever did succeed and risks destroying data if the
failure was spurious (a network blip, a transient connection limit). The tenant
stays `PROVISIONING` with the error recorded, and the platform admin can retry
from `POST /platform/tenants/:id/provision`.

## The steps

### CREATE_DATABASE

- Generates a strong random password.
- Creates a least-privilege role `tu_<slug>` and a database `tenant_<slug>`
  owned appropriately.
- Creates the `pg_trgm` and `unaccent` extensions.
- Grants schema privileges, and sets `ALTER DEFAULT PRIVILEGES` so tables
  created by later migrations are granted to the tenant role automatically.
- Encrypts the password with AES-256-GCM and writes the placement row in
  `tenant_databases` (`cluster_id`, `host`, `port`, `database_name`,
  `username`, `encrypted_password`).

Re-running reuses the existing registry row and rotates the password.

Every identifier that reaches DDL — database name, role name — is validated
against a strict pattern and quoted. No user-supplied string is ever
interpolated into a DDL statement.

### RUN_MIGRATIONS

Applies every versioned migration in `database/tenant/migrations/` (see the
runner below), then re-grants privileges on the newly created tables.

### SEED_DEFAULTS

Writes the tenant's baseline data: the singleton `store_settings` row and a
starter category set, so the merchant's first product form is not empty. All
upserts.

### CONFIGURE_BRANDING

Applies the default theme (colours, radius, font) and the storefront hostname.

### ACTIVATE

Flips the tenant to `ACTIVE`, invalidates the tenant-resolution cache so the
storefront resolves immediately, and writes an audit entry.

## The migration runner

`database/src/migrations.ts` + `apps/api/src/core/database/tenant-migration.runner.ts`.

Prisma Migrate is built for one database with one shadow database. We have N
databases that must converge on the same schema, provisioned at different times
and possibly mid-flight during a deploy. So tenant migrations are versioned SQL
directories applied by our own runner. See
[ADR-006](DECISION_LOG.md#adr-006).

What the runner does:

1. **Takes a PostgreSQL advisory lock** keyed on the tenant database. Two API
   instances rolling out simultaneously cannot apply the same migration twice.
2. **Reads the ledger** — the tenant's own `schema_migrations` table — to find
   what has already been applied.
3. **Verifies checksums.** If a previously applied migration's SQL has changed
   on disk, the run aborts. Editing applied migrations is how schemas silently
   diverge across tenants; the runner refuses rather than guess.
4. **Splits the file into statements** with a hand-written SQL splitter that
   understands line and block comments, single and double quotes, escapes and
   dollar-quoted bodies — so a `$$ … $$` function containing a semicolon is not
   torn in half.
5. **Applies each migration in its own transaction**, so a failure leaves the
   tenant at a clean, known version. Statements that PostgreSQL forbids inside a
   transaction (`CREATE INDEX CONCURRENTLY`) are detected and run in autocommit.
6. **Records the result** in the tenant's `schema_migrations` and mirrors it to
   `tenant_migration_records` in the master database, so the platform can see
   every tenant's schema version without connecting to each one.

The SQL itself is *generated* from `database/tenant/schema.prisma` with
`prisma migrate diff`, so the schema stays the single source of truth and we
still get reviewable, checksummed SQL.

### Running migrations across tenants

```bash
pnpm db:tenant:migrate
```

Applies pending migrations to every tenant database, one at a time, reporting
per-tenant results and continuing past a failure so one bad tenant does not
block the rest. A single tenant can be migrated from the platform admin
(`POST /platform/tenants/:id/migrate`).

## Deprovisioning

Dropping a tenant database is guarded behind an explicit confirmation and is
never reachable from an ordinary API call. The intended flow is
`SUSPENDED → DELETING → DELETED`, with the database retained through a
configurable grace period so an accidental deletion is recoverable — and then
dropped, which is what makes "delete my data" a true statement rather than a
soft flag.

## Observability

- `tenant_provisioning_jobs` records every attempt, its step progress, its error
  and its timing. Visible in the platform admin.
- The provisioning queue's depth and failure count are exposed at
  `GET /platform/system/queues`.
- Every step logs with the tenant id and the job id.
