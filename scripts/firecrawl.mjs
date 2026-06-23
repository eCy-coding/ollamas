#!/usr/bin/env node
// firecrawl — key-in-.env REST wrapper for Firecrawl (no MCP install needed).
//
// Reads FIRECRAWL_API_KEY from .env (dotenv) and calls the Firecrawl API directly, so
// both Claude (Tier-1) and the ollamas sub-agents (Tier-3, via macos_terminal) can scrape
// a URL to clean markdown without the Firecrawl MCP server. Advanced scrape/crawl/search
// of the requested 5-MCP stack, fulfilled with one free key.
//
// Usage:
//   node scripts/firecrawl.mjs <url>                 # scrape one page -> markdown
//   node scripts/firecrawl.mjs --crawl <url> [limit] # crawl a site (limited pages)
//   node scripts/firecrawl.mjs --search "<query>"    # web search -> results+markdown
//   add --json for machine-readable output.
//
// NEVER prints the API key. On 401/402 (bad key / out of credits) it says so plainly.

import "dotenv/config";

const args = process.argv.slice(2);
const JSON_OUT = args.includes("--json");
const KEY = (process.env.FIRECRAWL_API_KEY || "").trim();
const BASE = "https://api.firecrawl.dev/v1";

if (!KEY) { console.error("FIRECRAWL_API_KEY not set in .env — add it (firecrawl.dev/app/api-keys) and retry."); process.exit(2); }

const mode = args.includes("--crawl") ? "crawl" : args.includes("--search") ? "search" : "scrape";
const target = args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--") || args[i - 1] === "--crawl" || args[i - 1] === "--search"));
if (!target) { console.error("usage: firecrawl.mjs <url> | --crawl <url> [limit] | --search \"<query>\""); process.exit(2); }

const call = async (path, body) => {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
    body: JSON.stringify(body), signal: AbortSignal.timeout(60000),
  });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error("401 invalid Firecrawl key");
  if (r.status === 402) throw new Error("402 out of Firecrawl credits — free tier exhausted");
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
};

try {
  let out;
  if (mode === "scrape") {
    const j = await call("/scrape", { url: target, formats: ["markdown"] });
    const md = j.data?.markdown || "";
    out = { mode, url: target, title: j.data?.metadata?.title || "", chars: md.length, markdown: md };
  } else if (mode === "crawl") {
    const limit = Number(args[args.indexOf("--crawl") + 2]) || 5;
    const j = await call("/crawl", { url: target, limit, scrapeOptions: { formats: ["markdown"] } });
    out = { mode, url: target, jobId: j.id || j.jobId, note: "crawl is async; poll the job id at firecrawl.dev or via /crawl/<id>", raw: j };
  } else {
    const j = await call("/search", { query: target, limit: 5 });
    out = { mode, query: target, results: (j.data || []).map((d) => ({ title: d.title, url: d.url, snippet: (d.markdown || d.description || "").slice(0, 200) })) };
  }

  if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); process.exit(0); }
  if (mode === "scrape") {
    console.log(`── firecrawl scrape ──  ${out.title || out.url}  (${out.chars} chars)`);
    console.log(out.markdown.slice(0, 1500) + (out.markdown.length > 1500 ? "\n… [truncated; use --json for full]" : ""));
  } else if (mode === "search") {
    console.log(`── firecrawl search ──  "${out.query}"`);
    for (const r of out.results) console.log(`  • ${r.title}\n    ${r.url}\n    ${r.snippet.replace(/\n/g, " ")}`);
  } else { console.log(`── firecrawl crawl started ──  job=${out.jobId}\n  ${out.note}`); }
} catch (e) {
  console.error(`firecrawl error: ${e.message}`);
  process.exit(1);
}
