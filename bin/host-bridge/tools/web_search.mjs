#!/usr/bin/env node
// web_search — quick web research for the agent. Fetches DuckDuckGo's HTML
// endpoint (no API key) and extracts the top result titles + URLs. Pure HTTP
// (Node 24 global fetch); does not need the bridge.
//   node web_search.mjs <query...>
const q = process.argv.slice(2).join(" ").trim();
if (!q) { console.error("query required"); process.exit(1); }

try {
  const res = await fetch("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q), {
    headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" },
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const results = [];
  const re = /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(html)) && results.length < 6) {
    const title = m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    let url = m[1];
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (title) results.push({ title, url });
  }
  console.log(JSON.stringify({ query: q, count: results.length, results: results.length ? results : `no results parsed (html ${html.length} bytes)` }, null, 2));
  process.exit(results.length ? 0 : 1);
} catch (e) {
  console.error(JSON.stringify({ query: q, error: String(e.message || e) }));
  process.exit(1);
}
