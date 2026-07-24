// Benchmark statistics (pure) — percentiles, dispersion, confidence intervals.
//
// WHY THIS EXISTS
// The master prompt is explicit: report p50/p95/p99/p999, run each configuration ≥3 times
// (5 in the CI spec), and record variance — because "average latency is misleading" and a
// benchmark without repetition is "expensive noise". The repo already had `median()` and
// `mean()` in cli/lib/bench.ts (reused here, not reimplemented), but nothing above the
// median: no tail percentiles, no standard deviation, no confidence interval. A tail-latency
// SLO cannot be evaluated from a median, so the gate had nothing to read.
import { median, mean } from "../../cli/lib/bench";

export { median, mean };

/**
 * Nearest-rank percentile on a sorted copy (0 for empty input).
 *
 * Nearest-rank rather than interpolation: with the 5 runs the spec prescribes, an
 * interpolated "p99" would be a number that no run ever produced. Nearest-rank always
 * returns an OBSERVED sample, which is what a latency budget should be judged against.
 */
export function percentile(xs: number[], p: number): number {
  const v = xs.filter((n) => typeof n === "number" && Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return 0;
  if (p <= 0) return v[0];
  if (p >= 100) return v[v.length - 1];
  const rank = Math.ceil((p / 100) * v.length);
  return v[Math.min(rank, v.length) - 1];
}

/** Sample standard deviation (n−1). Returns 0 for fewer than 2 samples. */
export function stddev(xs: number[]): number {
  const v = xs.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (v.length < 2) return 0;
  const m = mean(v);
  return Math.sqrt(v.reduce((a, x) => a + (x - m) ** 2, 0) / (v.length - 1));
}

/** Coefficient of variation (stddev / mean). A run set above ~0.3 is too noisy to trust. */
export function cv(xs: number[]): number {
  const m = mean(xs);
  return m === 0 ? 0 : stddev(xs) / m;
}

// Two-sided 95% t-distribution critical values, indexed by degrees of freedom (n−1).
// Table rather than a dependency: the spec asks for 3–5 runs, so df ∈ [2,4] covers every
// real case and the z-approximation (1.96) is only reached for large n — where it is correct.
const T95: Record<number, number> = { 1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228 };

/** 95% confidence interval of the mean. Degenerate (lo = hi = the value) for n < 2. */
export function ci95(xs: number[]): { lo: number; hi: number; margin: number } {
  const v = xs.filter((n) => typeof n === "number" && Number.isFinite(n));
  const m = mean(v);
  if (v.length < 2) return { lo: m, hi: m, margin: 0 };
  const t = T95[v.length - 1] ?? 1.96;
  const margin = t * (stddev(v) / Math.sqrt(v.length));
  return { lo: m - margin, hi: m + margin, margin };
}

export interface Summary {
  n: number;
  min: number;
  p50: number;
  p95: number;
  p99: number;
  p999: number;
  max: number;
  mean: number;
  stddev: number;
  cv: number;
  ci95_lo: number;
  ci95_hi: number;
}

/** Collapse a sample set into the full distribution the report and the gates both read. */
export function summarize(xs: number[]): Summary {
  const v = xs.filter((n) => typeof n === "number" && Number.isFinite(n));
  const c = ci95(v);
  return {
    n: v.length,
    min: v.length ? Math.min(...v) : 0,
    p50: percentile(v, 50),
    p95: percentile(v, 95),
    p99: percentile(v, 99),
    p999: percentile(v, 99.9),
    max: v.length ? Math.max(...v) : 0,
    mean: Number(mean(v).toFixed(3)),
    stddev: Number(stddev(v).toFixed(3)),
    cv: Number(cv(v).toFixed(3)),
    ci95_lo: Number(c.lo.toFixed(3)),
    ci95_hi: Number(c.hi.toFixed(3)),
  };
}

/**
 * Is this run set statistically usable, per the prompt's "≥3 independent runs" rule?
 *
 * Two independent reasons to reject, reported separately so the operator knows which to fix:
 * too few runs (add repetitions) versus too much spread (stabilise the environment).
 * Returning `stable: false` never fails the build by itself — it marks the numbers as noisy
 * so a passing SLO built on them is not quietly trusted.
 */
export function runSetQuality(xs: number[], minRuns = 3, maxCv = 0.3):
  { enough: boolean; stable: boolean; reason: string } {
  const n = xs.filter((v) => Number.isFinite(v)).length;
  const enough = n >= minRuns;
  const c = cv(xs);
  const stable = c <= maxCv;
  const reason = !enough ? `only ${n} run(s), need ≥${minRuns}`
    : !stable ? `cv=${c.toFixed(2)} > ${maxCv} (noisy environment)`
    : "ok";
  return { enough, stable, reason };
}

/** Per-step distributions from many runs: `stepId → summary of that step's durations`. */
export function summarizeSteps(runs: Array<Record<string, number>>): Record<string, Summary> {
  const byStep: Record<string, number[]> = {};
  for (const r of runs) {
    for (const [step, ms] of Object.entries(r ?? {})) {
      (byStep[step] ??= []).push(ms);
    }
  }
  const out: Record<string, Summary> = {};
  for (const [step, xs] of Object.entries(byStep)) out[step] = summarize(xs);
  return out;
}
