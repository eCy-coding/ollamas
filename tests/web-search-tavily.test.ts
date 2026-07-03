// T2-F5 — Tavily primary search mapping (pure lib; the web_search.mjs tool wires it with
// a DDG-scrape fallback). Kept separate from tests/web-search-tool.test.ts (another
// worker's in-flight file).
import { describe, it, expect } from "vitest";
import { buildTavilyRequest, parseTavilyResults } from "../bin/host-bridge/tools/lib/tavily.mjs";

describe("buildTavilyRequest", () => {
  it("no key / no query → null (caller falls back to DDG)", () => {
    expect(buildTavilyRequest("q", "")).toBeNull();
    expect(buildTavilyRequest("q", "   ")).toBeNull();
    expect(buildTavilyRequest("", "tvly-key")).toBeNull();
  });
  it("key present → POST shape with bearer + bounded max_results", () => {
    const r = buildTavilyRequest("ollama routing", "tvly-key");
    expect(r).not.toBeNull();
    expect(r!.url).toBe("https://api.tavily.com/search");
    expect(r!.headers.Authorization).toBe("Bearer tvly-key");
    expect(JSON.parse(r!.body)).toEqual({ query: "ollama routing", max_results: 6 });
  });
});

describe("parseTavilyResults", () => {
  it("maps results to the web_search {title,url,snippet} shape, url-required, capped", () => {
    const out = parseTavilyResults({ results: [
      { title: "A", url: "https://a", content: "x".repeat(500) },
      { title: "no-url dropped", url: "", content: "y" },
      { title: "B", url: "https://b", content: "z" },
    ] });
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ title: "A", url: "https://a", snippet: "x".repeat(300) });
    expect(out[1].url).toBe("https://b");
  });
  it("empty/malformed → null (honest fallback signal)", () => {
    expect(parseTavilyResults({})).toBeNull();
    expect(parseTavilyResults({ results: [] })).toBeNull();
    expect(parseTavilyResults(null)).toBeNull();
    expect(parseTavilyResults({ results: [{ title: "x", url: "" }] })).toBeNull();
  });
});
