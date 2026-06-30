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
