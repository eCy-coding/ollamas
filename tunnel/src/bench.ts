// Per-transport benchmark (vT8): stable p50/p90 latency over N samples — diagnostic visibility
// for "en verimli seçim" (live selectAuto already scores on a single measured sample; this gives
// a stable distribution). Adoption (idea only): nearest-rank percentile (Last9/OneUptime) — p99
// needs ≥100 samples so we report p50/p90 + min/max/mean for our small N (honest, no fake p99).
//
// percentile/summarize PURE; benchmarkTransports uses an injectable timeProbe (no network in tests).

import type { Transport } from "./transport.ts";
import type { TimeProbe } from "./switch.ts";
import { sparkline } from "./status.ts";

export interface Summary {
  count: number;
  min: number;
  max: number;
  mean: number;
  p50: number;
  p90: number;
}

const EMPTY_SUMMARY: Summary = { count: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0 };

/** PURE: nearest-rank percentile (p in 0..100) of an ascending-sorted array. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedAsc.length);
  const clamped = Math.min(Math.max(idx, 1), sortedAsc.length);
  return sortedAsc[clamped - 1] ?? 0;
}

/** PURE: summarize a latency sample set (finite values only). Empty → zeros. */
export function summarize(values: number[]): Summary {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { ...EMPTY_SUMMARY };
  const sorted = [...finite].sort((a, b) => a - b);
  const sum = sorted.reduce((acc, v) => acc + v, 0);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
  };
}

export interface BenchResult {
  name: string;
  priority: number;
  /** Fraction of samples that probed healthy (0..1). */
  healthyRatio: number;
  /** Latency summary over the HEALTHY samples. */
  summary: Summary;
  /** Raw healthy latencies (for sparkline), oldest→newest. */
  samples: number[];
}

export interface BenchOptions {
  samples?: number;
  timeProbe?: TimeProbe;
}

async function realTimeProbe(t: Transport): Promise<{ ok: boolean; ms: number }> {
  const start = performance.now();
  const ok = await t.probe();
  return { ok, ms: performance.now() - start };
}

/** Run N timed probes per transport, summarizing healthy-sample latency. Never throws. */
export async function benchmarkTransports(
  transports: Transport[],
  opts: BenchOptions = {},
): Promise<BenchResult[]> {
  const samples = Math.max(1, opts.samples ?? 5);
  const timeProbe = opts.timeProbe ?? realTimeProbe;
  const out: BenchResult[] = [];
  for (const t of transports) {
    const lat: number[] = [];
    let healthy = 0;
    for (let i = 0; i < samples; i++) {
      const { ok, ms } = await timeProbe(t);
      if (ok) {
        healthy += 1;
        lat.push(ms);
      }
    }
    out.push({
      name: t.name,
      priority: t.priority,
      healthyRatio: healthy / samples,
      summary: summarize(lat),
      samples: lat,
    });
  }
  return out;
}

/** PURE: human-readable benchmark table (best p50 first; sparkline of healthy samples). */
export function renderBenchTable(results: BenchResult[]): string {
  if (results.length === 0) return "no transports to benchmark";
  const rows = [...results].sort((a, b) => {
    // Healthy transports first, then lowest p50.
    if (a.healthyRatio === 0 && b.healthyRatio === 0) return a.priority - b.priority;
    if (a.healthyRatio === 0) return 1;
    if (b.healthyRatio === 0) return -1;
    return a.summary.p50 - b.summary.p50;
  });
  const lines = ["transport    healthy   p50     p90     min     max     spark"];
  for (const r of rows) {
    const pct = `${Math.round(r.healthyRatio * 100)}%`;
    const f = (n: number) => (r.summary.count ? `${n.toFixed(0)}ms` : "-");
    lines.push(
      `${r.name.padEnd(12)} ${pct.padStart(5)}  ${f(r.summary.p50).padStart(6)}  ${f(r.summary.p90).padStart(6)}  ${f(r.summary.min).padStart(6)}  ${f(r.summary.max).padStart(6)}  ${sparkline(r.samples)}`,
    );
  }
  return lines.join("\n");
}
