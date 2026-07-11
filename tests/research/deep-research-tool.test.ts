// O2 Faz 7 (docs/odyssey/05-features/research.md §FAZ 7) — deep_research exposed
// via the ToolRegistry choke-point (server/tool-registry.ts). Adding it here is
// the ONLY dispatch path: it becomes visible in ToolRegistry.list() (the exact
// call /mcp `tools/list` makes — server/mcp/server.ts:93) automatically, no
// second MCP code path. The pipeline itself is swapped for a deterministic fake
// via the shared test seam (server/research/pipeline.ts) — no network/ollama.
import { describe, test, expect, afterEach } from "vitest";
import { ToolRegistry, type ToolCtx } from "../../server/tool-registry";
import { _setResearchPipelineTestDeps } from "../../server/research/pipeline";
import { getCollisions } from "../../server/mcp/supervisor";

const ctx = (): ToolCtx => ({ isLive: true, workspaceRoot: "/ws", autoApply: false, deps: {} as never });

afterEach(() => {
  _setResearchPipelineTestDeps(undefined);
});

describe("deep_research tool (ToolRegistry choke-point)", () => {
  test("registered with tier 'host' and a {question, deep?, maxRounds?} schema", () => {
    expect(ToolRegistry.has("deep_research")).toBe(true);
    expect(ToolRegistry.tier("deep_research")).toBe("host");
    const info = ToolRegistry.info("deep_research")!;
    const props = info.schema.function.parameters.properties;
    expect(props.question).toBeTruthy();
    expect(props.deep).toBeTruthy();
    expect(props.maxRounds).toBeTruthy();
    expect(info.schema.function.parameters.required).toContain("question");
  });

  test("invoke → runs the pipeline (mocked) → {report, sources}", async () => {
    _setResearchPipelineTestDeps({
      planInitial: async () => ["q"],
      nextQueries: async () => [],
      search: async () => ({ source: "ddg" as const, results: [{ title: "T", url: "https://t", snippet: "s" }] }),
      fetchPage: async () => ({ title: "T", text: "full text" }),
      summarize: async (s) => ({ url: s.url, title: s.title, summary: "s", keyPoints: [] }),
      buildReport: async (_q, sources) => ({
        report: sources.map((s, i) => `claim [${i + 1}]`).join(" "),
        citations: sources.map((s, i) => ({ n: i + 1, title: s.title, url: s.url, domain: "t" })),
      }),
    });
    const r = await ToolRegistry.execute("deep_research", { question: "why?" }, ctx());
    expect(r.ok).toBe(true);
    const out = r.output as { report: string; sources: unknown[] };
    expect(out.report).toContain("[1]");
    expect(out.sources).toHaveLength(1);
  });

  test("missing 'question' → ok:false, not a throw", async () => {
    const r = await ToolRegistry.execute("deep_research", {}, ctx());
    expect(r.ok).toBe(false);
  });

  test("visible in ToolRegistry.list() — the exact source /mcp tools/list reads", () => {
    const names = ToolRegistry.list().map((t) => t.name);
    expect(names).toContain("deep_research");
  });

  test("federation collision check is untouched — no upstream means no collision surfaced", () => {
    // getCollisions() reports names claimed by >1 upstream; with none registered here,
    // deep_research (a built-in, not an upstream tool) can never appear.
    expect(getCollisions().find((c) => c.tool === "deep_research")).toBeUndefined();
  });
});
