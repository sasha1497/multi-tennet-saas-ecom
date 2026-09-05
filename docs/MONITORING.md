# Monitoring

## Health endpoints

| Endpoint | Use | Returns |
| --- | --- | --- |
| `GET /api/v1/health/live` | Liveness probe | Process up + uptime. Never touches a dependency |
| `GET /api/v1/health/ready` | Readiness probe | Master database + Redis reachable |
| `GET /api/v1/health` | Dashboards, paging | Full report: database, Redis, queues, storage |
| `GET /api/v1/health/metrics` | Scraping | Counters and histograms |

The split matters. **Liveness must not check dependencies** — if it did, a brief
database blip would make the orchestrator kill and restart every healthy API
container, converting a recoverable dependency problem into a full outage.
Readiness *should* check them, so a replica that cannot reach the database is
taken out of rotation but left alive to recover.

```bash
curl -s https://api.ourdomain.in/api/v1/health | jq
```

```json
{
  "status": "ok",
  "checks": {
    "masterDatabase": { "ok": true, "latencyMs": 3 },
    "redis": true,
    "queues": true,
    "storage": true
  }
}
```

## Metrics

`GET /api/v1/health/metrics` exposes counters and histograms:

- `http_requests_total{method,route,status}`
- `http_requests_handled_total`
- `http_client_errors_total`, `http_server_errors_total`
- request duration histograms
- tenant connection pool size and evictions
- queue depth and job outcomes

Scrape it with Prometheus, or publish selected values to CloudWatch. Enable with
`METRICS_ENABLED=true`.

## Logging

Structured JSON via pino; pretty-printed in development (`LOG_PRETTY=true`).

Every line carries `requestId`. Tenant-scoped lines carry `tenantId` and
`tenantSlug`; authenticated lines carry `userId` and `audience`. That is what
makes "show me everything that happened to this merchant in the last hour" a
single query rather than an investigation.

```json
{
  "level": "info", "context": "HTTP",
  "requestId": "1d449231-…", "tenantId": "d32ce7bc-…", "tenantSlug": "kickzone",
  "userId": null, "audience": null,
  "method": "GET", "path": "/api/v1/store", "status": 200, "durationMs": 12
}
```

Client responses carry the same `requestId`, so a user-reported problem maps
directly to the log line.

**Never logged:** passwords, tokens, database credentials, payment signatures,
full card data. Tenant credentials are decrypted in memory only and never reach
a log line — and the malformed-selector warning deliberately logs the *source*
of a bad value rather than the value itself.

## What to alert on

Alert on symptoms users feel, not on every deviation. A pager that fires for
things nobody would notice trains people to ignore it.

| Alert | Condition | Why |
| --- | --- | --- |
| **API down** | `/health/ready` failing 2 min | Everything is broken |
| **5xx rate** | > 1% of requests over 5 min | Something is broken for real users |
| **p95 latency** | > 1 s over 10 min | Degrading before it fails |
| **DB connections** | > 80% of `max_connections` | The first wall ([SCALING.md](SCALING.md)) |
| **Queue depth rising** | Growing over 15 min | Workers stuck or too few |
| **Provisioning failures** | Any failed job | A merchant cannot open their shop |
| **Payment webhook failures** | > 3 in 10 min | Orders may not be confirming |
| **Redis memory** | > 75% | `noeviction` means writes start failing |
| **Disk** | > 80% | A full disk stops PostgreSQL |
| **Backup missing** | No successful backup in 26 h | Silent until you need it |
| **Certificate expiry** | < 14 days | A wildcard expiry takes every storefront down at once |

The last two are the ones that bite: both fail silently and both are catastrophic
at the moment they matter.

## Tenant-aware monitoring

Multi-tenancy means an outage can affect one merchant or all of them, and the
response is completely different.

- Break the 5xx rate down **by tenant**. One tenant erroring is a tenant
  problem (a bad migration, a corrupt row); every tenant erroring is a platform
  problem.
- Watch `TenantConnectionManager` evictions. High churn means the pool is too
  small for the active set.
- Track the tenant schema version spread. Tenants stuck behind after a migration
  run are a real, quiet failure — `tenant_migration_records` in the master
  database and `GET /platform/system/health` both surface it.

## Platform admin

`/platform/system` in the merchant console shows service health, queue depths and
the audit trail without a separate observability stack — useful on the
single-VM tier where there is nowhere to send metrics yet.

## On a budget

Do these three before building anything:

1. **External uptime check** on `/health/ready` every minute. Only external
   monitoring notices when the whole box is down.
2. **Disk alert** above 80%.
3. **Backup success alert** — treat a missing backup as an incident.

Everything else can wait until there is somewhere to put the data.

## Tracing

OpenTelemetry hooks are present (`OTEL_ENABLED`,
`OTEL_EXPORTER_OTLP_ENDPOINT`) and off by default. Turn them on when you have a
collector; distributed tracing on a single-VM deployment mostly produces data
nobody reads.
