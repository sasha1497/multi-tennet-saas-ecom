# AWS reference architectures

Two topologies. Start with the first; move to the second when the triggers in
[SCALING.md](SCALING.md) fire. They are deliberately the same application with
different infrastructure underneath — nothing in the code changes.

---

## Model A — Ultra-low-cost startup

For the first few dozen merchants. One EC2 instance running the same Compose
stack you develop against.

```
        Route 53
   *.ourdomain.in  A ──▶ Elastic IP
                            │
              ┌─────────────┴──────────────┐
              │  EC2 t4g.medium (ARM)      │
              │  2 vCPU / 4 GB / 60 GB gp3 │
              │                            │
              │  nginx (TLS)               │
              │  api ×1   worker ×1        │
              │  storefront-web  merchant-web │
              │  postgres  redis           │
              └─────────────┬──────────────┘
                            │
                    S3 (media + backups)
```

| Component | Choice | ~USD/month |
| --- | --- | --- |
| Compute | EC2 t4g.medium, 1-year savings plan | $17–24 |
| Storage | 60 GB gp3 | $5 |
| Elastic IP | attached | $0 |
| S3 | 50 GB + requests | $2 |
| Route 53 | hosted zone + queries | $1 |
| Data transfer | ~50 GB out | $4 |
| TLS | Let's Encrypt wildcard | $0 |
| **Total** | | **≈ $30–40** |

Graviton (`t4g`) is roughly 20% cheaper than the equivalent x86 instance and the
images build cleanly for ARM — worth taking.

**What you are accepting:** one availability zone, one instance, no automatic
failover. A reboot is downtime for every tenant. Backups are the recovery
mechanism, so their interval is your real RPO.

**What you get right anyway:** wildcard TLS, per-tenant backups, health checks,
non-root containers, no exposed database ports, and an application that does not
need to change when you outgrow this.

---

## Model B — Scalable production

For hundreds to thousands of merchants, where downtime costs real money.

```
                          Route 53
                    *.ourdomain.in (ALIAS)
                              │
                     CloudFront (static/media)
                              │
                    ALB (ACM wildcard cert)
                    host-based routing
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
     ECS: storefront   ECS: merchant     ECS: api (2–N)
        (Fargate)        (Fargate)          (Fargate)
                                              │
                                        ECS: worker (1–N)
                                              │
              ┌───────────────┬────────────────┼──────────────┐
              ▼               ▼                ▼              ▼
      RDS PostgreSQL   ElastiCache        S3 (media)   Secrets Manager
      Multi-AZ + read     Redis                        (JWT, DB, payment)
      replica          Multi-AZ
```

| Component | Choice | ~USD/month |
| --- | --- | --- |
| ALB | 1 | $20 |
| ECS Fargate | api 2×0.5vCPU/1GB, worker 1×, web 2×0.25vCPU | $70–110 |
| RDS PostgreSQL | db.t4g.medium Multi-AZ, 200 GB gp3 | $180–220 |
| ElastiCache Redis | cache.t4g.small Multi-AZ | $35 |
| S3 + CloudFront | 500 GB + transfer | $25–45 |
| Secrets Manager | ~10 secrets | $4 |
| CloudWatch | logs + metrics + alarms | $15–30 |
| Route 53 | zone + queries | $2 |
| **Total** | | **≈ $350–470** |

At ₹2,000/month per merchant, roughly 20 merchants cover this.

### Notes that matter for *this* application

**Wildcard TLS on the ALB.** Request `*.ourdomain.in` in ACM (DNS validation)
and attach it to the listener. This is what makes a new merchant free to
onboard — no certificate issuance per signup.

**`Host` must survive the ALB.** The API resolves the tenant from the hostname.
ALBs preserve `Host` and add `X-Forwarded-Host`; the API prefers the latter and
falls back to the former, so both work. Do not put anything in front that
rewrites `Host` to the origin name.

**RDS role privileges.** The API creates databases and roles at run time, so the
application role needs `CREATEDB` and `CREATEROLE`. On RDS you cannot use a true
superuser; grant these to the application role explicitly, and grant
`rds_superuser` only if your extension set requires it.

**Connection maths is the real constraint.** `db.t4g.medium` allows roughly 340
connections. With `TENANT_POOL_MAX_CONNECTIONS=50` and
`TENANT_DB_CONNECTION_LIMIT=3`, each API task can hold ~150 connections — so two
tasks already approach the limit. Either keep the pool small, raise the instance
class, or put RDS Proxy in front. Set this deliberately; discovering it under
load is unpleasant.

**Read replicas.** Reports and the storefront catalog are read-heavy and
tolerate seconds of staleness. Routing those to a replica is the highest-value
database optimisation available, and it does not change tenant isolation:
replicas carry every tenant database, and the connection still selects one.

**Secrets Manager.** `CREDENTIALS_ENCRYPTION_KEY`, both JWT secrets and the
payment keys belong here, injected as ECS task secrets. Never in a task
definition's plain environment.

**Autoscaling.** Scale the API on CPU and ALB request count per target. Scale
the worker on queue depth (a custom CloudWatch metric published from
`/platform/system/queues`) rather than CPU — a backed-up provisioning queue is
not CPU-bound.

**Multi-cluster placement.** `TENANT_CLUSTER_ID` plus the per-tenant recorded
host is what lets a large merchant be moved to their own RDS instance without a
code change: record the new cluster id and address on their row, and the
connection manager routes them there while everyone else stays on the shared
cluster. See [ADR-016](DECISION_LOG.md#adr-016).

---

## Migrating from Model A to Model B

The application does not change. The steps:

1. Create RDS and ElastiCache; restore the latest backup into RDS
   ([BACKUP_AND_RECOVERY.md](BACKUP_AND_RECOVERY.md)).
2. Point `MASTER_DATABASE_URL`, `TENANT_DB_HOST`/`PORT` and `REDIS_URL` at them,
   keeping `TENANT_CLUSTER_ID` the same — the recorded per-tenant addresses stay
   valid because the local cluster's address is configuration.
3. Run `pnpm db:tenant:migrate` to re-apply grants on the restored databases.
4. Push images to ECR, create the ECS services, attach the ALB.
5. Cut DNS over. Keep the EC2 instance running until you are confident.

The only genuinely irreversible step is the DNS cut, and even that is a TTL
away from being reversed.

## What is deliberately not here

- **Kubernetes.** ECS Fargate is enough for this workload and costs far less
  operator time. Revisit when you need multi-region or heavy custom scheduling.
- **A separate analytics warehouse.** Cross-tenant reporting on database-per-
  tenant needs a rollup pipeline. It is real work and it is not needed at
  launch — [FUTURE_ROADMAP.md](FUTURE_ROADMAP.md).
- **Multi-region.** Adds latency, cost and consistency problems that a
  single-country retail platform does not have.
