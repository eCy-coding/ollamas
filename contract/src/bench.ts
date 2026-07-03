// Latency stats for calibration (vK18). Pattern re-implemented from tunnel/src/bench.ts
// (lanes stay isolated — no cross-import). PURE, zero-dep.

export type Summary = { count: number; min: number; max: number; mean: number; p50: number; p90: number; p99: number };

const EMPTY: Summary = { count: 0, min: 0, max: 0, mean: 0, p50: 0, p90: 0, p99: 0 };

/** Nearest-rank percentile (p in 0..100) of an ascending-sorted array. */
export function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedAsc.length);
  const clamped = Math.min(Math.max(idx, 1), sortedAsc.length);
  return sortedAsc[clamped - 1] ?? 0;
}

export function summarize(values: number[]): Summary {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return { ...EMPTY };
  const sorted = [...finite].sort((a, b) => a - b);
  const sum = sorted.reduce((a, v) => a + v, 0);
  return {
    count: sorted.length,
    min: sorted[0] ?? 0,
    max: sorted[sorted.length - 1] ?? 0,
    mean: sum / sorted.length,
    p50: percentile(sorted, 50),
    p90: percentile(sorted, 90),
    p99: percentile(sorted, 99),
  };
}

const f = (n: number) => (n < 1 ? n.toFixed(4) : n.toFixed(3));

export function renderTable(rows: Array<{ label: string; summary: Summary }>): string {
  const head = "| path | n | min | mean | p50 | p90 | p99 | max | (ms) |\n|---|--:|--:|--:|--:|--:|--:|--:|--|";
  const body = rows.map((r) => {
    const s = r.summary;
    return `| ${r.label} | ${s.count} | ${f(s.min)} | ${f(s.mean)} | ${f(s.p50)} | ${f(s.p90)} | ${f(s.p99)} | ${f(s.max)} | |`;
  });
  return [head, ...body].join("\n");
}
