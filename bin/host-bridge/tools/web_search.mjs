#!/usr/bin/env node
// web_search — web research for the agent (pure HTTP + jsdom readability, no API key, no bridge).
//   node web_search.mjs <query...>              -> top DuckDuckGo results (snippet, shallow)
//   node web_search.mjs --deep <q> --top N       -> SAME top-N sources with FULL page text (deep, 1 call)
//   node web_search.mjs --fetch <url> [--render] -> readable text + links of a page (Chrome render if JS-heavy)
// Extraction/parsing lives in lib/web-extract.mjs (pure, jsdom, unit-tested). This CLI is the thin
// network+cache+render glue. Output is machine-readable JSON on stdout (clig.dev); stderr stays clean.
import { main, emit } from "./lib/bridge-client.mjs";
import {
  parseArgs, parseSearchResults, extractReadable, buildDeepResult,
  mapLimit, cacheKey, needsRender, snippetSufficient,
} from "./lib/web-extract.mjs";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";
const CACHE_DIR = join(homedir(), ".cache", "ollamas-web");
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h — page content is fairly stable at research timescale
const DEEP_CONCURRENCY = 4;            // bounded parallel fetch (mapLimit); polite + fast

// ── disk cache (content-addressed; best-effort, never throws) ──────────────
function cacheGet(kind, value) {
  try {
    const f = join(CACHE_DIR, cacheKey(kind, value) + ".json");
    if (!existsSync(f)) return null;
    const o = JSON.parse(readFileSync(f, "utf8"));
    return Date.now() - o.t > CACHE_TTL ? null : o.v;
  } catch { return null; }
}
function cacheSet(kind, value, v) {
  try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(join(CACHE_DIR, cacheKey(kind, value) + ".json"), JSON.stringify({ t: Date.now(), v })); } catch { /* best-effort */ }
}

// ── network primitives ────────────────────────────────────────────────────
async function httpGet(url, timeoutMs = 15000) {
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  const html = await res.text();
  return { ok: res.ok, status: res.status, html };
}

async function ddgSearch(q, maxResults = 6) {
  const { html } = await httpGet("https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q));
  return parseSearchResults(html, maxResults);
}

// Chrome render (best-effort): puppeteer is a dep but heavy → dynamic import, guarded. On any failure
// (no browser, launch error, timeout) return null so the caller falls back to the HTTP body (rendered:false).
async function renderHtml(url, timeoutMs = 20000) {
  let browser;
  try {
    const { default: puppeteer } = await import("puppeteer");
    browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
    const page = await browser.newPage();
    await page.setUserAgent(UA);
    await page.goto(url, { waitUntil: "networkidle2", timeout: timeoutMs });
    const html = await page.content();
    return html;
  } catch { return null; }
  finally { try { if (browser) await browser.close(); } catch {} }
}

// Fetch one URL → readable {title,text,links,rendered}. Renders when asked or when the static body
// looks JS-shell (needsRender). Cached by URL (rendered pages cache too — keyed the same, TTL wins).
async function fetchReadable(url, { render = false } = {}) {
  const cached = cacheGet("fetch", url);
  if (cached) return { ...cached, cached: true };
  let rendered = false;
  let out;
  try {
    const { html } = await httpGet(url);
    let readable = extractReadable(html, url);
    if ((render || needsRender(html, readable.text)) ) {
      const rhtml = await renderHtml(url);
      if (rhtml) { readable = extractReadable(rhtml, url); rendered = true; }
    }
    out = { title: readable.title, url, text: readable.text, links: readable.links, rendered };
  } catch (e) {
    out = { title: "", url, text: "", links: [], rendered, error: String(e?.message || e) };
  }
  if (out.text) cacheSet("fetch", url, out); // only cache non-empty pages
  return { ...out, cached: false };
}

// ── modes ─────────────────────────────────────────────────────────────────
async function runSearch(q) {
  const results = await ddgSearch(q);
  return { ok: results.length > 0, mode: "search", query: q, count: results.length, results };
}

async function runDeep(q, top, render) {
  const cacheId = `${q}::top${top}::r${render ? 1 : 0}`;
  const hit = cacheGet("deep", cacheId);
  if (hit) return { ...hit, cached: true };
  const hits = await ddgSearch(q, Math.max(top, 6));
  const chosen = hits.slice(0, top);
  // Per source: skip fetch when the snippet alone is already substantial (efficiency); else fetch full text.
  const pages = await mapLimit(chosen, DEEP_CONCURRENCY, async (sr) => {
    if (!render && snippetSufficient(sr.snippet)) return null; // snippet-sufficient → no fetch
    const p = await fetchReadable(sr.url, { render });
    return p.text ? { title: p.title, text: p.text, links: p.links, rendered: p.rendered } : null;
  });
  const results = chosen.map((sr, i) => buildDeepResult(sr, pages[i]));
  const out = { ok: results.length > 0, mode: "deep", query: q, top, count: results.length, results };
  if (results.length) cacheSet("deep", cacheId, out);
  return { ...out, cached: false };
}

async function runFetch(url, render) {
  const p = await fetchReadable(url, { render });
  return {
    ok: !!p.text, mode: "fetch", url, status: p.error ? 0 : 200,
    title: p.title, text: p.text, chars: (p.text || "").length, links: p.links, rendered: p.rendered, cached: !!p.cached,
    ...(p.error ? { error: p.error } : {}),
  };
}

main(async () => {
  const { action, render, top, value } = parseArgs(process.argv.slice(2));
  if (action === "fetch") {
    if (!value) throw new Error("--fetch requires a URL");
    emit(await runFetch(value, render));
  } else if (action === "deep") {
    if (!value) throw new Error("--deep requires a query");
    emit(await runDeep(value, top, render));
  } else {
    if (!value) throw new Error("query required");
    emit(await runSearch(value));
  }
});
