// Shadow evaluation (Tur-6 research: "continuous counterfactual evaluation") —
// a sampled fraction of live recalls is re-run async against a counterfactual
// pipeline configuration (the graphExpand arm flipped) and the two rankings are
// compared with Rank-Biased Overlap. Degradation or untapped gains surface in
// telemetry BEFORE anyone flips a flag in production. Zero-dep, fire-and-forget,
// GPU-polite: it only ever runs while no local generation is active, and the
// query's embedding is already in the embed cache, so the extra arm is ~free.
import type { BrainRecallHit } from "./brain";
import { llmActive as gpuLlmActive } from "./gpu-coordinator";

/** Rank-Biased Overlap (Webber et al.) for two id rankings, top-weighted.
 *  p is the persistence parameter (0.9 ≈ "the top ~10 ranks matter most").
 *  Pure; two empty rankings agree vacuously (1). */
export function rbo(a: string[], b: string[], p = 0.9): number {
  if (a.length === 0 && b.length === 0) return 1;
  const depth = Math.max(a.length, b.length);
  const seenA = new Set<string>();
  const seenB = new Set<string>();
  let sum = 0;
  let norm = 0;
  for (let d = 1; d <= depth; d++) {
    if (a[d - 1] !== undefined) seenA.add(a[d - 1]);
    if (b[d - 1] !== undefined) seenB.add(b[d - 1]);
    let inter = 0;
    for (const x of seenA) if (seenB.has(x)) inter++;
    const w = Math.pow(p, d - 1);
    sum += (inter / d) * w;
    norm += w; // finite-list normalization: identical prefixes score exactly 1
  }
  return sum / norm;
}

export interface ShadowOpts {
  /** Sampling rate 0..1 (BRAIN_SHADOW_RATE, default 0.05). */
  rate?: number;
  /** Injectable randomness for deterministic tests. */
  rng?: () => number;
  /** Injectable GPU-activity gate (defaults to the real gpu-coordinator). */
  llmActive?: () => boolean;
  /** Injectable telemetry sink (defaults to console JSON, OTel-style). */
  emit?: (e: { event: "brain.shadow"; rbo: number; k: number; arm: string }) => void;
}

/** Fire-and-forget counterfactual arm: re-run the query with graphExpand flipped ON
 *  and report ranking agreement. Never throws, never blocks, never runs under GPU
 *  load. BRAIN_SHADOW=0 disables. */
export async function maybeShadowEval(
  query: string,
  liveHits: Pick<BrainRecallHit, "id">[],
  recall: (q: string, opts: { k?: number; graphExpand?: boolean }) => Promise<Pick<BrainRecallHit, "id">[]>,
  opts: ShadowOpts = {},
): Promise<void> {
  try {
    if (process.env.BRAIN_SHADOW === "0") return;
    const rate = opts.rate ?? (Number(process.env.BRAIN_SHADOW_RATE) || 0.05);
    const rng = opts.rng ?? Math.random;
    const active = opts.llmActive ?? gpuLlmActive;
    if (active()) return; // the GPU belongs to the live generation
    if (rng() >= rate) return;
    const alt = await recall(query, { k: Math.max(liveHits.length, 5), graphExpand: true });
    const score = rbo(liveHits.map((h) => h.id), alt.map((h) => h.id));
    const emit =
      opts.emit ?? ((e: { event: string }) => console.log(JSON.stringify(e)));
    emit({ event: "brain.shadow", rbo: Number(score.toFixed(4)), k: liveHits.length, arm: "graphExpand" });
  } catch {
    /* shadow work must never surface as a user-visible failure */
  }
}
