// O7 cookbook store — bench measurements + selected primary. O0 persistence
// (server/store, migration v12+) is NOT wired yet (docs/odyssey/05-features/
// cookbook.md K10): until it is, this keeps an honest IN-MEMORY cache and reports
// `persisted:false` so the UI never claims durable state it doesn't have. A JSON-
// only regression is banned by the plan — the seam below is the single swap point.
import type { BenchResult } from "./schema";

const benchCache = new Map<string, BenchResult>();

export const persisted = false; // honest flag (K10) — flip when the v12+ table lands.

export function setBench(model: string, result: BenchResult): void {
  benchCache.set(model, result);
}

export function getBench(model: string): BenchResult | undefined {
  return benchCache.get(model);
}

/** Bench map shaped for recommend()'s `bench` argument. */
export function benchMap(): Record<string, { tps: number; runs: number; pp_tps?: number }> {
  const out: Record<string, { tps: number; runs: number; pp_tps?: number }> = {};
  for (const [k, v] of benchCache) out[k] = { tps: v.tps, runs: v.runs, pp_tps: v.pp_tps };
  return out;
}

/** Test-only reset (module map is process-global). */
export function _resetCookbookStore(): void {
  benchCache.clear();
}
