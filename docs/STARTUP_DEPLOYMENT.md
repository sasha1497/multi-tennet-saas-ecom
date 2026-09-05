# Startup deployment — the cheapest thing that works

For a founder with a handful of merchants and no budget for managed services.
This is a real production setup, not a toy: it has TLS, backups, health checks
and a restore procedure. It is simply not redundant.

**Be honest about the trade-off.** One machine means one failure domain. A
reboot is downtime for every tenant. That is an acceptable trade at ten
merchants and an unacceptable one at a hundred — see the exit path at the end.

## Shape

```
                    ┌──────────────────────────────────────┐
                    │  One VM (4 vCPU / 8 GB / 100 GB SSD)  │
   *.ourdomain.in ─▶│                                       │
                    │  nginx ─┬─ storefront-web             │
                    │         ├─ merchant-web               │
                    │         └─ api ── worker              │
                    │              │                        │
                    │         postgres     redis            │
                    └──────────────┬───────────────────────┘
                                   │ nightly
                                   ▼
                        object storage (backups)
```

Everything in Docker Compose on a single VM. Media goes to object storage
(Cloudflare R2 has no egress fee; S3 works too). Backups go to the same bucket.

## Cost

Indicative monthly figures for an Indian-market startup, in USD:

| Item | Choice | Cost |
| --- | --- | --- |
| VM | Hetzner CPX31 / DO 4 GB+ / Lightsail 4 GB | $12–24 |
| Object storage | R2 / S3, ~50 GB | $1–2 |
| Backup storage | Same bucket, 30 days retention | $1–2 |
| Domain | `.in` domain | ~$1 |
| TLS | Let's Encrypt wildcard | $0 |
| Email | Brevo/Zoho free tier, then ~$10 | $0–10 |
| SMS | Pay per message | usage |
| **Total** | | **≈ $15–40/month** |

At ₹1,500–3,000/month, one paying merchant covers the whole platform.

## Setup

### 1. The machine

Ubuntu 24.04. Install Docker, set up a firewall, create a non-root user.

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER

ufw default deny incoming && ufw default allow outgoing
ufw allow OpenSSH && ufw allow 80 && ufw allow 443 && ufw enable
```

Add swap — 8 GB of RAM with Postgres, Redis, an API, a worker and two Next
servers is comfortable but not generous, and swap turns an OOM kill into a slow
minute:

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 2. DNS

```
*.ourdomain.in    A    <server IP>
ourdomain.in      A    <server IP>
```

The wildcard is what makes onboarding a merchant free: no DNS change per
signup.

### 3. TLS

A wildcard certificate needs the DNS-01 challenge:

```bash
docker run --rm -it \
  -v /etc/letsencrypt:/etc/letsencrypt \
  certbot/dns-cloudflare certonly \
  --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cf.ini \
  -d 'ourdomain.in' -d '*.ourdomain.in'
```

Put renewal in cron and make it reload nginx. A wildcard cert expiring takes
every storefront down simultaneously, so treat the renewal job as production
code.

### 4. Deploy

```bash
git clone <repo> /opt/retailos && cd /opt/retailos
cp .env.example .env
# Edit .env: real secrets, PLATFORM_DOMAIN, S3 credentials, payment keys
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
docker compose exec api pnpm db:migrate:deploy
```

Generate every secret properly:

```bash
openssl rand -hex 32      # each JWT secret, cookie secret, internal API key
openssl rand -base64 32   # CREDENTIALS_ENCRYPTION_KEY — must be 32 bytes
```

Store `CREDENTIALS_ENCRYPTION_KEY` somewhere off the machine as well. It
decrypts every tenant's database password; losing it locks you out of every
tenant database.

### 5. Create the first merchant

```bash
docker compose exec api node dist/cli/create-super-admin.js   # or via the seed
```

Then sign in to `https://admin.ourdomain.in/platform` and create tenants from
the UI.

## Backups

Nightly `pg_dump` of the master database and every tenant database, compressed
and pushed to object storage. `infrastructure/scripts/` has the shape; the
essentials:

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F)
DEST=/var/backups/retailos/$STAMP
mkdir -p "$DEST"

docker compose exec -T postgres pg_dumpall --globals-only \
  -U retailos | gzip > "$DEST/globals.sql.gz"

for db in $(docker compose exec -T postgres psql -U retailos -tAc \
  "SELECT datname FROM pg_database WHERE datname='retailos_master' OR datname LIKE 'tenant_%'"); do
  docker compose exec -T postgres pg_dump -U retailos -Fc "$db" > "$DEST/$db.dump"
done

rclone copy "$DEST" r2:retailos-backups/$STAMP
find /var/backups/retailos -maxdepth 1 -mtime +7 -exec rm -rf {} +
```

`cron`: `0 2 * * * /opt/retailos/backup.sh >> /var/log/retailos-backup.log 2>&1`

**Restore drill.** Do it once, now, before you have customers. An untested
backup is a hope, not a backup. See
[BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md).

## Monitoring on a budget

- **Uptime** — a free external checker (UptimeRobot, Better Stack) hitting
  `https://api.ourdomain.in/api/v1/health/ready` every minute. External
  monitoring is the only kind that notices when the whole box is down.
- **Disk** — a cron check that alerts above 80%. On a single-VM deployment,
  a full disk stops Postgres, which stops everything.
- **Logs** — Docker's json-file driver with rotation is configured in
  `docker-compose.prod.yml`. `docker compose logs -f api` is your log search.
- **Metrics** — `/api/v1/health/metrics` is Prometheus-formatted. Scrape it when
  you have somewhere to put it; do not build an observability stack on day one.

## Tuning for a small box

In `.env`:

```bash
TENANT_POOL_MAX_CONNECTIONS=20     # cached tenant clients
TENANT_DB_CONNECTION_LIMIT=3       # connections per tenant client
WORKER_CONCURRENCY=3
```

And in PostgreSQL, `max_connections=200` with `shared_buffers=2GB` is a sane
starting point for 8 GB of RAM.

The connection maths is the thing to watch: pool size × per-client limit must
stay comfortably under `max_connections`, with room for the worker and your own
`psql`.

## When to leave this setup

Move when any of these becomes true — not before, and not after:

- **Downtime stops being acceptable.** The first merchant who loses a Saturday's
  sales to a reboot is the signal. Move the database to managed PostgreSQL with
  automated failover.
- **The disk or CPU is consistently above 70%.** Split the web tier off first;
  it is stateless and the easiest to move.
- **More than ~100 tenants.** Connection maths and backup duration both stop
  being comfortable. See [SCALING.md](SCALING.md).
- **You need a compliance story.** Managed services come with the audit trail
  and the certifications.

The migration path is deliberately gentle: the same images, the same compose
files, pointed at a managed database and Redis. Because tenants record their
placement (`cluster_id`, host, port) and the local cluster's address is
configuration, moving the database is an environment change plus a restore — not
a rewrite. See [AWS_ARCHITECTURE.md](AWS_ARCHITECTURE.md).
