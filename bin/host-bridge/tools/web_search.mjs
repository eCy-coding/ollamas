#!/usr/bin/env node
// web_search — web research for the agent (pure HTTP, no API key, no bridge).
//   node web_search.mjs <query...>       -> top DuckDuckGo results
//   node web_search.mjs --fetch <url>    -> readable text of a page
import { main, emit } from "./lib/bridge-client.mjs";

async function search(q) {
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
  return { ok: results.length > 0, mode: "search", query: q, count: results.length, results };
}

async function fetchPage(url) {
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(15000) });
  const html = await res.text();
  const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/g, " ").replace(/\s+/g, " ").trim();
  return { ok: res.ok, mode: "fetch", url, status: res.status, title, text: text.slice(0, 2000) };
}

main(async () => {
  const args = process.argv.slice(2);
  if (args[0] === "--fetch") {
    const url = args[1];
    if (!url) throw new Error("--fetch requires a URL");
    emit(await fetchPage(url));
  } else {
    const q = args.join(" ").trim();
    if (!q) throw new Error("query required");
    emit(await search(q));
  }
});
