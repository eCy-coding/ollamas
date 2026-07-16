// Prometheus metrics (Faz 9D). Exposed at GET /metrics. Default Node/process
// metrics + HTTP request duration + MCP tool-call counter wired to the
// ToolRegistry choke-point (via onUsage).

import client from "prom-client";

export const register = new client.Registry();
client.collectDefaultMetrics({ register });

export const httpDuration = new client.Histogram({
  name: "http_request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "route", "status"],
  buckets: [25, 50, 100, 200, 500, 1000, 2000, 5000],
  registers: [register],
});

export const toolCalls = new client.Counter({
  name: "mcp_tool_calls_total",
  help: "Total tool calls through the choke-point, by tool / tier / outcome",
  labelNames: ["tool", "tier", "ok"],
  registers: [register],
});

/** Record one tool call (called from the choke-point onUsage hooks). */
export function recordToolMetric(tool: string, tier: string, ok: boolean) {
  toolCalls.labels(tool, tier, String(ok)).inc();
}

export const ukpStageEventsTotal = new client.Counter({
  name: "ukp_stage_events_total",
  help: "UKP stage-events received, by type and recorded status",
  labelNames: ["event_type", "recorded"],
  registers: [register],
});

// --- Observability depth (Faz 14C) ---

/** Graceful-shutdown counter — incremented once on SIGTERM/SIGINT. */
export const shutdownTotal = new client.Counter({
  name: "ollamas_shutdown_total",
  help: "Number of graceful shutdowns initiated",
  registers: [register],
});

/** Stray-background-rejection counter — incremented each time an unhandledRejection is
 * survived (logged, not fatal). A rising value flags a `.catch`-less promise to fix. */
export const unhandledRejectionTotal = new client.Counter({
  name: "ollamas_unhandled_rejection_total",
  help: "Number of unhandled promise rejections survived (logged, process kept alive)",
  registers: [register],
});

/** Central error-tracking counter (M-049) — every recorded error, by kind
 * (route | unhandledRejection | uncaughtException). Fed by server/error-tracking.ts. */
export const errorsTotal = new client.Counter({
  name: "ollamas_errors_total",
  help: "Errors recorded by the central error tracker, by kind",
  labelNames: ["kind"],
  registers: [register],
});

/** ecysearch supervised sub-service — supervision telemetry (set by server/ecysearch.ts). */
export const ecysearchRestartsTotal = new client.Counter({
  name: "ecysearch_restarts_total",
  help: "Number of times the ecysearch sub-service was (re)started by the supervisor",
  registers: [register],
});
export const ecysearchUp = new client.Gauge({
  name: "ecysearch_up",
  help: "1 when the ecysearch child process is alive, else 0",
  registers: [register],
});
export const ecysearchReady = new client.Gauge({
  name: "ecysearch_ready",
  help: "1 when the ecysearch sub-service answers its health check, else 0",
  registers: [register],
});

/** eCySearcher (docker-compose threat-intel stack) supervision telemetry (set by server/ecysearcher.ts). */
export const ecysearcherRestartsTotal = new client.Counter({
  name: "ecysearcher_restarts_total",
  help: "Number of times the supervisor (re)ran `docker compose up` to heal eCySearcher",
  registers: [register],
});
export const ecysearcherUp = new client.Gauge({
  name: "ecysearcher_up",
  help: "1 when the eCySearcher stack is supervised + started, else 0",
  registers: [register],
});
export const ecysearcherReady = new client.Gauge({
  name: "ecysearcher_ready",
  help: "1 when the eCySearcher Flask API answers its health check, else 0",
  registers: [register],
});

// --- C2: periodic-loop migration (jobs/tracing/hierarchy) ---

/** Durable-job + in-memory recurring-loop executions (server/jobs.ts), by job/loop
 * name and outcome (done|failed). Covers both runClaimedJob (durable queue) and
 * runRecurringTick (sub-minute in-memory loops, e.g. webhook retry). */
export const jobsRunsTotal = new client.Counter({
  name: "ollamas_jobs_runs_total",
  help: "Job queue and recurring-loop executions, by name and outcome",
  labelNames: ["name", "outcome"],
  registers: [register],
});

/** Duration of each job/recurring-loop execution in milliseconds, same label set
 * as jobsRunsTotal so a slow/failing job is identifiable by name+outcome. */
export const jobsDurationMs = new client.Histogram({
  name: "ollamas_jobs_duration_ms",
  help: "Job queue and recurring-loop execution duration in milliseconds, by name and outcome",
  labelNames: ["name", "outcome"],
  buckets: [10, 50, 100, 250, 500, 1000, 5000, 15000, 30000, 60000],
  registers: [register],
});

/** Spans exported through the tracing ring-buffer bridge (server/tracing.ts's
 * RingBufferBridgeExporter) — one increment per finished span, mirrors what
 * lands in GET /api/traces. */
export const tracingSpansExportedTotal = new client.Counter({
  name: "ollamas_tracing_spans_exported_total",
  help: "Spans exported through the tracing ring-buffer bridge",
  registers: [register],
});

/** Hierarchy-bridge tier recommendations computed (server/hierarchy-bridge.ts's
 * getHierarchyRecommendation), by resolved tier and the mode actually applied
 * (advisory|enforce|off — enforce only when the policy is usable). */
export const hierarchyRecommendationsTotal = new client.Counter({
  name: "ollamas_hierarchy_recommendations_total",
  help: "Hierarchy-bridge tier recommendations computed, by tier and applied mode",
  labelNames: ["tier", "mode"],
  registers: [register],
});

/** Semantic LLM response cache events (server/semantic-cache.ts, C4 — default OFF
 *  via SEMANTIC_CACHE=1), by outcome: hit_exact | hit_semantic | miss | store. */
export const semanticCacheEventsTotal = new client.Counter({
  name: "ollamas_semantic_cache_events_total",
  help: "Semantic LLM response cache events, by outcome (hit_exact|hit_semantic|miss|store)",
  labelNames: ["outcome"],
  registers: [register],
});

/**
 * Pull-time gauges sourced from the store at scrape (prom-client async collect).
 * Lazily registered once at boot so this module has no import cycle with the store.
 */
let storeMetricsRegistered = false;
export function registerStoreMetrics(store: {
  poolStats: () => { total: number; idle: number; waiting: number } | null;
  migrationVersion: () => Promise<number>;
  pendingDeliveryCount: () => Promise<number>;
}) {
  if (storeMetricsRegistered) return; // idempotent — prom-client throws on dup names
  storeMetricsRegistered = true;
  new client.Gauge({
    name: "ollamas_db_pool_connections",
    help: "Postgres pool connections by state (pg only; absent on sqlite)",
    labelNames: ["state"],
    registers: [register],
    async collect() {
      const s = store.poolStats();
      if (!s) return; // sqlite: no pool
      this.labels("total").set(s.total);
      this.labels("idle").set(s.idle);
      this.labels("waiting").set(s.waiting);
    },
  });
  new client.Gauge({
    name: "ollamas_migration_version",
    help: "Highest applied schema migration version",
    registers: [register],
    async collect() { this.set(await store.migrationVersion()); },
  });
  new client.Gauge({
    name: "ollamas_webhook_queue_depth",
    help: "Webhook deliveries still pending",
    registers: [register],
    async collect() { this.set(await store.pendingDeliveryCount()); },
  });
}
