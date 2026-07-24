// Timing math (pure) — turn two resource samples into one step record.
//
// WHY THIS EXISTS
// The prompt requires every action to record wall-clock, CPU-seconds, peak memory and exit
// status, and to push them to `workflow_step_duration_seconds{step="<action>"}`. Taking the
// samples is I/O (`process.cpuUsage`, `process.memoryUsage`, the clock); turning two samples
// into a record is arithmetic — and it is the part that can be wrong in ways nobody notices:
// a CPU delta in the wrong unit, or a negative duration from a clock adjustment, silently
// corrupts every percentile computed downstream.
//
// So the arithmetic lives here, takes its samples as ARGUMENTS, and is unit-tested; the
// runtime wrapper (pipeline/runtime/wrap.ts) only collects the samples and hands them over.
import type { StepRecord } from "./report";

export interface ResourceSample {
  /** Monotonic milliseconds (performance.now / hrtime), NOT wall-clock date. */
  t: number;
  /** Cumulative CPU microseconds (user + system), as `process.cpuUsage()` reports. */
  cpuUs: number;
  /** Resident set size in bytes at sample time. */
  rssBytes: number;
}

export interface StepOutcome {
  id: string;
  action: string;
  ok: boolean;
  error?: string;
  cacheHit?: boolean;
  invocation?: string;
  outputExcerpt?: string;
}

/**
 * Never emit a negative duration.
 *
 * A monotonic source should not go backwards, but samples can arrive out of order across
 * async boundaries, and one negative sample poisons a percentile far more than a zero does
 * — it can make p50 smaller than min and turn an SLO breach into a pass.
 */
export function deltaMs(start: ResourceSample, end: ResourceSample): number {
  return Math.max(0, Number((end.t - start.t).toFixed(3)));
}

/** CPU delta in MILLIseconds — `process.cpuUsage()` counts microseconds. */
export function cpuMs(start: ResourceSample, end: ResourceSample): number {
  return Math.max(0, Number(((end.cpuUs - start.cpuUs) / 1000).toFixed(3)));
}

/**
 * Peak RSS across the samples, not the delta.
 *
 * Memory is a level, not a counter: a step that allocates 400 MB and frees it before the
 * end sample has a delta near zero while having been the reason the machine swapped. The
 * budget the prompt sets ("memory < 1 GB per worker") is a level, so a level is reported.
 */
export function peakRss(start: ResourceSample, end: ResourceSample): number {
  return Math.max(start.rssBytes, end.rssBytes);
}

/** Assemble the record the report and the metrics layer both consume. */
export function toStepRecord(o: StepOutcome, start: ResourceSample, end: ResourceSample): StepRecord {
  return {
    id: o.id,
    action: o.action,
    ok: o.ok,
    duration_ms: deltaMs(start, end),
    cpu_ms: cpuMs(start, end),
    mem_bytes: peakRss(start, end),
    ...(o.cacheHit === undefined ? {} : { cache_hit: o.cacheHit }),
    ...(o.error ? { error: o.error } : {}),
    ...(o.invocation ? { invocation: o.invocation } : {}),
    ...(o.outputExcerpt ? { output_excerpt: excerpt(o.outputExcerpt) } : {}),
  };
}

/**
 * Bound raw output kept as evidence.
 *
 * Evidence has to be checkable without re-running the step, but an unbounded excerpt turns
 * a benchmark report into a log dump — the same token-waste this stack spent its last
 * calibration removing. 600 chars keeps a command's answer and the shape of a stack trace.
 */
export function excerpt(s: string, max = 600): string {
  const one = String(s ?? "").replace(/\s+/g, " ").trim();
  return one.length <= max ? one : `${one.slice(0, max)}…(+${one.length - max}B)`;
}

/** `stepId → duration_ms` for one run, the shape `stats.summarizeSteps` aggregates. */
export function durationsOf(steps: StepRecord[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of steps) out[s.id] = s.duration_ms;
  return out;
}

/**
 * Wall-clock total of the whole workflow.
 *
 * Deliberately NOT the sum of step durations: steps that ran concurrently would be counted
 * once each, inflating the total and making a parallel pipeline look slower than a serial
 * one. Callers pass the run's own start/end samples.
 */
export function totalMs(runStart: ResourceSample, runEnd: ResourceSample): number {
  return deltaMs(runStart, runEnd);
}

/** Sum of step durations — reported ALONGSIDE the wall clock; their ratio is real concurrency. */
export function cpuBoundMs(steps: StepRecord[]): number {
  return Number(steps.reduce((a, s) => a + s.duration_ms, 0).toFixed(3));
}

/**
 * Observed concurrency = Σ(step durations) / wall-clock.
 *
 * `dag.parallelismFactor` says how parallel the plan IS; this says how parallel the run
 * WAS. They diverge when a "parallel" wave serialises on a shared resource, which is
 * exactly the kind of silent regression a benchmark exists to catch.
 */
export function observedConcurrency(steps: StepRecord[], wallMs: number): number {
  if (wallMs <= 0) return 1;
  return Number((cpuBoundMs(steps) / wallMs).toFixed(2));
}
