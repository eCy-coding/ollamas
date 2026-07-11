// O2 research module service — thin wrapper: run the shared pipeline
// (server/research/pipeline.ts, the SAME composition the deep_research agent
// tool uses) and persist the result via store.ts's O0 _core/store facade.
import { runDeepResearch, _setResearchPipelineTestDeps } from "../../research/pipeline";
import type { EngineDeps } from "../../research/engine";
import { saveRun } from "./store";
import type { ResearchApiResult } from "./schema";

// Test seam (mirrors cookbook/demo's `_set*` pattern) — route tests inject a
// fully deterministic pipeline via the shared pipeline test seam.
export const _setResearchTestDeps = _setResearchPipelineTestDeps;
export type { EngineDeps };

/** Run one research session end-to-end and persist it. Returns the API shape the
 *  router serializes as JSON. */
export async function runResearchSession(question: string, deep: boolean): Promise<ResearchApiResult> {
  const result = await runDeepResearch(question, { deep });
  const saved = await saveRun({
    question: result.question,
    report: result.report.report,
    citations: result.report.citations as ResearchApiResult["citations"],
    sources: result.sources,
  });
  return {
    runId: saved.id,
    question: result.question,
    report: result.report.report,
    citations: result.report.citations as ResearchApiResult["citations"],
    sources: result.sources,
    rounds: result.rounds,
  };
}
