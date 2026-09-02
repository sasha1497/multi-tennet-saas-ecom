import { Global, Injectable, Module } from '@nestjs/common';

interface HistogramState {
  count: number;
  sum: number;
  /** Sorted reservoir used for percentile estimation. */
  samples: number[];
}

const MAX_SAMPLES = 1_000;

/**
 * Lightweight in-process metrics.
 *
 * Deliberately dependency-free rather than pulling in prom-client for the MVP:
 * it exposes the four numbers that actually matter for this system's SLOs
 * (p95/p99 latency, error rate, throughput) in Prometheus text format, and the
 * `MetricsService` interface is what an OpenTelemetry exporter would implement
 * later without touching call sites.
 *
 * Requirement §32 asks for p95/p99, error rate, DB/Redis/queue health — the
 * first three live here; the health checks live in the health module.
 */
@Injectable()
export class MetricsService {
  private readonly startedAt = Date.now();
  private readonly counters = new Map<string, number>();
  private readonly histograms = new Map<string, HistogramState>();
  private readonly gauges = new Map<string, number>();

  recordHttpRequest(params: {
    method: string;
    route: string;
    status: number;
    durationMs: number;
  }): void {
    const labels = `method="${params.method}",route="${sanitise(params.route)}",status="${params.status}"`;
    this.incrementCounter(`http_requests_total{${labels}}`);
    this.observe(`http_request_duration_ms{method="${params.method}",route="${sanitise(params.route)}"}`, params.durationMs);

    if (params.status >= 500) this.incrementCounter('http_server_errors_total');
    else if (params.status >= 400) this.incrementCounter('http_client_errors_total');
    this.incrementCounter('http_requests_handled_total');
  }

  incrementCounter(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  setGauge(name: string, value: number): void {
    this.gauges.set(name, value);
  }

  observe(name: string, value: number): void {
    const state = this.histograms.get(name) ?? { count: 0, sum: 0, samples: [] };
    state.count += 1;
    state.sum += value;
    if (state.samples.length < MAX_SAMPLES) {
      state.samples.push(value);
    } else {
      // Reservoir sampling keeps memory bounded while staying representative.
      const idx = Math.floor(Math.random() * state.count);
      if (idx < MAX_SAMPLES) state.samples[idx] = value;
    }
    this.histograms.set(name, state);
  }

  /** Timing helper: `await metrics.time('queue_job_ms', () => run())`. */
  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const started = Date.now();
    try {
      return await fn();
    } finally {
      this.observe(name, Date.now() - started);
    }
  }

  percentile(name: string, p: number): number | null {
    const state = this.histograms.get(name);
    if (!state || state.samples.length === 0) return null;
    const sorted = [...state.samples].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return Math.round(sorted[idx] * 100) / 100;
  }

  /** Aggregate view used by /platform/system/health and the ops dashboard. */
  snapshot(): {
    uptimeSeconds: number;
    requests: number;
    clientErrors: number;
    serverErrors: number;
    errorRate: number;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    gauges: Record<string, number>;
  } {
    const requests = this.counters.get('http_requests_handled_total') ?? 0;
    const serverErrors = this.counters.get('http_server_errors_total') ?? 0;
    const clientErrors = this.counters.get('http_client_errors_total') ?? 0;

    const all = [...this.histograms.entries()]
      .filter(([k]) => k.startsWith('http_request_duration_ms'))
      .flatMap(([, v]) => v.samples)
      .sort((a, b) => a - b);

    const at = (p: number) =>
      all.length ? Math.round(all[Math.min(all.length - 1, Math.floor((p / 100) * all.length))] * 100) / 100 : null;

    return {
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      requests,
      clientErrors,
      serverErrors,
      errorRate: requests > 0 ? Math.round((serverErrors / requests) * 10_000) / 100 : 0,
      p50: at(50),
      p95: at(95),
      p99: at(99),
      gauges: Object.fromEntries(this.gauges),
    };
  }

  /** Prometheus exposition format, served at GET /metrics. */
  toPrometheus(): string {
    const lines: string[] = [];

    lines.push('# HELP retailos_uptime_seconds Process uptime in seconds');
    lines.push('# TYPE retailos_uptime_seconds gauge');
    lines.push(`retailos_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`);

    for (const [name, value] of this.counters) {
      lines.push(`${prefixed(name)} ${value}`);
    }
    for (const [name, value] of this.gauges) {
      lines.push(`${prefixed(name)} ${value}`);
    }
    for (const [name, state] of this.histograms) {
      const base = prefixed(name);
      const { head, labels } = splitLabels(base);
      lines.push(`${head}_count${labels} ${state.count}`);
      lines.push(`${head}_sum${labels} ${Math.round(state.sum)}`);
      for (const q of [0.5, 0.95, 0.99]) {
        const v = this.percentile(name, q * 100);
        if (v !== null) {
          lines.push(`${head}${insertLabel(labels, `quantile="${q}"`)} ${v}`);
        }
      }
    }

    return `${lines.join('\n')}\n`;
  }

  reset(): void {
    this.counters.clear();
    this.histograms.clear();
    this.gauges.clear();
  }
}

function prefixed(name: string): string {
  return name.startsWith('retailos_') ? name : `retailos_${name}`;
}

function sanitise(route: string): string {
  return route.replace(/"/g, '').slice(0, 120);
}

function splitLabels(metric: string): { head: string; labels: string } {
  const brace = metric.indexOf('{');
  if (brace === -1) return { head: metric, labels: '' };
  return { head: metric.slice(0, brace), labels: metric.slice(brace) };
}

function insertLabel(labels: string, extra: string): string {
  if (!labels) return `{${extra}}`;
  return `${labels.slice(0, -1)},${extra}}`;
}

@Global()
@Module({
  providers: [MetricsService],
  exports: [MetricsService],
})
export class ObservabilityModule {}
