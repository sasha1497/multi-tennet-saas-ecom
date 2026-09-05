# Cost optimization

## The cost model

RetailOS costs are driven by four things, in this order:

1. **The database** — always the largest line once you leave a single VM.
2. **Compute** — API, workers, two web tiers.
3. **Egress and media** — product images, served repeatedly.
4. **Everything else** — DNS, secrets, logs, email.

Tenant count drives storage and connections. Traffic drives compute and egress.
The two scale independently, which is worth remembering when deciding what to
optimise.

## Where the money actually goes

| Tier | Monthly | Largest line |
| --- | --- | --- |
| Single VM (Model A) | $30–40 | Compute |
| ECS + RDS Multi-AZ (Model B) | $350–470 | Database (~50%) |

At Model B, RDS Multi-AZ alone is roughly half the bill. Optimising the API tier
before the database is optimising the wrong thing.

## Levers, highest value first

### 1. Do not buy Multi-AZ before you need it

Multi-AZ roughly doubles the database cost for automatic failover. It is the
right purchase when a merchant losing a Saturday's sales costs more than the
premium — and premature before that. Single-AZ with automated backups and a
tested restore is a legitimate tier, provided the restore really has been
tested.

### 2. Reserved capacity / savings plans

A one-year commitment on EC2, RDS or Fargate saves 30–40% for a decision you
have already effectively made. This is the largest saving available for the
least engineering work.

### 3. Graviton (ARM)

`t4g` / `db.t4g` instances are ~20% cheaper than the x86 equivalents at similar
performance. The images build cleanly for ARM. Take it.

### 4. CloudFront in front of media

Product images are the bulk of egress and are served over and over. A CDN turns
per-request S3 egress into cached delivery and usually pays for itself
immediately at any real traffic level.

### 5. Right-size the connection pool before the instance

The temptation when connections run out is a bigger database. Often the fix is
free:

```bash
TENANT_DB_CONNECTION_LIMIT=2       # from 5
TENANT_POOL_MAX_CONNECTIONS=30     # from 50
```

Tenant workloads are bursty; a large per-client pool mostly sits idle while
capping how many API tasks you can run. Reducing it can defer an instance-class
upgrade entirely. See [SCALING.md](SCALING.md).

### 6. Image storage lifecycle

Product images are written once and read forever. A lifecycle rule moving
objects to infrequent-access after 90 days cuts storage cost substantially with
no user-visible change. Do **not** apply it to backups you might need in a
hurry — retrieval time is part of your RTO.

### 7. Log retention

CloudWatch Logs bills for ingestion and storage, and it is a line that grows
quietly. Set retention to 14–30 days for application logs. Keep audit logs
longer, but keep them in the database where they already live rather than paying
twice.

### 8. Scale workers on queue depth, not CPU

A worker sized for peak provisioning bursts sits idle most of the day. Scaling
on queue depth lets it run at one task normally and burst when a batch of
signups arrives. CPU-based autoscaling will not react to a queue backing up at
all — it is not CPU-bound.

### 9. Cache TTLs

Storefront rendering revalidates every 60 seconds and tenant resolution is
cached. Raising `CACHE_TTL_CATALOG` and `CACHE_TTL_TENANT_RESOLUTION` reduces
database load directly. The trade is staleness — a price change taking two
minutes instead of one is usually fine; a stock level being wrong is not, which
is why stock is never served from cache.

## Cost per tenant

Roughly, at Model B with a few hundred tenants:

| Item | Per tenant per month |
| --- | --- |
| Database storage (~200 MB) | ~$0.03 |
| Backup storage | ~$0.02 |
| Media (~500 MB) | ~$0.02 |
| Compute share | $0.50–2.00 |
| **Total** | **≈ $0.60–2.10** |

Against ₹1,500–3,000/month per merchant (~$18–36), gross margin is comfortable.
The economics of this architecture are fine; the risk is fixed cost at low
tenant counts, which is exactly why Model A exists.

## What not to optimise

**Do not shard tenants into a shared database to save money.** It saves a
little storage overhead and forfeits the isolation guarantee the product is
sold on. The savings are not worth the class of bug it reintroduces.

**Do not skip backups or their off-site copy.** The cheapest storage in the
stack, and the only thing standing between you and losing a merchant's business.

**Do not disable Multi-AZ after you have promised uptime.** Reversing a
reliability decision to save money is how outages become incidents.

## Free and cheap alternatives worth knowing

| Instead of | Consider | Note |
| --- | --- | --- |
| S3 egress | Cloudflare R2 | No egress fee — significant for image-heavy stores |
| SES / Mailgun | Brevo, Zoho free tiers | Generous free volumes for transactional mail |
| CloudWatch dashboards | Grafana Cloud free tier | Enough for a single-VM deployment |
| Managed Redis | Redis on the same VM | Fine at Model A; not fine once jobs matter |
| ALB | nginx on the instance | Saves $20/month at Model A, costs you failover |

## Reviewing costs

Monthly, check three things:

1. **The largest line item** — usually the database. Is it right-sized?
2. **Growth rate versus tenant growth.** Cost growing faster than tenants means
   something is inefficient, not popular.
3. **Anything unattributed.** Untagged resources are usually forgotten ones.

Tag everything by environment and component from the start; retrofitting tags
across an account is tedious and nobody ever does it.
