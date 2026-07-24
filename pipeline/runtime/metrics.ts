// Prometheus surface for the pipeline (I/O boundary).
//
// WHY THIS EXISTS
// The prompt: "every action must push metrics to a Prometheus histogram named
// `workflow_step_duration_seconds{step="<action>"}`". The repo already exposes a live
// prom-client registry at GET /metrics (server/metrics.ts) with default Node metrics, HTTP
// duration and brain gauges on it. So the pipeline registers ON THAT REGISTRY — a second
// registry would mean a second scrape endpoint and metrics that never appear where the
// operator already looks.
//
// A Pushgateway (as the prompt's CI snippet suggests) is deliberately NOT introduced: it is
// another always-on service on a machine already under swap pressure, and it buys nothing
// here because the runs are local and the scrape target is already up.
import client from "prom-client";
import { register } from "../../server/metrics";

/**
 * Register once, reuse forever.
 *
 * prom-client THROWS on a duplicate metric name, and this module is imported by the runner,
 * the CLI and the tests inside one process. `getSingleMetric` makes registration idempotent
 * so importing twice degrades to a lookup instead of crashing the run it was meant to measure.
 */
function histogram(name: string, help: string, buckets: number[]): client.Histogram<string> {
  const existing = register.getSingleMetric(name) as client.Histogram<string> | undefined;
  return existing ?? new client.Histogram({ name, help, labelNames: ["step", "action", "profile"], buckets, registers: [register] });
}

function counter(name: string, help: string): client.Counter<string> {
  const existing = register.getSingleMetric(name) as client.Counter<string> | undefined;
  return existing ?? new client.Counter({ name, help, labelNames: ["step", "action", "profile"], registers: [register] });
}

// Buckets span 10 ms → 30 s because the measured spread is that wide: `search` via the local
// capsule layer lands in tens of milliseconds while a cold `sandbox_test` container takes
// seconds. Linear buckets would put every step of interest in one bin.
const LATENCY_BUCKETS = [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 3, 5, 10, 30];

export const stepDuration = histogram(
  "workflow_step_duration_seconds",
  "Pipeline step wall-clock duration in seconds",
  LATENCY_BUCKETS,
);

export const stepCpu = histogram(
  "workflow_step_cpu_seconds",
  "Pipeline step CPU time in seconds",
  LATENCY_BUCKETS,
);

export const stepMemory = histogram(
  "workflow_step_memory_bytes",
  "Pipeline step peak RSS in bytes",
  [64e6, 128e6, 256e6, 512e6, 1e9, 2e9, 4e9],
);

export const stepErrors = counter("workflow_step_errors_total", "Pipeline step failures");
export const stepCacheHits = counter("workflow_step_cache_hits_total", "Pipeline step cache hits");
export const runsTotal = counter("workflow_runs_total", "Completed pipeline runs");

export interface ObserveInput {
  step: string;
  action: string;
  profile: string;
  durationMs: number;
  cpuMs?: number;
  memBytes?: number;
  ok: boolean;
  cacheHit?: boolean;
}

/**
 * Record one step. Never throws.
 *
 * A metrics failure must not fail the workflow it is observing — that would turn the
 * observability layer into a new source of outages, which is the opposite of its job.
 * Same defensive posture as brain-metrics.ts, which try/catches every collect for the same
 * reason.
 */
export function observeStep(i: ObserveInput): void {
  const labels = { step: i.step, action: i.action, profile: i.profile };
  try {
    stepDuration.observe(labels, i.durationMs / 1000);
    if (i.cpuMs !== undefined) stepCpu.observe(labels, i.cpuMs / 1000);
    if (i.memBytes !== undefined) stepMemory.observe(labels, i.memBytes);
    if (!i.ok) stepErrors.inc(labels);
    if (i.cacheHit) stepCacheHits.inc(labels);
  } catch {
    /* observability must never break the run */
  }
}

export function observeRun(profile: string): void {
  try {
    runsTotal.inc({ profile, step: "run", action: "run" });
  } catch {
    /* see observeStep */
  }
}

/** Did anything actually get recorded? Feeds the self-audit's `metricsObserved` fact. */
export async function metricsObserved(): Promise<boolean> {
  try {
    const m = await (register.getSingleMetric("workflow_step_duration_seconds") as client.Histogram<string>)?.get();
    return Boolean(m?.values?.length);
  } catch {
    return false;
  }
}

export { register };
