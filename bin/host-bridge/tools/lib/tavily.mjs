// @ts-check
// tavily.mjs — pure request/response mapping for the Tavily search API (free tier:
// 1,000 credits/month, recurring, no card). Keyed PRIMARY engine for web_search; the
// DuckDuckGo scrape stays as the keyless fallback. Zero-dep, IO-free → unit-tested.

/** Build the Tavily POST request. Returns null without a key (caller falls back to DDG). */
export function buildTavilyRequest(query, key, maxResults = 6) {
  const k = (key || "").trim();
  if (!k || !query) return null;
  return {
    url: "https://api.tavily.com/search",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${k}` },
    body: JSON.stringify({ query, max_results: maxResults }),
  };
}

/** Map a Tavily response to the web_search result shape [{title,url,snippet}].
 *  Returns null on empty/malformed payloads so the caller can fall back honestly. */
export function parseTavilyResults(json, max = 6) {
  const rows = Array.isArray(json?.results) ? json.results : [];
  const out = rows
    .map((r) => ({
      title: String(r?.title ?? ""),
      url: String(r?.url ?? ""),
      snippet: String(r?.content ?? "").slice(0, 300),
    }))
    .filter((r) => r.url)
    .slice(0, max);
  return out.length ? out : null;
}
