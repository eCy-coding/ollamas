import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../server/ai", () => ({
  generate: vi.fn(),
  generateTextStream: vi.fn(),
}));
import { generate, generateTextStream } from "../server/ai";
import {
  isSafeUrl,
  parseDdgResults,
  searchWeb,
  fetchText,
  planQueries,
  synthesizeReport,
  researchStream,
  type ResearchEvent,
} from "../server/research";

const genOnce = (text: string) =>
  vi.mocked(generate).mockResolvedValueOnce({ text, source: "test", tokensPerSec: 1, modelUsed: "qwen3:8b" } as never);
const streamYields = (...chunks: string[]) =>
  vi.mocked(generateTextStream).mockImplementation(async function* () { for (const c of chunks) yield c; });
const okHtml = (html: string) => ({ ok: true, text: async () => html }) as unknown as Response;

afterEach(() => vi.unstubAllGlobals());
beforeEach(() => vi.clearAllMocks());

describe("research — SSRF guard", () => {
  it("blocks non-http, loopback and private hosts; allows public https", () => {
    expect(isSafeUrl("https://example.com/x")).toBe(true);
    expect(isSafeUrl("http://example.com")).toBe(true);
    expect(isSafeUrl("file:///etc/passwd")).toBe(false);
    expect(isSafeUrl("http://localhost:8888")).toBe(false);
    expect(isSafeUrl("http://127.0.0.1")).toBe(false);
    expect(isSafeUrl("http://10.0.0.5")).toBe(false);
    expect(isSafeUrl("http://192.168.1.1")).toBe(false);
    expect(isSafeUrl("http://169.254.1.1")).toBe(false);
    expect(isSafeUrl("not a url")).toBe(false);
  });
});

describe("research — DDG parsing", () => {
  it("extracts sources, decodes the uddg redirect, skips unsafe", () => {
    const html = `
      <a class="result__a" href="/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2FTS">TypeScript</a>
      <a class="result__a" href="https://ts.dev">TS Home</a>
      <a class="result__a" href="http://127.0.0.1/secret">local</a>`;
    const r = parseDdgResults(html);
    expect(r.map((s) => s.url)).toEqual(["https://en.wikipedia.org/TS", "https://ts.dev"]);
    expect(r[0].title).toBe("TypeScript");
  });
});

describe("research — searchWeb / fetchText", () => {
  it("parses DDG HTML via searchWeb", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okHtml(`<a class="result__a" href="https://a.com">A</a>`)));
    const r = await searchWeb("q");
    expect(r[0]).toMatchObject({ url: "https://a.com", title: "A" });
  });

  it("returns [] gracefully when search fetch throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network"); }));
    expect(await searchWeb("q")).toEqual([]);
  });

  it("fetchText refuses unsafe URLs without fetching (SSRF)", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await fetchText("http://127.0.0.1/x")).toBe("");
    expect(f).not.toHaveBeenCalled();
  });

  it("fetchText strips scripts + tags to readable text", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okHtml("<script>evil()</script><h1>Hello</h1><p>World</p>")));
    const t = await fetchText("https://a.com");
    expect(t).toContain("Hello");
    expect(t).toContain("World");
    expect(t).not.toContain("evil");
  });
});

describe("research — plan / synthesize", () => {
  it("planQueries splits the model output into queries", async () => {
    genOnce("what is ts\nhow ts compiles\nwhy use ts");
    expect(await planQueries("tell me about TS")).toEqual(["what is ts", "how ts compiles", "why use ts"]);
  });

  it("planQueries falls back to the question when the model returns nothing", async () => {
    genOnce("   \n  ");
    expect(await planQueries("original q")).toEqual(["original q"]);
  });

  it("synthesizeReport streams a cited report", async () => {
    streamYields("TypeScript adds types [1] and compiles to JS [2].");
    let out = "";
    for await (const c of synthesizeReport("q", [{ title: "A", url: "https://a", snippet: "" }], ["s"])) out += c;
    expect(out).toContain("[1]");
    expect(out).toContain("[2]");
  });
});

describe("research — researchStream orchestration", () => {
  it("runs plan→fetch→summarize→synthesize and ends with a cited report + sources", async () => {
    genOnce("query one"); // planQueries
    streamYields("summary."); // reused for summarize + synthesize (impl resets per call via mockImplementation)
    vi.stubGlobal("fetch", vi.fn(async (url: string) =>
      url.includes("duckduckgo")
        ? okHtml(`<a class="result__a" href="https://good.com">Good Source</a>`)
        : okHtml("<p>page body text</p>"),
    ));
    const events: ResearchEvent[] = [];
    for await (const ev of researchStream("what is x")) events.push(ev);

    expect(events.some((e) => e.stage === "plan" && e.status === "done")).toBe(true);
    expect(events.some((e) => e.stage === "fetch" && e.status === "done")).toBe(true);
    const last = events[events.length - 1];
    expect(last).toMatchObject({ stage: "synthesize", status: "done", done: true });
    expect(last.sources?.[0].url).toBe("https://good.com");
    expect(typeof last.report).toBe("string");
  });

  it("emits an honest no-results state (never hallucinates) when search is empty", async () => {
    genOnce("query one");
    vi.stubGlobal("fetch", vi.fn(async () => okHtml("<html>no results markup</html>")));
    const events: ResearchEvent[] = [];
    for await (const ev of researchStream("obscure q")) events.push(ev);
    const last = events[events.length - 1];
    expect(last.done).toBe(true);
    expect(last.sources).toEqual([]);
    expect(last.report).toMatch(/No web sources were found/i);
    // synthesize model was never invoked → no hallucinated report
    expect(generateTextStream).not.toHaveBeenCalled();
  });
});
