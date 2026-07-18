/**
 * server/research.ts — Deep research (P1): question → plan sub-queries → web search
 * → fetch + extract → summarise each source with the $0-local model → stream a cited
 * report over SSE. Reuses server/ai.ts (generate + generateTextStream). $0-local: DDG
 * HTML (no API key) with optional SearXNG (SEARXNG_URL). SSRF-guarded; honest empty state.
 */
import type { Request, Response } from "express";
import { generate, generateTextStream } from "./ai";

export interface Source { title: string; url: string; snippet: string; text?: string }
export interface ResearchEvent {
  stage: "plan" | "fetch" | "summarize" | "synthesize" | "error";
  status: "running" | "done" | "fail";
  text?: string;
  progress?: number;
  error?: string;
  done?: boolean;
  report?: string;
  sources?: Source[];
}
type Guard = (req: Request, res: Response, next: () => void) => void;

export const DEFAULT_MODEL = "qwen3:8b";
const FETCH_TIMEOUT_MS = 8000;
const MAX_SOURCES = 6;

// ---- SSRF guard: only public http(s); block loopback/private/link-local hosts ----
export function isSafeUrl(url: string): boolean {
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h === "::1") return false;
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
  if (h.startsWith("fc") || h.startsWith("fd")) return false; // IPv6 ULA
  return true;
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ---- Parse a DuckDuckGo HTML result page into sources (defensive; [] if markup shifts) ----
export function parseDdgResults(html: string, max = MAX_SOURCES): Source[] {
  const out: Source[] = [];
  const re = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) && out.length < max) {
    let url = m[1];
    const title = stripTags(m[2]);
    const ud = /[?&]uddg=([^&]+)/.exec(url); // DDG redirect wrapper
    if (ud) url = decodeURIComponent(ud[1]);
    if (url.startsWith("//")) url = "https:" + url;
    if (title && isSafeUrl(url) && !out.some((s) => s.url === url)) out.push({ title, url, snippet: "" });
  }
  return out;
}

// ---- Web search: SearXNG JSON if configured, else DuckDuckGo HTML ($0, no key) ----
export async function searchWeb(query: string): Promise<Source[]> {
  const searxng = process.env.SEARXNG_URL;
  try {
    if (searxng) {
      const r = await fetch(`${searxng.replace(/\/$/, "")}/search?format=json&q=${encodeURIComponent(query)}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (r.ok) {
        const j = (await r.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
        return (j.results ?? [])
          .slice(0, MAX_SOURCES)
          .map((x) => ({ title: x.title ?? x.url ?? "", url: x.url ?? "", snippet: x.content ?? "" }))
          .filter((s) => s.url && isSafeUrl(s.url));
      }
    }
    const r = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0 (research)" },
    });
    if (!r.ok) return [];
    return parseDdgResults(await r.text());
  } catch {
    return [];
  }
}

// ---- Fetch a page and reduce to readable text (SSRF-guarded, bounded, timed out) ----
export async function fetchText(url: string): Promise<string> {
  if (!isSafeUrl(url)) return "";
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { "User-Agent": "Mozilla/5.0 (research)" },
    });
    if (!r.ok) return "";
    const html = await r.text();
    return stripTags(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ")).slice(0, 4000);
  } catch {
    return "";
  }
}

export async function planQueries(question: string): Promise<string[]> {
  const { text } = await generate(
    `Break this research question into 2-4 focused web-search queries, one per line, no numbering or markdown:\n\n"${question}"`,
    { system: "Output only the queries, terse." },
  );
  const qs = text.split("\n").map((l) => l.replace(/^[-*\d.)\s]+/, "").trim()).filter(Boolean).slice(0, 4);
  return qs.length ? qs : [question];
}

export async function* summarizeSource(source: Source): AsyncGenerator<string> {
  yield* generateTextStream(
    `Summarize this source in 2-3 factual bullet points relevant to the research.\nTitle: ${source.title}\n\n${(source.text || source.snippet).slice(0, 3000)}`,
    { model: DEFAULT_MODEL, system: "Be concise; use only facts present in the text." },
  );
}

export async function* synthesizeReport(question: string, sources: Source[], summaries: string[]): AsyncGenerator<string> {
  const srcList = sources.map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join("\n");
  const findings = summaries.map((s, i) => `[${i + 1}] ${s}`).join("\n\n");
  yield* generateTextStream(
    `Write a concise research report answering the question. Cite claims inline with [1], [2]… matching the sources. Do not invent facts.\n\nQuestion: ${question}\n\nSources:\n${srcList}\n\nFindings:\n${findings}\n\nReport:`,
    { model: DEFAULT_MODEL, system: "Professional research analyst; cite inline by [n]." },
  );
}

// ---- Orchestrator: yields SSE-ready events; drained by the route (and by tests) ----
export async function* researchStream(question: string): AsyncGenerator<ResearchEvent> {
  yield { stage: "plan", status: "running" };
  const queries = await planQueries(question);
  yield { stage: "plan", status: "done", text: `${queries.length} ${queries.length === 1 ? "query" : "queries"}` };

  yield { stage: "fetch", status: "running" };
  const sources: Source[] = [];
  for (const q of queries) {
    if (sources.length >= MAX_SOURCES) break;
    for (const sr of await searchWeb(q)) {
      if (sources.length >= MAX_SOURCES) break;
      if (sources.some((s) => s.url === sr.url)) continue;
      sr.text = await fetchText(sr.url);
      sources.push(sr);
    }
  }
  if (sources.length === 0) {
    yield { stage: "fetch", status: "done", text: "No sources found" };
    yield {
      stage: "synthesize",
      status: "done",
      report: "No web sources were found for this query. Try rephrasing, or check connectivity / the SearXNG backend.",
      done: true,
      sources: [],
    };
    return;
  }
  yield { stage: "fetch", status: "done", text: `${sources.length} sources` };

  yield { stage: "summarize", status: "running", text: `0/${sources.length}` };
  const summaries: string[] = [];
  for (let i = 0; i < sources.length; i++) {
    let s = "";
    for await (const c of summarizeSource(sources[i])) s += c;
    summaries.push(s.trim());
    yield { stage: "summarize", status: "running", text: `${i + 1}/${sources.length}`, progress: (i + 1) / sources.length };
  }
  yield { stage: "summarize", status: "done" };

  yield { stage: "synthesize", status: "running" };
  let report = "";
  for await (const c of synthesizeReport(question, sources, summaries)) {
    report += c;
    yield { stage: "synthesize", status: "running", text: c };
  }
  yield { stage: "synthesize", status: "done", report, done: true, sources };
}

export function registerResearchRoutes(app: { post: Function }, guard: Guard): void {
  app.post("/api/research", guard, async (req: Request, res: Response) => {
    const question = (req.body as { question?: unknown })?.question;
    if (typeof question !== "string" || !question.trim()) {
      return res.status(400).json({ error: "question (non-empty string) required" });
    }
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    try {
      for await (const ev of researchStream(question.trim())) res.write(`data: ${JSON.stringify(ev)}\n\n`);
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ stage: "error", status: "fail", error: (err as Error)?.message || "research failed" })}\n\n`);
      res.end();
    }
  });
}
