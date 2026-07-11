// O2 Faz 2 (docs/odyssey/05-features/research.md §FAZ 2) — planner (query-decompose)
// + engine (round loop). Everything is deps-injected/mocked — no network, no LLM,
// no ollama — so the loop's stopping/guard behavior is deterministic.
import { describe, it, expect, vi } from "vitest";
import { planInitialQueries, nextQueries } from "../../server/research/planner";
import { runResearch } from "../../server/research/engine";
import type { SourceSummary } from "../../server/research/summarize";

describe("planInitialQueries", () => {
  it("decomposes a question into 2-4 sub-queries", async () => {
    const generate = async () => "1. what is X\n2. how does X compare to Y\n3. X performance benchmarks";
    const queries = await planInitialQueries("Tell me about X", { generate });
    expect(queries.length).toBeGreaterThanOrEqual(2);
    expect(queries.length).toBeLessThanOrEqual(4);
  });

  it("clamps to RESEARCH_MAX_QUERIES even if the LLM returns more", async () => {
    const generate = async () => Array.from({ length: 10 }, (_, i) => `${i + 1}. query ${i}`).join("\n");
    const queries = await planInitialQueries("Q", { generate, maxQueries: 4 });
    expect(queries.length).toBe(4);
  });

  it("empty/unparsable reply → falls back to [question] (min 1 query)", async () => {
    const generate = async () => "";
    const queries = await planInitialQueries("the raw question", { generate });
    expect(queries).toEqual(["the raw question"]);
  });
});

describe("nextQueries", () => {
  it("gap detected → returns a new follow-up query", async () => {
    const generate = async () => "1. what about Z, the missing angle";
    const q = await nextQueries("Q", [{ url: "u", title: "t", summary: "s", keyPoints: [] }], { generate });
    expect(q.length).toBeGreaterThan(0);
  });

  it("no gap → empty array (stop signal)", async () => {
    const generate = async () => "none";
    const q = await nextQueries("Q", [], { generate });
    expect(q).toEqual([]);
  });
});

function mkSummary(url: string): SourceSummary {
  return { url, title: url, summary: `summary of ${url}`, keyPoints: [] };
}

describe("runResearch (engine loop)", () => {
  it("plans → fetches → summarizes → synthesizes; emits the 5-step progress vocabulary", async () => {
    const steps: string[] = [];
    const onProgress = (step: string) => steps.push(step);
    const out = await runResearch("What is ollama?", {
      planInitial: async () => ["ollama basics"],
      nextQueries: async () => [], // stop after round 1
      search: async () => ({ source: "ddg", results: [{ title: "Ollama", url: "https://ollama.com", snippet: "s" }] }),
      fetchPage: async (url: string) => ({ title: "Ollama", text: `full text for ${url}` }),
      summarize: async (s) => mkSummary(s.url),
      buildReport: async (_q, sources) => ({ report: "# Report", citations: sources.map((s, i) => ({ n: i + 1, ...s })) }),
      onProgress,
    });
    expect(out.question).toBe("What is ollama?");
    expect(out.sources.length).toBe(1);
    expect(out.rounds.length).toBe(1);
    expect(out.report.report).toBe("# Report");
    for (const must of ["plan", "fetch", "summarize", "synthesize"]) {
      expect(steps).toContain(must);
    }
  });

  it("stops after RESEARCH_MAX_ROUNDS even if nextQueries never empties (token-explosion guard)", async () => {
    let round = 0;
    const out = await runResearch("Q", {
      planInitial: async () => ["q0"],
      nextQueries: async () => { round++; return [`q${round}`]; }, // always proposes a new query
      search: async () => ({ source: "ddg", results: [] }),
      fetchPage: async () => null,
      summarize: async (s) => mkSummary(s.url),
      buildReport: async () => ({ report: "x", citations: [] }),
      maxRounds: 3,
    });
    expect(out.rounds.length).toBeLessThanOrEqual(3);
  });

  it("query-repeat guard: a query already processed is never re-run", async () => {
    const searched: string[] = [];
    await runResearch("Q", {
      planInitial: async () => ["dup", "dup"], // same query twice in the initial plan
      nextQueries: async () => ["dup"], // and again on round 2
      search: async (q: string) => { searched.push(q); return { source: "ddg", results: [] }; },
      fetchPage: async () => null,
      summarize: async (s) => mkSummary(s.url),
      buildReport: async () => ({ report: "x", citations: [] }),
      maxRounds: 3,
    });
    const dupCount = searched.filter((q) => q === "dup").length;
    expect(dupCount).toBe(1);
  });

  it("empty search results still summarizes gracefully (no crash on 0 sources)", async () => {
    const out = await runResearch("Q", {
      planInitial: async () => ["q"],
      nextQueries: async () => [],
      search: async () => ({ source: "ddg", results: [] }),
      fetchPage: async () => null,
      summarize: async (s) => mkSummary(s.url),
      buildReport: async (_q, sources) => ({ report: sources.length ? "x" : "no sources found", citations: [] }),
    });
    expect(out.sources).toEqual([]);
    expect(out.report.report).toBe("no sources found");
  });
});
