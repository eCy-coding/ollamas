// server/selftest-plan.ts — pure gating decision for /api/selftest's live LLM gates.
//
// The single source of truth for "which mode runs which probe". The fix it encodes: the live
// agent-loop + pipeline gates must run whenever ollama can be reached — `degraded-live` INCLUDED,
// not just full `live`. `degraded-live` only means the boot-time reachability probe failed once
// (cold/contended box); ollama is often still reachable (G2 proves it via the same path). Gating
// those gates on `=== "live"` made them dishonestly skip in degraded-live (the contention mode the
// dashboard most needs the truth for). This mirrors the already-correct G1/G2 rule (`!== "demo"`).
//
// Only true `demo` (a cloud sandbox with no local ollama daemon) skips the local probes.

export type SelftestMode = "live" | "degraded-live" | "demo";

export interface SelftestProbePlan {
  /** G2 — probe ollama health. */
  probeOllama: boolean;
  /** G8 — run the real ReAct tool-loop verification. */
  runAgentLoop: boolean;
  /** G3 — which provider/model the pipeline-fallback gate drives, and the source it expects. */
  pipelineProvider: "ollama-local" | "demo";
  pipelineModel: string;
  expectedSource: "ollama_local" | "demo";
}

/** Decide the live-probe plan for a selftest run. Pure. */
export function selftestProbePlan(mode: SelftestMode): SelftestProbePlan {
  const local = mode !== "demo"; // run the real local probes unless we're a cloud demo sandbox
  return {
    probeOllama: local,
    runAgentLoop: local,
    pipelineProvider: local ? "ollama-local" : "demo",
    pipelineModel: local ? "qwen3:8b" : "simulation",
    expectedSource: local ? "ollama_local" : "demo",
  };
}
