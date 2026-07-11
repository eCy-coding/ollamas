// O2 Faz 0 (docs/odyssey/05-features/research.md §FAZ 0) — SearXNG meta-search
// client + the fail-soft backend chain (searxng → tavily → ddg). Every layer is
// wrapped so a down/unreachable service falls through instead of throwing (P2
// CRITICAL — the research engine must never crash on a flaky search backend).
//
// REUSE, not rebuild: Tavily request/response mapping is the EXISTING pure lib
// (bin/host-bridge/tools/lib/tavily.mjs, already tested by
// tests/web-search-tavily.test.ts) — this closes the "formalization gap" the
// plan documents (lib existed but nothing called it). DDG parsing reuses
// parseSearchResults from web-extract.mjs so the fallback tier shares the exact
// same tested HTML→result mapping web_search.mjs uses (no second implementation).
import { buildTavilyRequest, parseTavilyResults } from "../../bin/host-bridge/tools/lib/tavily.mjs";
import { parseSearchResults } from "../../bin/host-bridge/tools/lib/web-extract.mjs";

export interface SearxResult {
  title: string;
  url: string;
  snippet: string;
}

export type SearchSource = "searxng" | "tavily" | "ddg";

export interface SearchOutcome {
  source: SearchSource;
  results: SearxResult[];
}

/** Build a SearXNG `/search` URL with `format=json` (JSON is opt-in server-side — K2). */
export function buildSearxUrl(base: string, opts: { q: string; categories?: string }): string {
  const u = new URL("/search", base);
  u.searchParams.set("q", opts.q);
  u.searchParams.set("format", "json");
  if (opts.categories) u.searchParams.set("categories", opts.categories);
  return u.toString();
}

/** Normalize a SearXNG JSON payload to the shared {title,url,snippet}[] shape.
 *  Malformed/empty → null so the caller can fall back honestly (fail-soft signal). */
export function parseSearxResults(json: unknown, max = 6): SearxResult[] | null {
  const rows = Array.isArray((json as { results?: unknown[] })?.results)
    ? (json as { results: unknown[] }).results
    : null;
  if (!rows) return null;
  const out = rows
    .map((r) => {
      const row = r as { title?: unknown; url?: unknown; content?: unknown; snippet?: unknown };
      return {
        title: String(row?.title ?? ""),
        url: String(row?.url ?? ""),
        snippet: String(row?.content ?? row?.snippet ?? "").slice(0, 300),
      };
    })
    .filter((r) => r.url)
    .slice(0, max);
  return out.length ? out : null;
}

/** Default DDG fallback: HTML-scrape via the same UA/endpoint web_search.mjs uses,
 *  parsed with the shared pure parseSearchResults (no second implementation). */
async function defaultDdgSearch(query: string, max = 6, fetchFn: typeof fetch = fetch): Promise<SearxResult[]> {
  const res = await fetchFn("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(query), {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36" },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  return parseSearchResults(html, max);
}

export interface SearchDeps {
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
  ddgSearch?: (query: string, max?: number) => Promise<SearxResult[]>;
  max?: number;
}

/**
 * The Faz 0 backend chain: SearXNG → Tavily (key required) → DDG. `SEARCH_BACKEND`
 * env pins a single tier (`searxng|tavily|ddg`); default `auto` runs the full
 * fail-soft chain. NEVER throws — every tier's failure just falls through, and
 * the terminal DDG tier itself swallows its own errors into an honest empty list
 * (P2 CRITICAL, K3 mitigation: rate-limited/blocked search engines don't crash research).
 */
export async function searchBackend(query: string, deps: SearchDeps = {}): Promise<SearchOutcome> {
  const env = deps.env ?? process.env;
  const fetchFn = deps.fetchFn ?? fetch;
  const max = deps.max ?? 6;
  const pin = (env.SEARCH_BACKEND || "auto") as SearchSource | "auto";

  if (pin === "auto" || pin === "searxng") {
    const base = env.SEARXNG_URL || "http://localhost:8888";
    try {
      const url = buildSearxUrl(base, { q: query });
      const res = await fetchFn(url, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const json = await res.json();
        const results = parseSearxResults(json, max);
        if (results) return { source: "searxng", results };
      }
    } catch {
      // SearXNG unreachable/down — fall through to the next tier (fail-soft).
    }
    if (pin === "searxng") return { source: "searxng", results: [] };
  }

  if (pin === "auto" || pin === "tavily") {
    const key = env.TAVILY_API_KEY;
    if (key) {
      try {
        const req = buildTavilyRequest(query, key, max);
        if (req) {
          const res = await fetchFn(req.url, { method: "POST", headers: req.headers, body: req.body, signal: AbortSignal.timeout(8000) });
          if (res.ok) {
            const json = await res.json();
            const results = parseTavilyResults(json, max);
            if (results) return { source: "tavily", results };
          }
        }
      } catch {
        // Tavily unreachable/quota-exhausted — fall through to DDG.
      }
    }
    if (pin === "tavily") return { source: "tavily", results: [] };
  }

  try {
    const ddg = deps.ddgSearch ?? ((q: string, m?: number) => defaultDdgSearch(q, m, fetchFn));
    const results = await ddg(query, max);
    return { source: "ddg", results };
  } catch {
    return { source: "ddg", results: [] };
  }
}
