// Cited web search (I/O boundary).
//
// WHY THIS EXISTS
// The prompt's first instruction: "Gather up-to-date, authoritative information … use at most
// 5 search queries … for each query return the top 3-5 results (title + URL) … store every
// result as a JSON object under `search_results` … cite every fact you later use with the
// reference index [1], [2], …".
//
// v3's `search` only queried the local Obsidian capsule layer. That is the right FIRST hop —
// it costs ~1 KB and no network — but it cannot satisfy "authoritative external sources with
// citation indices", so `search_results` had no `ref_id` and every downstream claim was
// uncitable.
//
// REUSE, not rebuild: `server/research/searxng.ts:searchBackend` already returns exactly
// `{title, url, snippet}` through a fail-soft searxng → tavily → ddg chain that NEVER throws.
// This module only adds what the prompt needs on top: a query budget, stable `ref_id`
// assignment, caching, and honest emptiness.
import { searchBackend, type SearxResult } from "../../server/research/searxng";
import type { SearchResult } from "../lib/document";
import type { CacheStore } from "./cache-store";

/** The prompt's explicit ceiling. Exported so the gate can assert it was respected. */
export const MAX_QUERIES = 5;
const PER_QUERY_MIN = 3;
const PER_QUERY_MAX = 5;

export interface WebSearchInput {
  queries: string[];
  cache?: CacheStore;
  /** First ref_id to assign. Lets the caller reserve low indices for curated references. */
  startRefId?: number;
  /** Injected for tests; defaults to the real fail-soft backend. */
  backend?: typeof searchBackend;
}

export interface WebSearchOutcome {
  results: SearchResult[];
  /** Queries actually issued (never more than MAX_QUERIES). */
  queriesUsed: string[];
  /** Which backend answered, per query. */
  sources: string[];
  /** True when NOTHING came back — reported, never papered over with invented sources. */
  degraded: boolean;
  reason?: string;
  cacheHits: number;
}

/** Same URL from two queries is one source, so a citation index means one thing. */
function dedupeByUrl(rows: Array<SearxResult & { source: string }>): Array<SearxResult & { source: string }> {
  const seen = new Set<string>();
  const out: Array<SearxResult & { source: string }> = [];
  for (const r of rows) {
    const key = String(r.url ?? "").replace(/[#?].*$/, "").replace(/\/$/, "").toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Run up to `MAX_QUERIES` searches and return citable results.
 *
 * Degradation is explicit and total: with no network, `results` is empty, `degraded` is true
 * and the reason says so. It never invents a plausible URL to fill the schema — a fabricated
 * citation is worse than a missing one, because the document would then LOOK evidence-based
 * while resting on nothing.
 */
export async function webSearch(i: WebSearchInput): Promise<WebSearchOutcome> {
  const backend = i.backend ?? searchBackend;
  const queries = i.queries.map((q) => q.trim()).filter(Boolean).slice(0, MAX_QUERIES);
  const rows: Array<SearxResult & { source: string }> = [];
  const sources: string[] = [];
  let cacheHits = 0;

  for (const q of queries) {
    const cached = i.cache?.get<{ results: SearxResult[]; source: string }>("websearch", { q });
    if (cached?.hit && cached.value) {
      cacheHits++;
      sources.push(`${cached.value.source}(cache)`);
      rows.push(...cached.value.results.map((r) => ({ ...r, source: cached.value!.source })));
      continue;
    }
    let outcome: { source: string; results: SearxResult[] };
    try {
      outcome = await backend(q, { max: PER_QUERY_MAX });
    } catch {
      // searchBackend is documented never to throw; belt-and-braces so one bad tier cannot
      // take down the run that was only gathering context.
      outcome = { source: "none", results: [] };
    }
    const trimmed = (outcome.results ?? []).slice(0, PER_QUERY_MAX);
    if (trimmed.length) i.cache?.set(i.cache.get("websearch", { q }).key, { results: trimmed, source: outcome.source });
    sources.push(outcome.source);
    rows.push(...trimmed.map((r) => ({ ...r, source: outcome.source })));
  }

  const deduped = dedupeByUrl(rows);
  const start = i.startRefId ?? 1;
  const results: SearchResult[] = deduped.map((r, idx) => ({
    title: String(r.title ?? "").slice(0, 200),
    url: String(r.url ?? ""),
    snippet: String(r.snippet ?? "").replace(/\s+/g, " ").slice(0, 400),
    ref_id: start + idx,
    source: r.source,
  }));

  const thin = results.length > 0 && results.length < PER_QUERY_MIN;
  return {
    results,
    queriesUsed: queries,
    sources,
    degraded: results.length === 0,
    reason: results.length === 0
      ? `no web results (backends tried: ${sources.join(", ") || "none"})`
      : thin
        ? `only ${results.length} result(s) — below the prompt's 3-per-query floor`
        : undefined,
    cacheHits,
  };
}

/**
 * Derive the query set from the task.
 *
 * Capped at MAX_QUERIES by construction rather than by a later slice, so the budget cannot be
 * exceeded by adding a caller. The extra angles are deliberately generic ("best practices",
 * "benchmark") because the pipeline's job is gathering authority on a topic, not answering
 * the question itself — that is what `think` does with the results.
 */
export function deriveQueries(task: string, extra: string[] = []): string[] {
  const base = String(task ?? "").trim();
  if (!base) return [];
  const angles = [base, `${base} best practices`, `${base} benchmark`, ...extra];
  return [...new Set(angles.map((a) => a.trim()).filter(Boolean))].slice(0, MAX_QUERIES);
}
