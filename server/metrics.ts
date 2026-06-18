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
