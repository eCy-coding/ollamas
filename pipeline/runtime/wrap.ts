// benchmark_start / benchmark_step / benchmark_end (I/O boundary).
//
// WHY THIS EXISTS
// The prompt's phase 0 wraps every later step so latency, CPU, memory and exit-code are
// recorded uniformly, and `benchmark_start` captures the environment metadata that makes a
// run reproducible (hardware, OS, git SHA, run_id). Doing this per-step by hand is how the
// original workflow ended up with "no built-in metrics, traces, or logs".
//
// This module only SAMPLES and DISPATCHES: the arithmetic is in lib/timing.ts and the
// Prometheus surface is in runtime/metrics.ts, both tested independently.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpus, totalmem, release, arch, platform } from "node:os";
import type { EnvMeta, StepRecord } from "../lib/report";
import { toStepRecord, type ResourceSample, type StepOutcome } from "../lib/timing";
import { observeStep, observeRun } from "./metrics";

/** One resource sample. Monotonic clock — wall-clock jumps must not become negative deltas. */
export function sample(): ResourceSample {
  const c = process.cpuUsage();
  return {
    t: Number(process.hrtime.bigint() / 1_000_000n),
    cpuUs: c.user + c.system,
    rssBytes: process.memoryUsage().rss,
  };
}

/**
 * Git SHA of the working tree, or `"unknown"`.
 *
 * `execFileSync` (no shell) and a hard failure path: a benchmark that cannot identify the
 * code it measured is still worth running, but it must SAY so rather than record a
 * plausible-looking placeholder — the whole point of the field is audit trail.
 */
function gitSha(cwd = process.cwd()): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "unknown";
  }
}

export function benchmarkStart(notes: string[] = []): { env: EnvMeta; started: ResourceSample } {
  return {
    env: {
      timestamp: new Date().toISOString(),
      run_id: randomUUID(),
      git_sha: gitSha(),
      os: `${platform()} ${release()}`,
      arch: arch(),
      cpu_count: cpus().length,
      mem_gb: Number((totalmem() / 1e9).toFixed(1)),
      node: process.version,
      notes,
    },
    started: sample(),
  };
}

export interface StepContext {
  id: string;
  action: string;
  profile: string;
  cacheHit?: boolean;
  invocation?: string;
}

/**
 * Run one step, measured. A thrown step becomes a FAILED record, not a crashed pipeline.
 *
 * Rationale: the prompt wants an error-rate metric and a binary decision. If the first
 * failing step aborted the process, error-rate would be unmeasurable (there would be no
 * report at all) and every downstream gate would report MISS for the wrong reason. The
 * runner decides whether a failure is fatal; the wrapper's job is to make sure it is
 * RECORDED either way.
 */
export async function benchmarkStep<T>(
  ctx: StepContext,
  fn: () => Promise<T> | T,
): Promise<{ record: StepRecord; value: T | null }> {
  const start = sample();
  let ok = true;
  let error: string | undefined;
  let value: T | null = null;
  try {
    value = await fn();
  } catch (e) {
    ok = false;
    error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }
  const end = sample();
  const outcome: StepOutcome = {
    id: ctx.id,
    action: ctx.action,
    ok,
    error,
    cacheHit: ctx.cacheHit,
    invocation: ctx.invocation,
    outputExcerpt: typeof value === "string" ? value : value == null ? undefined : safeJson(value),
  };
  const record = toStepRecord(outcome, start, end);
  observeStep({
    step: ctx.id,
    action: ctx.action,
    profile: ctx.profile,
    durationMs: record.duration_ms,
    cpuMs: record.cpu_ms,
    memBytes: record.mem_bytes,
    ok,
    cacheHit: ctx.cacheHit,
  });
  return { record, value };
}

/** Excerpt-safe stringify: a circular result must not throw inside the measurement layer. */
function safeJson(v: unknown): string | undefined {
  try {
    return JSON.stringify(v);
  } catch {
    return "[unserialisable]";
  }
}

export function benchmarkEnd(profile: string): ResourceSample {
  observeRun(profile);
  return sample();
}
