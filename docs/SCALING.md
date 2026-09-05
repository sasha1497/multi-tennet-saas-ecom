# Scaling

Where this system breaks first, in the order it will actually happen, and what
to do about each. The numbers are reasoned from the architecture, not measured
under load — there is no load test in the repository, and pretending otherwise
would be worse than saying so.

## 1. Database connections (the first real wall)

**Why it is first.** Every other layer scales by adding instances. Connections
scale *down* as you add instances, because each one holds its own pool.

The arithmetic:

```
connections ≈ api_instances × TENANT_POOL_MAX_CONNECTIONS × TENANT_DB_CONNECTION_LIMIT
```

Defaults of 50 × 5 mean one API instance can hold 250 connections. Two
instances exceed a `db.t4g.medium`'s ~340 limit. PostgreSQL degrades badly past
a few hundred — each connection is a process with its own memory.

**Symptoms.** `too many clients already`; `SERVICE_UNAVAILABLE` from tenant
lookups; latency spikes that correlate with instance count rather than traffic.

**Fixes, cheapest first.**

1. Lower `TENANT_DB_CONNECTION_LIMIT` to 2–3. Tenant workloads are bursty; a
   large per-client pool mostly sits idle.
2. Lower `TENANT_POOL_MAX_CONNECTIONS` and rely on idle eviction. A cold tenant
   pays one connection setup; that is cheaper than exhausting the server.
3. Put PgBouncer or RDS Proxy in front, in transaction mode. Note that
   transaction pooling forbids session-level state — the migration runner's
   advisory locks must then run on a direct connection, not through the pooler.
4. Raise the instance class.

## 2. Backup and migration duration

Both are **linear in tenant count**, and both are invisible until they are not.

At 500 tenants, a nightly per-tenant `pg_dump` loop can run for hours, and
`pnpm db:tenant:migrate` becomes a deploy step measured in tens of minutes.

**Fixes.** Parallelise the backup loop with a bounded worker count (4–8; more
just saturates disk). Move to WAL-based backup (pgBackRest, WAL-G, or managed
PITR) so the incremental cost per tenant approaches zero. For migrations, run
them as a background job with progress reporting rather than a blocking deploy
step, and make every migration backward compatible so the old code tolerates the
in-between state — which it must anyway during a rolling deploy.

## 3. Redis

Single-instance Redis handles cache, rate limits, locks and BullMQ comfortably
into the tens of thousands of operations per second. The failure mode is memory,
not throughput.

Note `--maxmemory-policy noeviction` is required by BullMQ — an evicted job key
is a lost job. That means Redis filling up returns write errors rather than
silently dropping data, which is the correct behaviour but does mean you must
watch memory.

**Fixes.** Separate the cache from the queue into two Redis instances so cache
growth can never threaten jobs. Multi-AZ replication for failover. Shorten cache
TTLs before adding memory.

## 4. Worker throughput

Provisioning is the long pole (a database creation plus migrations, seconds
each). Notifications are I/O-bound and cheap.

**Fixes.** Raise `WORKER_CONCURRENCY`; run more worker instances; give
provisioning its own worker so a burst of signups cannot delay order emails.
Scale on **queue depth**, not CPU — a backed-up queue is not CPU-bound and
CPU-based autoscaling will not react.

## 5. The API tier

Stateless — the request context is `AsyncLocalStorage`, sessions are tokens,
nothing is held in process except the connection pool. It scales horizontally
with no coordination, right up until it hits item 1.

## 6. Storefront rendering

Next.js SSR with a 60-second `revalidate` on storefront fetches, so a burst of
visitors does not become a burst of API calls. Add CloudFront in front of static
assets and media first; it is the cheapest large win.

Per-tenant cache keys are essential and already in place — a cache that ignores
the tenant would serve one shop's catalog to another, which is a correctness
bug, not a performance one.

## 7. Search

`pg_trgm` GIN indexes handle typo-tolerant search well into the tens of
thousands of products per tenant. Because each tenant is a separate database,
per-tenant catalogs stay small — a merchant with 2,000 SKUs is searching 2,000
rows, not 2,000,000.

Move to a dedicated search service only if a single merchant's catalog gets very
large or you need faceting the database cannot do cheaply.

## 8. Cross-tenant analytics

This is the architecture's genuine weak spot, and it is worth being direct about
it. "Total GMV across all merchants" means querying N databases. At 500 tenants
that is not a query, it is a job.

**The answer is a rollup pipeline**, not a clever query: each tenant publishes
periodic aggregates to a table in the master database (or a warehouse), and
platform reporting reads those. It is deliberately not built yet — see
[FUTURE_ROADMAP.md](FUTURE_ROADMAP.md).

## Rough capacity by tier

Reasoned estimates, not benchmarks.

| Tier | Tenants | Shape |
| --- | --- | --- |
| Single VM (4 vCPU / 8 GB) | up to ~50 | Everything on one box |
| Single VM + managed DB | ~50–200 | Move PostgreSQL to RDS first |
| ECS + RDS Multi-AZ | ~200–2,000 | Model B in [AWS_ARCHITECTURE.md](AWS_ARCHITECTURE.md) |
| Multi-cluster | 2,000+ | Shard tenants across clusters by `cluster_id` |

## Sharding, when it comes

The groundwork is already in place: `tenant_databases` records `cluster_id`,
`host` and `port` per tenant, and the connection manager treats the local
cluster's address as configuration while honouring the recorded address for
every other cluster ([ADR-016](DECISION_LOG.md#adr-016)).

Moving a tenant to a new cluster is therefore: dump, restore onto the new
cluster, update their row, evict their cached connection. No code change, and no
downtime for anyone else.

## What to watch

| Metric | Act when |
| --- | --- |
| PostgreSQL connections in use | > 70% of `max_connections` |
| API p95 latency | > 500 ms sustained |
| BullMQ queue depth | Growing over a 15-minute window |
| Redis memory | > 75% of `maxmemory` |
| Backup duration | > half the interval between backups |
| Tenant migration duration | Longer than your acceptable deploy window |
| Disk usage | > 75% |

See [MONITORING.md](MONITORING.md).
