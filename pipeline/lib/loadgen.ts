// Load-model scheduling (pure).
//
// WHY THIS EXISTS
// The prompt prescribes two load models — closed-loop (max-concurrency N, next request only
// after the previous finishes) and open-loop (fixed arrival rate) — because they expose
// different failures: closed-loop finds resource saturation, open-loop finds queueing under
// a traffic spike. It names k6/Artillery as the generators.
//
// Neither is installed on this machine, and adding one would mean a new heavyweight
// dependency on a laptop already under swap pressure. What k6 actually contributes here is
// arithmetic — WHEN each virtual user starts — plus a summary format. Both are reproduced
// here in ~80 lines with no dependency, and the summary is emitted in a k6-compatible shape
// so an operator who later installs k6 can diff the two.
//
// The scheduling is pure and tested; the execution lives in bin/bench.ts.

export type LoadModel = "closed" | "open";

export interface LoadConfig {
  model: LoadModel;
  /** closed-loop: simultaneous virtual users. */
  maxConcurrency?: number;
  /** open-loop: requested arrivals per second. */
  arrivalRateRps?: number;
  /** Total iterations to schedule. */
  iterations: number;
  /** Iterations discarded before measurement — the prompt's mandatory warm-up. */
  warmup?: number;
}

export interface ScheduledItem {
  index: number;
  /** Milliseconds after start when this iteration should begin. 0 for closed-loop. */
  atMs: number;
  /** Excluded from percentiles: warm-up traffic measures the cold path, not steady state. */
  warmup: boolean;
}

export class LoadError extends Error {}

/**
 * Turn a load config into a concrete schedule.
 *
 * Closed-loop items all carry `atMs = 0`: their pacing is determined by completion, not by
 * the clock, so the executor releases the next item when a slot frees. Open-loop items carry
 * an absolute offset — that is the whole point of the model, and computing it up front means
 * a slow system FALLS BEHIND its schedule (visible as queueing) instead of silently slowing
 * the arrival rate to match, which would hide the very saturation being measured.
 */
export function schedule(cfg: LoadConfig): ScheduledItem[] {
  const warmup = Math.max(0, cfg.warmup ?? 0);
  const total = cfg.iterations + warmup;
  if (cfg.iterations <= 0) throw new LoadError("iterations must be > 0");
  if (cfg.model === "closed") {
    const c = cfg.maxConcurrency ?? 1;
    if (c <= 0) throw new LoadError("maxConcurrency must be > 0");
    return Array.from({ length: total }, (_, i) => ({ index: i, atMs: 0, warmup: i < warmup }));
  }
  const rps = cfg.arrivalRateRps ?? 1;
  if (rps <= 0) throw new LoadError("arrivalRateRps must be > 0");
  const gap = 1000 / rps;
  return Array.from({ length: total }, (_, i) => ({
    index: i,
    atMs: Number((i * gap).toFixed(3)),
    warmup: i < warmup,
  }));
}

/** Wall-clock the schedule implies if the system keeps up (open-loop only; 0 for closed). */
export function plannedDurationMs(cfg: LoadConfig): number {
  const s = schedule(cfg);
  return s.length ? s[s.length - 1].atMs : 0;
}

export interface Arrival {
  index: number;
  /** Planned start offset. */
  atMs: number;
  /** Actual start offset. */
  startedMs: number;
  durationMs: number;
  ok: boolean;
  warmup: boolean;
}

export interface LoadSummary {
  model: LoadModel;
  iterations: number;
  warmupDiscarded: number;
  /** Iterations that started late, i.e. the generator could not keep up (open-loop). */
  behindSchedule: number;
  maxLagMs: number;
  achievedRps: number;
  errorRatePct: number;
  /** Measured durations with warm-up removed — what the percentiles are computed from. */
  durations: number[];
}

/**
 * Reduce arrivals to the summary the report consumes.
 *
 * `behindSchedule` / `maxLag` matter more than the raw latency numbers in open-loop: if the
 * generator itself fell behind, the reported latency is measuring the harness, not the
 * system, and the numbers must be read with that in mind rather than trusted flat.
 */
export function summarizeLoad(model: LoadModel, arrivals: Arrival[], wallMs: number): LoadSummary {
  const measured = arrivals.filter((a) => !a.warmup);
  const late = measured.filter((a) => a.startedMs > a.atMs + 50);
  const errs = measured.filter((a) => !a.ok).length;
  return {
    model,
    iterations: measured.length,
    warmupDiscarded: arrivals.length - measured.length,
    behindSchedule: late.length,
    maxLagMs: late.length ? Math.round(Math.max(...late.map((a) => a.startedMs - a.atMs))) : 0,
    achievedRps: wallMs > 0 ? Number(((measured.length / wallMs) * 1000).toFixed(2)) : 0,
    errorRatePct: measured.length ? Number(((errs / measured.length) * 100).toFixed(4)) : 0,
    durations: measured.map((a) => a.durationMs),
  };
}

/** k6-shaped summary so results can be diffed against a real k6 run later. */
export function toK6Summary(s: LoadSummary, pct: { p50: number; p95: number; p99: number }): Record<string, unknown> {
  return {
    metrics: {
      iterations: { count: s.iterations, rate: s.achievedRps },
      iteration_duration: { med: pct.p50, "p(95)": pct.p95, "p(99)": pct.p99 },
      checks: { fails: Math.round((s.errorRatePct / 100) * s.iterations), passes: s.iterations },
      dropped_iterations: { count: s.behindSchedule },
    },
    ecym: { model: s.model, warmup_discarded: s.warmupDiscarded, max_lag_ms: s.maxLagMs },
  };
}
