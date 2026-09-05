# Deployment

This covers the general production procedure. For the cheapest viable setup see
[STARTUP_DEPLOYMENT.md](STARTUP_DEPLOYMENT.md); for AWS topologies see
[AWS_ARCHITECTURE.md](AWS_ARCHITECTURE.md).

## Before the first deploy

**DNS.** RetailOS needs a wildcard record, because every merchant gets a
subdomain and you cannot add a DNS record per signup.

```
*.ourdomain.in    A     <load balancer or server IP>
ourdomain.in      A     <same>
```

**TLS.** A wildcard certificate for `*.ourdomain.in`. Let's Encrypt issues these
through the DNS-01 challenge (HTTP-01 cannot validate a wildcard). With
certbot and a supported DNS provider:

```bash
certbot certonly --dns-<provider> \
  -d 'ourdomain.in' -d '*.ourdomain.in'
```

Renewal must be automated — a wildcard cert expiring takes every storefront
down at once.

**Secrets.** Generate real values for all of these. Never reuse the development
placeholders; the config layer rejects them in production.

```bash
openssl rand -hex 32                 # JWT_ACCESS_SECRET
openssl rand -hex 32                 # JWT_REFRESH_SECRET
openssl rand -base64 32              # CREDENTIALS_ENCRYPTION_KEY (must be 32 bytes)
openssl rand -hex 32                 # COOKIE_SECRET
openssl rand -hex 32                 # INTERNAL_API_KEY
```

`CREDENTIALS_ENCRYPTION_KEY` is the one that matters most: it decrypts every
tenant's database password. Losing it means losing access to every tenant
database. Store it in a secrets manager, not in a file on the box.

**Database role.** The API creates databases and roles at run time, so its
PostgreSQL role needs `CREATEDB` and `CREATEROLE`. On managed PostgreSQL, grant
these to the application role rather than using the provider's superuser.

## Environment

Set at minimum:

```bash
NODE_ENV=production
PLATFORM_DOMAIN=ourdomain.in
PLATFORM_PROTOCOL=https

MASTER_DATABASE_URL=postgresql://user:pass@db-host:5432/retailos_master?schema=public&connection_limit=10&sslmode=require
TENANT_DB_HOST=db-host
TENANT_DB_PORT=5432
TENANT_DB_ADMIN_USER=...
TENANT_DB_ADMIN_PASSWORD=...
TENANT_DB_SSL=true
TENANT_CLUSTER_ID=prod-pg-1

REDIS_URL=rediss://:password@redis-host:6379

JWT_ACCESS_SECRET=...
JWT_REFRESH_SECRET=...
CREDENTIALS_ENCRYPTION_KEY=...
COOKIE_SECRET=...
INTERNAL_API_KEY=...

STORAGE_DRIVER=s3
S3_BUCKET=...
S3_REGION=...
S3_ENDPOINT=...

PAYMENT_PROVIDER=razorpay
RAZORPAY_KEY_ID=...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...

MAIL_DRIVER=smtp
SMTP_HOST=...
SMTP_USER=...
SMTP_PASSWORD=...

SWAGGER_ENABLED=false
METRICS_ENABLED=true
```

Set `TENANT_CLUSTER_ID` deliberately and do not change it casually: tenants
provisioned under one cluster id are reached at the configured address, and
tenants recorded under a *different* cluster id are reached at their recorded
address (see [ADR-016](DECISION_LOG.md#adr-016)).

## Deploying with Compose

The simplest production deployment, suitable up to a few hundred tenants on one
machine:

```bash
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml build
docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm api \
  node -e "require('child_process').execSync('pnpm db:migrate:deploy',{stdio:'inherit'})"
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

`docker-compose.prod.yml` sets `restart: always`, memory limits, log rotation,
two API replicas, and publishes no database ports.

## Migrations

**Order matters.** Master migrations first, then tenant migrations.

```bash
# 1. Master schema
pnpm db:migrate:deploy

# 2. Every tenant database
pnpm db:tenant:migrate
```

Tenant migrations are applied by the runtime runner under an advisory lock, so
running the command while the API is serving traffic is safe — two instances
cannot apply the same migration twice. Provisioning a *new* tenant during a
tenant-migration run is also safe: the new database gets the full set.

**Write migrations to be backward compatible** across a rolling deploy. Add
columns as nullable or with a default; deploy the code that writes them; only
then backfill and tighten. The old and new API versions run simultaneously
during a rollout, and both must work against the same schema.

## Zero-downtime rollout

1. Build and push images tagged with the commit SHA.
2. Apply master migrations (backward compatible).
3. Apply tenant migrations.
4. Roll the API replicas one at a time; `enableShutdownHooks()` drains in-flight
   requests and closes tenant connections cleanly.
5. Roll the workers.
6. Roll the web apps.

Health endpoints for the load balancer:

- `GET /api/v1/health/live` — is the process up? Use for liveness.
- `GET /api/v1/health/ready` — are the dependencies reachable? Use for
  readiness, so a replica with a broken database connection is taken out of
  rotation rather than served traffic.

## nginx and TLS

The bundled nginx config terminates HTTP. In production, either terminate TLS at
a load balancer in front of it, or mount certificates and add a TLS server
block. Whichever you choose, `Host` and `X-Forwarded-Host` must reach the API
unmodified — the tenant is resolved from them.

## Adding a tenant in production

Through the platform admin, or:

```bash
curl -X POST https://api.ourdomain.in/api/v1/platform/tenants \
  -H "Authorization: Bearer $SUPER_ADMIN_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"name":"Sharma Textiles","slug":"sharma","ownerEmail":"owner@sharma.dev","ownerName":"R Sharma","planCode":"starter"}'
```

The wildcard DNS record and wildcard certificate mean `sharma.ourdomain.in`
works the moment provisioning completes. No DNS change, no certificate
issuance, no deploy.

## Custom domains

A merchant using `shop.sharmatextiles.in` needs:

1. A `Domain` row for that hostname pointing at the tenant.
2. A `CNAME` from their domain to yours.
3. A certificate covering it — the wildcard does not. Use on-demand issuance
   (Caddy, or certbot driven by a hook when a custom domain is verified).

Verify ownership before activating a custom domain; otherwise anyone can point a
hostname at your platform.

## Rollback

Application code rolls back by redeploying the previous image tag.

**Schema changes do not roll back automatically.** This is why migrations must
be backward compatible: rolling the code back must leave the database in a state
the old code can still use. Destructive migrations (dropping a column, tightening
a constraint) should ship at least one release *after* the code that stopped
depending on the old shape.

## Post-deploy checks

```bash
curl -s https://api.ourdomain.in/api/v1/health | jq
curl -s https://kickzone.ourdomain.in/api/v1/store | jq -r '.data.store.storeName'
```

Then confirm queue depth is draining and error rates are flat — see
[MONITORING.md](MONITORING.md).

## Backups

Configure them before you have customers, and test a restore before you need
one. See [BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).
