/**
 * orchestration/bin/lib/bench.ts — Benchmark agregasyon (zero-dep, pure).
 *
 * ~/.llm-mission-control/{benchmark,cli-bench,calibration}.json tok/s snapshot'larını
 * normalize → model×device agrege (median/p95/MAD, mean DEĞİL) → en-verimli-doğru rank →
 * calibration baseline'a göre regresyon. Native stats + unicode sparkline (dep yok).
 * Metodoloji ref: hyperfine/criterion (median>mean, Tukey IQR). tok/s format: mlx-lm/llama.cpp.
 */

export interface BenchRecord { device: string; model: string; tokS: number; latencyMs: number; correct: boolean; ts: string; source: string; }
export interface Agg { model: string; device: string; n: number; medianTokS: number; p95: number; mad: number; min: number; max: number; correctRatio: number; }
export interface Regression { model: string; device: string; baseTokS: number; medianTokS: number; dropPct: number; }

// ── Stats (inline, simple-statistics ISC deseni — dep değil) ──────────────────

export function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function percentile(nums: number[], p: number): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

/** Median absolute deviation (outlier-robust yayılım). */
export function mad(nums: number[]): number {
  if (!nums.length) return 0;
  const med = median(nums);
  return median(nums.map((x) => Math.abs(x - med)));
}

export function stddev(nums: number[]): number {
  if (nums.length < 2) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  return Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1));
}

const BLOCKS = "▁▂▃▄▅▆▇█";
/** Unicode sparkline (min–max → 8 seviye). Boş/tek-değer güvenli. */
export function sparkline(nums: number[]): string {
  if (!nums.length) return "";
  const min = Math.min(...nums), max = Math.max(...nums);
  if (max === min) return BLOCKS[3].repeat(nums.length);
  return nums.map((v) => BLOCKS[Math.min(7, Math.floor(((v - min) / (max - min)) * 8))]).join("");
}

// ── Normalize (3 şema → BenchRecord[]) ────────────────────────────────────────

/** Provider prefix'i at: "ollama-local/qwen3:8b" → "qwen3:8b" (baseline eşlemesi için). */
export function normModel(m: string): string { return (m || "").split("/").pop() || m; }

/** benchmark.json: {ts, results:[{model, tok_s, total_ms, correct}]} → device=mac. */
export function normalizeBenchmark(obj: any): BenchRecord[] {
  const ts = obj?.ts || "";
  return (obj?.results || [])
    .filter((r: any) => typeof r?.tok_s === "number" && r.tok_s > 0)
    .map((r: any): BenchRecord => ({
      device: "mac", model: normModel(r.model), tokS: r.tok_s,
      latencyMs: r.total_ms ?? r.gen_ms ?? 0, correct: !!r.correct, ts, source: "benchmark.json",
    }));
}

/** cli-bench.json: {ts, targets:[{target, results:[{model, tokPerSec, totalMs, correctRatio}]}]}. */
export function normalizeCliBench(obj: any): BenchRecord[] {
  const ts = obj?.ts || "";
  const out: BenchRecord[] = [];
  for (const t of obj?.targets || []) {
    for (const r of t?.results || []) {
      if (typeof r?.tokPerSec !== "number" || r.tokPerSec <= 0) continue;
      out.push({
        device: t.target || r.target || "?", model: normModel(r.model), tokS: r.tokPerSec,
        latencyMs: r.totalMs ?? r.ttfbMs ?? 0, correct: (r.correctRatio ?? 0) >= 1, ts, source: "cli-bench.json",
      });
    }
  }
  return out;
}

/** calibration.json benchmark.ranked → baseline Map(normModel → tok_s). */
export function baselineFromCalibration(obj: any): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of obj?.benchmark?.ranked || []) {
    if (typeof r?.tok_s === "number" && r.tok_s > 0) m.set(normModel(r.model), r.tok_s);
  }
  return m;
}

// ── Aggregate / rank / regression ─────────────────────────────────────────────

export function aggregate(records: BenchRecord[]): Agg[] {
  const groups = new Map<string, BenchRecord[]>();
  for (const r of records) {
    const k = `${r.model}@${r.device}`;
    (groups.get(k) || groups.set(k, []).get(k)!).push(r);
  }
  const out: Agg[] = [];
  for (const [k, rs] of groups) {
    const [model, device] = k.split("@");
    const toks = rs.map((r) => r.tokS);
    const corr = rs.filter((r) => r.correct).length;
    out.push({
      model, device, n: rs.length,
      medianTokS: round(median(toks)), p95: round(percentile(toks, 95)), mad: round(mad(toks)),
      min: round(Math.min(...toks)), max: round(Math.max(...toks)), correctRatio: round(corr / rs.length),
    });
  }
  return out.sort((a, b) => b.medianTokS - a.medianTokS);
}

/** Cihaz başına en-verimli DOĞRU model (correctRatio>0.9). */
export function rankEfficient(aggs: Agg[]): Map<string, Agg> {
  const best = new Map<string, Agg>();
  for (const a of aggs) {
    if (a.correctRatio <= 0.9 || a.medianTokS <= 0) continue;
    const cur = best.get(a.device);
    if (!cur || a.medianTokS > cur.medianTokS) best.set(a.device, a);
  }
  return best;
}

/** Baseline'a göre %10+ tok/s düşüşü = regresyon. */
export function regressions(aggs: Agg[], baseline: Map<string, number>, thresholdPct = 10): Regression[] {
  const out: Regression[] = [];
  for (const a of aggs) {
    const base = baseline.get(a.model);
    if (!base || base <= 0) continue;
    const dropPct = ((base - a.medianTokS) / base) * 100;
    if (dropPct > thresholdPct) out.push({ model: a.model, device: a.device, baseTokS: base, medianTokS: a.medianTokS, dropPct: round(dropPct) });
  }
  return out;
}

function round(n: number): number { return Math.round(n * 10) / 10; }

/**
 * Bench verisi bayat mı? ts (ISO) `maxDays`'ten eski → true. Geçersiz/boş ts → true
 * (bilinmeyen tazelik = güvenli-stale; "0 manuel" akışında re-bench tetikler). nowMs test için param.
 */
export function isStale(ts: string, maxDays = 2, nowMs = Date.now()): boolean {
  const t = Date.parse(ts || "");
  if (!Number.isFinite(t)) return true;
  return (nowMs - t) / 86_400_000 > maxDays;
}
