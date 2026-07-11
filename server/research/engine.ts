// O2 Faz 2 (docs/odyssey/05-features/research.md §FAZ 2) — the round-loop
// orchestrator. Fully deps-injected: search/fetchPage/summarize/planInitial/
// nextQueries/buildReport/ragIndex/ragSearch are all passed in, so this module
// has ZERO direct IO — the module/router wires the real implementations
// (searxng.ts, summarize.ts, planner.ts, report.ts, server/rag.ts). Hard caps
// (maxRounds/maxQueries/topPerQuery) + a query-repeat guard bound token spend
// (P4 CRITICAL, K5) — a chatty LLM proposing endless follow-ups can never loop
// forever or re-run a query it has already processed.
import crypto from "node:crypto";
import type { SourceInput, SourceSummary } from "./summarize";
import type { SearchOutcome } from "./searxng";

export const RESEARCH_MAX_ROUNDS = Number(process.env.RESEARCH_MAX_ROUNDS) || 3;
export const RESEARCH_TOP_PER_QUERY = Number(process.env.RESEARCH_TOP_PER_QUERY) || 3;

/** The UI/SSE progress vocabulary (panels/research.md §2) — locked, do not rename. */
export type ProgressStep = "plan" | "fetch" | "summarize" | "verify" | "synthesize";

export interface RoundRecord {
  round: number;
  queries: string[];
}

export interface ReportResult {
  report: string;
  citations: unknown[];
}

export interface RagHit {
  id: string;
  text: string;
  distance: number;
}

export interface EngineDeps {
  planInitial: (question: string) => Promise<string[]>;
  nextQueries: (question: string, gathered: SourceSummary[]) => Promise<string[]>;
  search: (query: string) => Promise<SearchOutcome>;
  fetchPage: (url: string) => Promise<{ title: string; text: string } | null>;
  summarize: (source: SourceInput) => Promise<SourceSummary>;
  buildReport: (question: string, gathered: SourceSummary[], ragContext?: RagHit[]) => Promise<ReportResult>;
  /** RAG-ingest bridge (Faz 3, reuses server/rag.ts — no new vector store). */
  ragIndex?: (docId: string, text: string) => Promise<unknown>;
  ragSearch?: (query: string, k?: number) => Promise<RagHit[]>;
  onProgress?: (step: ProgressStep, meta?: Record<string, unknown>) => void;
  maxRounds?: number;
  maxQueries?: number;
  topPerQuery?: number;
  /** RESEARCH_RAG_INGEST toggle (default on) — Faz 3 P6. */
  ragIngestEnabled?: boolean;
}

export interface ResearchResult {
  question: string;
  runId: string;
  rounds: RoundRecord[];
  sources: SourceSummary[];
  report: ReportResult;
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.map((q) => q.trim()).filter(Boolean))];
}

/** Runs the plan → fetch → summarize → verify → synthesize pipeline. Never throws
 *  on a single source/query failure (each await is best-effort inside its own
 *  try/catch boundary at the call sites that own IO — this loop stays pure control-flow). */
export async function runResearch(
  question: string,
  deps: EngineDeps,
  runId: string = crypto.randomUUID(),
): Promise<ResearchResult> {
  const maxRounds = deps.maxRounds ?? RESEARCH_MAX_ROUNDS;
  const topPerQuery = deps.topPerQuery ?? RESEARCH_TOP_PER_QUERY;
  const ragIngestEnabled = deps.ragIngestEnabled ?? true;

  deps.onProgress?.("plan", { question });
  let pending = dedupe(await deps.planInitial(question));
  const seen = new Set<string>();
  const rounds: RoundRecord[] = [];
  const sources: SourceSummary[] = [];

  for (let round = 1; round <= maxRounds; round++) {
    // Query-repeat guard (K5): a query already processed in an earlier round is
    // never re-searched, however many times a follow-up round proposes it again.
    const queries = pending.filter((q) => !seen.has(q));
    if (!queries.length) break;
    for (const q of queries) seen.add(q);

    for (const query of queries) {
      deps.onProgress?.("fetch", { query });
      const outcome = await deps.search(query);
      const top = outcome.results.slice(0, topPerQuery);
      for (const r of top) {
        const page = await deps.fetchPage(r.url).catch(() => null);
        const text = page?.text || r.snippet || "";
        deps.onProgress?.("summarize", { url: r.url });
        const summary = await deps.summarize({ title: page?.title || r.title, url: r.url, text });
        sources.push(summary);
        if (ragIngestEnabled && deps.ragIndex) {
          await deps.ragIndex(`research:${runId}:${sources.length}`, summary.summary).catch(() => undefined);
        }
      }
    }
    rounds.push({ round, queries });

    deps.onProgress?.("verify", { round });
    const follow = await deps.nextQueries(question, sources);
    if (!follow.length) break; // durma kriteri (P4) — the deliberate stop signal
    pending = dedupe(follow);
  }

  deps.onProgress?.("synthesize", { sources: sources.length });
  const ragContext = deps.ragSearch ? await deps.ragSearch(question).catch(() => []) : undefined;
  const report = await deps.buildReport(question, sources, ragContext);

  return { question, runId, rounds, sources, report };
}
