// O2 Faz 3 (docs/odyssey/05-features/research.md §FAZ 3) — RAG-ingest bridge.
// Reuses server/rag.ts's ragIndex/ragSearch (deps-injected here, mocked — no
// sqlite-vec/ollama in this suite); the engine writes one doc per summarized
// source under `research:<runId>:<n>` and reads back cross-run context before
// synthesis. RESEARCH_RAG_INGEST=0 (ragIngestEnabled:false) disables writes.
import { describe, it, expect, vi } from "vitest";
import { runResearch } from "../../server/research/engine";
import type { SourceSummary } from "../../server/research/summarize";

function mkSummary(url: string): SourceSummary {
  return { url, title: url, summary: `summary of ${url}`, keyPoints: [] };
}

const baseDeps = {
  planInitial: async () => ["q"],
  nextQueries: async () => [],
  search: async () => ({ source: "ddg" as const, results: [{ title: "A", url: "https://a", snippet: "s" }] }),
  fetchPage: async () => ({ title: "A", text: "full text" }),
  summarize: async (s: { url: string }) => mkSummary(s.url),
  buildReport: async (_q: string, sources: SourceSummary[]) => ({ report: sources.length ? "ok" : "no sources found", citations: [] }),
};

describe("RAG-ingest bridge (Faz 3)", () => {
  it("writes each summarized source to ragIndex under research:<runId>:<n>", async () => {
    const ragIndex = vi.fn(async (_docId: string, _text: string) => ({ id: "x", dim: 3 }));
    const out = await runResearch("Q", { ...baseDeps, ragIndex }, "run-123");
    expect(ragIndex).toHaveBeenCalledOnce();
    expect(ragIndex.mock.calls[0][0]).toBe("research:run-123:1");
    expect(ragIndex.mock.calls[0][1]).toBe("summary of https://a");
  });

  it("RESEARCH_RAG_INGEST=0 (ragIngestEnabled:false) → never calls ragIndex", async () => {
    const ragIndex = vi.fn(async () => ({ id: "x", dim: 3 }));
    await runResearch("Q", { ...baseDeps, ragIndex, ragIngestEnabled: false });
    expect(ragIndex).not.toHaveBeenCalled();
  });

  it("ragSearch pulls cross-run context before synthesis; passed through to buildReport", async () => {
    const ragSearch = vi.fn(async () => [{ id: "research:old:1", text: "prior finding", distance: 0.1 }]);
    const buildReport = vi.fn(async (_q: string, sources: SourceSummary[], ragContext?: unknown[]) => ({
      report: "ok",
      citations: [],
      ragContextLen: ragContext?.length ?? 0,
    }));
    const out = await runResearch("Q", { ...baseDeps, ragSearch, buildReport: buildReport as never });
    expect(ragSearch).toHaveBeenCalledWith("Q");
    expect((out.report as unknown as { ragContextLen: number }).ragContextLen).toBe(1);
  });

  it("empty index (nothing ever ingested) → ragSearch returns [] and synthesis proceeds honestly", async () => {
    const ragSearch = vi.fn(async () => []);
    const out = await runResearch("Q", { ...baseDeps, ragSearch });
    expect(out.report.report).toBe("ok");
  });
});
