// O2 research pipeline — the SINGLE composition root wiring the deps-injected
// engine (engine.ts) to real implementations: searxng.ts's backend chain,
// web-extract.mjs's pure page-extraction (reused, not reimplemented),
// summarize.ts/planner.ts/report.ts's LLM layer via ai.ts generateText
// (RESEARCH_MODEL → MAC_MODEL_CHAMPION fallback, no new provider), and
// server/rag.ts's process-wide ragIndex/ragSearch (Faz 3 reuse — no new vector
// store). Used by BOTH the research module's service.ts (persisted, HTTP route)
// and the `deep_research` agent/MCP tool (tool-registry.ts) — one implementation,
// two callers, matching the ToolRegistry choke-point discipline (no second
// dispatch path, no duplicated pipeline).
import { generateText, MAC_MODEL_CHAMPION } from "../ai";
import { searchBackend } from "./searxng";
import { extractReadable } from "../../bin/host-bridge/tools/lib/web-extract.mjs";
import { summarizeSource } from "./summarize";
import { planInitialQueries, nextQueries } from "./planner";
import { buildReport } from "./report";
import { runResearch, type EngineDeps, type ResearchResult } from "./engine";
import { ragIndex as realRagIndex, ragSearch as realRagSearch } from "../rag";

/** RESEARCH_MODEL env → MAC_MODEL_CHAMPION fallback (no new provider — ai.ts reuse). */
function researchModel(): string {
  return process.env.RESEARCH_MODEL || MAC_MODEL_CHAMPION;
}

function ragIngestEnabled(): boolean {
  return process.env.RESEARCH_RAG_INGEST !== "0";
}

async function fetchPageReal(url: string): Promise<{ title: string; text: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const html = await res.text();
    const readable = extractReadable(html, url);
    return readable.text ? { title: readable.title, text: readable.text } : null;
  } catch {
    return null; // fail-soft — the engine falls back to the search snippet
  }
}

/** Build the real (production) EngineDeps. Pure/composable so a caller can swap
 *  any single piece without booting the whole chain. */
export function buildRealDeps(input: { deep: boolean; maxRounds?: number }): EngineDeps {
  let lastReportModel = researchModel();
  return {
    planInitial: (q) => planInitialQueries(q, { generate: (p) => generateText(p, { model: researchModel() }) }),
    nextQueries: (q, gathered) => nextQueries(q, gathered, { generate: (p) => generateText(p, { model: researchModel() }) }),
    search: (q) => searchBackend(q),
    fetchPage: fetchPageReal,
    summarize: (source) => summarizeSource(source, { generate: (p) => generateText(p, { model: researchModel() }) }),
    buildReport: (q, gathered, ragContext) =>
      buildReport(q, gathered, {
        deep: input.deep,
        ragContext,
        pickModel: (deep) => {
          lastReportModel = deep && process.env.RESEARCH_DEEP_MODEL ? process.env.RESEARCH_DEEP_MODEL : researchModel();
          return lastReportModel;
        },
        generate: (p) => generateText(p, { model: lastReportModel }),
      }),
    ragIndex: ragIngestEnabled() ? realRagIndex : undefined,
    ragSearch: realRagSearch,
    ragIngestEnabled: ragIngestEnabled(),
    ...(input.maxRounds ? { maxRounds: input.maxRounds } : {}),
  };
}

// Test seam: full EngineDeps override — no network/ollama/sqlite-vec in tests.
let _testDeps: EngineDeps | undefined;
export function _setResearchPipelineTestDeps(deps: EngineDeps | undefined): void {
  _testDeps = deps;
}

/** Run one deep_research session end-to-end (no persistence — callers that need
 *  history wrap this, e.g. server/modules/research/service.ts). */
export async function runDeepResearch(
  question: string,
  opts: { deep?: boolean; maxRounds?: number } = {},
): Promise<ResearchResult> {
  const deps = _testDeps ?? buildRealDeps({ deep: opts.deep ?? false, maxRounds: opts.maxRounds });
  return runResearch(question, deps);
}
