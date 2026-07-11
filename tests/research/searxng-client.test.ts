// O2 Faz 0 (docs/odyssey/05-features/research.md §FAZ 0) — SearXNG client + the
// searchBackend chain (searxng → tavily → ddg). Pure URL-build/parse (no network)
// plus the chain tested with an injected fetchFn/ddgSearch (deterministic, no
// real HTTP). The chain must NEVER throw (fail-soft, P2 CRITICAL).
import { describe, it, expect, vi, afterEach } from "vitest";
import { buildSearxUrl, parseSearxResults, searchBackend } from "../../server/research/searxng";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("buildSearxUrl (pure)", () => {
  it("builds a JSON-format search URL from base + query", () => {
    const url = buildSearxUrl("http://localhost:8888", { q: "ollama routing" });
    expect(url).toContain("http://localhost:8888/search?");
    expect(url).toContain("q=ollama+routing");
    expect(url).toContain("format=json");
  });

  it("passes through an optional categories param", () => {
    const url = buildSearxUrl("http://localhost:8888", { q: "x", categories: "general" });
    expect(url).toContain("categories=general");
  });
});

describe("parseSearxResults (pure)", () => {
  it("normalizes SearXNG JSON results to {title,url,snippet}[]", () => {
    const out = parseSearxResults({
      results: [
        { title: "A", url: "https://a", content: "hello" },
        { title: "B", url: "https://b", content: "world".repeat(100) },
      ],
    }, 6);
    expect(out).toHaveLength(2);
    expect(out![0]).toEqual({ title: "A", url: "https://a", snippet: "hello" });
    expect(out![1].snippet.length).toBeLessThanOrEqual(300);
  });

  it("caps at max and drops url-less rows", () => {
    const out = parseSearxResults({
      results: [
        { title: "no-url", url: "", content: "x" },
        { title: "1", url: "https://1" },
        { title: "2", url: "https://2" },
        { title: "3", url: "https://3" },
      ],
    }, 2);
    expect(out).toHaveLength(2);
  });

  it("malformed/empty → null (honest fallback signal)", () => {
    expect(parseSearxResults({})).toBeNull();
    expect(parseSearxResults({ results: [] })).toBeNull();
    expect(parseSearxResults(null)).toBeNull();
  });
});

describe("searchBackend chain (searxng → tavily → ddg, fail-soft)", () => {
  it("SEARXNG_URL set + 200 JSON → uses searxng results, source:'searxng'", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ results: [{ title: "S", url: "https://s", content: "c" }] }), { status: 200 }),
    );
    const out = await searchBackend("q", { env: { SEARXNG_URL: "http://localhost:8888" } as NodeJS.ProcessEnv, fetchFn: fetchFn as unknown as typeof fetch });
    expect(out.source).toBe("searxng");
    expect(out.results).toEqual([{ title: "S", url: "https://s", snippet: "c" }]);
  });

  it("SearXNG 5xx/timeout + TAVILY_API_KEY set → falls back to tavily", async () => {
    const fetchFn = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes("8888")) return new Response("boom", { status: 500 });
      if (u.includes("tavily.com")) {
        return new Response(JSON.stringify({ results: [{ title: "T", url: "https://t", content: "tv" }] }), { status: 200 });
      }
      throw new Error("unexpected url " + u);
    });
    const out = await searchBackend("q", {
      env: { SEARXNG_URL: "http://localhost:8888", TAVILY_API_KEY: "tvly-key" } as NodeJS.ProcessEnv,
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    expect(out.source).toBe("tavily");
    expect(out.results[0].url).toBe("https://t");
  });

  it("no SearXNG, no Tavily key → falls back to injected ddgSearch", async () => {
    const ddgSearch = vi.fn(async () => [{ title: "D", url: "https://d", snippet: "dd" }]);
    const out = await searchBackend("q", { env: {} as NodeJS.ProcessEnv, ddgSearch });
    expect(out.source).toBe("ddg");
    expect(out.results[0].url).toBe("https://d");
    expect(ddgSearch).toHaveBeenCalledOnce();
  });

  it("every layer fails → still resolves honest-empty, never throws", async () => {
    const fetchFn = vi.fn(async () => { throw new Error("network down"); });
    const ddgSearch = vi.fn(async () => { throw new Error("ddg down too"); });
    const out = await searchBackend("q", {
      env: { SEARXNG_URL: "http://localhost:8888", TAVILY_API_KEY: "tvly-key" } as NodeJS.ProcessEnv,
      fetchFn: fetchFn as unknown as typeof fetch,
      ddgSearch,
    });
    expect(out.source).toBe("ddg");
    expect(out.results).toEqual([]);
  });

  it("used backend is reported so the caller can render honesty about the source", async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({}), { status: 200 }));
    const ddgSearch = vi.fn(async () => [{ title: "D", url: "https://d", snippet: "dd" }]);
    const out = await searchBackend("q", { env: {} as NodeJS.ProcessEnv, fetchFn: fetchFn as unknown as typeof fetch, ddgSearch });
    expect(["searxng", "tavily", "ddg"]).toContain(out.source);
  });
});
