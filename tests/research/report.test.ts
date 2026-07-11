// O2 Faz 4 (docs/odyssey/05-features/research.md §FAZ 4) — atıflı (cited) report
// synthesis. Anti-hallucination contract: every claim carries a [n] citation, an
// unattributed sentence is a bug (regex-checked), and an empty source list must
// produce an honest "no sources found" report rather than a fabricated one.
import { describe, it, expect } from "vitest";
import { buildReport } from "../../server/research/report";
import type { SourceSummary } from "../../server/research/summarize";

function mkSummary(url: string, summary: string): SourceSummary {
  return { url, title: url, summary, keyPoints: [] };
}

describe("buildReport", () => {
  it("honest-empty: no sources → 'no sources found', no fabricated report", async () => {
    const generate = async () => "should never be called";
    const out = await buildReport("What is X?", [], { generate });
    expect(out.report.toLowerCase()).toContain("no sources found");
    expect(out.citations).toEqual([]);
  });

  it("builds a numbered citation list matching the gathered sources", async () => {
    const sources = [mkSummary("https://a", "A says foo"), mkSummary("https://b", "B says bar")];
    const generate = async () => "Foo is true [1]. Bar is also true [2].";
    const out = await buildReport("Q", sources, { generate });
    expect(out.citations).toHaveLength(2);
    expect(out.citations[0]).toMatchObject({ n: 1, url: "https://a" });
    expect(out.citations[1]).toMatchObject({ n: 2, url: "https://b" });
    expect(out.report).toContain("[1]");
    expect(out.report).toContain("[2]");
  });

  it("rejects (regenerates as honest-empty) a synthesis with an uncited claim", async () => {
    const sources = [mkSummary("https://a", "A says foo")];
    // No [n] anywhere — an uncited claim is a contract violation, not a report to ship.
    const generate = async () => "Foo is definitely true, no source needed.";
    const out = await buildReport("Q", sources, { generate });
    expect(out.report).not.toBe("Foo is definitely true, no source needed.");
    expect(out.report.toLowerCase()).toMatch(/no sources found|could not attribute/);
  });

  it("deep:true + RESEARCH_DEEP_MODEL configured → routes to the deep model", async () => {
    const seen: string[] = [];
    const pickModel = (deep: boolean) => { const m = deep ? "deep-model" : "local-model"; seen.push(m); return m; };
    const generate = async () => "Claim [1].";
    await buildReport("Q", [mkSummary("https://a", "s")], { generate, deep: true, pickModel });
    expect(seen).toEqual(["deep-model"]);
  });

  it("deep:false (default) → routes to the local model", async () => {
    const seen: string[] = [];
    const pickModel = (deep: boolean) => { const m = deep ? "deep-model" : "local-model"; seen.push(m); return m; };
    const generate = async () => "Claim [1].";
    await buildReport("Q", [mkSummary("https://a", "s")], { generate, pickModel });
    expect(seen).toEqual(["local-model"]);
  });
});
