// Pure benchmark math — no I/O, fully unit-testable. The command layer
// (commands/bench.ts) feeds it timed samples and renders the aggregates.

export interface RunSample {
  ttfbMs?: number;
  totalMs: number;
  tokPerSec?: number;
  correct: boolean;
}

export interface ModelResult {
  target: string;
  model: string;
  runs: number;
  ttfbMs: number; // median
  totalMs: number; // median
  tokPerSec: number; // mean over runs that reported it
  correctRatio: number; // 0..1
}

// Median of a numeric list (0 for empty). Sorts a copy.
export function median(xs: number[]): number {
  const v = xs.filter((n) => typeof n === "number" && !Number.isNaN(n)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function mean(xs: number[]): number {
  const v = xs.filter((n) => typeof n === "number" && !Number.isNaN(n));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
}

// Collapse N timed samples into one ModelResult. Median for latencies (robust to
// a cold outlier), mean for throughput; correctRatio = fraction that passed.
export function aggregate(target: string, model: string, runs: RunSample[]): ModelResult {
  return {
    target,
    model,
    runs: runs.length,
    ttfbMs: Math.round(median(runs.map((r) => r.ttfbMs ?? r.totalMs))),
    totalMs: Math.round(median(runs.map((r) => r.totalMs))),
    tokPerSec: Number(mean(runs.map((r) => r.tokPerSec ?? 0).filter((n) => n > 0)).toFixed(1)),
    correctRatio: runs.length ? runs.filter((r) => r.correct).length / runs.length : 0,
  };
}

// Pick the most efficient model: among those that produced correct output,
// the highest throughput. Returns null if nothing was correct.
export function pickBest(results: ModelResult[]): ModelResult | null {
  const correct = results.filter((r) => r.correctRatio >= 0.5 && r.tokPerSec > 0);
  if (!correct.length) return null;
  return correct.reduce((best, r) => (r.tokPerSec > best.tokPerSec ? r : best));
}
