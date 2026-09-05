# Backup and recovery

## What makes this different

Database-per-tenant changes the shape of both backup and restore. One merchant
who deleted their catalog by mistake can be restored to yesterday **without
touching anyone else**. That is the practical payoff of the architecture — but
it only exists if the backups are per tenant too, so they are.

## What to back up

| Asset | Why | How |
| --- | --- | --- |
| Master database | Tenants, users, memberships, plans, **encrypted tenant credentials** | `pg_dump -Fc` |
| Every tenant database | All shop data | `pg_dump -Fc`, one file each |
| Roles and grants | A restored database with no role cannot be connected to | `pg_dumpall --globals-only` |
| `CREDENTIALS_ENCRYPTION_KEY` | Decrypts every tenant DB password | Secrets manager, **not** the backup bucket |
| Uploaded media | Product images | Object-storage versioning or lifecycle copy |

**The encryption key is the one people forget.** Backups of the master database
contain tenant passwords encrypted with it. Restore the databases without the
key and you have every tenant's data and no way for the application to reach
it. Store it separately, and store it somewhere a lost server does not take with
it.

## Running a backup

```bash
./infrastructure/scripts/backup.sh [destination-dir]
```

It dumps globals, the master database and every `tenant_*` database, writes a
`MANIFEST` (timestamp, database count, PostgreSQL version, git SHA), copies
off-site via rclone when `BACKUP_REMOTE` is set, and prunes local copies past
`BACKUP_RETAIN_DAYS`.

Cron:

```
0 2 * * * /opt/retailos/infrastructure/scripts/backup.sh >> /var/log/retailos-backup.log 2>&1
```

A backup on the same disk as the database is not a backup. Set `BACKUP_REMOTE`.

## Restoring

```bash
# One tenant — the common case
./infrastructure/scripts/restore.sh /var/backups/retailos/<stamp> tenant_kickzone

# Everything
./infrastructure/scripts/restore.sh /var/backups/retailos/<stamp>
```

The script drops and recreates each target database and asks for typed
confirmation first. Afterwards:

```bash
pnpm db:tenant:migrate                 # re-applies grants, plus any pending SQL
docker compose restart api worker      # drop cached connections to the old DBs
curl -s -H 'Host: kickzone.localhost' http://localhost/api/v1/store | jq -r '.data.store.storeName'
```

Both scripts have been exercised against the development stack: a single-tenant
restore completed with the other two tenants untouched and all three storefronts
serving afterwards.

## Recovery scenarios

**A merchant deleted their catalog.** Restore only their database from the last
good backup. Every other tenant keeps trading. This is a ten-minute operation,
not an outage.

**The master database is lost, tenant databases survive.** Restore the master
from backup. Tenant databases are re-registered from the restored
`tenant_databases` rows; if the master is older than a recently provisioned
tenant, that tenant's row is missing — re-register it from the platform admin
and re-run provisioning, which is idempotent and will find the database already
present.

**A tenant database is lost, the master survives.** Restore that one database.
If no backup exists (a tenant provisioned since the last backup), re-run
provisioning: it recreates the database, applies migrations and seeds defaults.
Orders placed in between are gone — which is why the backup interval is the real
recovery-point objective.

**The whole server is lost.** Provision a new machine, restore globals, restore
the master, restore every tenant database, set `CREDENTIALS_ENCRYPTION_KEY` from
the secrets manager, run `pnpm db:tenant:migrate`, start the stack. The DNS
wildcard means no per-tenant DNS work.

**Ransomware or a malicious admin.** Off-site backups with a retention lock
(object-lock / immutable storage) are the only defence that survives an attacker
with production credentials. Enable it on the bucket.

## Objectives

Pick these deliberately and then measure against them.

| Deployment | RPO (data loss) | RTO (time to serve) |
| --- | --- | --- |
| Single VM, nightly backup | up to 24 h | 1–2 h |
| Single VM, 6-hourly backup | up to 6 h | 1–2 h |
| Managed PostgreSQL with PITR | ~5 min | 15–30 min |

If a merchant's Saturday of sales is worth more than the cost of managed
PostgreSQL, the nightly-dump tier is the wrong tier. That is a business
decision, and it should be made on purpose rather than discovered during an
incident.

## Point-in-time recovery

`pg_dump` gives you the moment the dump ran, and nothing between. For
finer-grained recovery you need WAL archiving — managed PostgreSQL (RDS, Aurora,
Cloud SQL) gives it with a checkbox, or self-manage with `pgBackRest` or WAL-G.

Worth noting: PITR on a shared cluster restores the *whole* cluster to a point
in time. Restoring one tenant to yesterday while everyone else stays current
still means a per-database dump — so keep both.

## Testing restores

**Do this before you have customers, and then quarterly.**

1. Take a backup.
2. Restore it onto a scratch machine or a separate Docker stack.
3. Point an API instance at it and fetch a storefront.
4. Time the whole thing and write the number down. That number is your real RTO,
   not the one in the table above.

An untested backup is a hope. The most common failure is not a corrupt dump — it
is discovering that the roles were never dumped, or that nobody knows where the
encryption key lives.
