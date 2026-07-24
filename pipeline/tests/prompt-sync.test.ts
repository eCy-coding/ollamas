import { describe, it, expect } from "vitest";
import { renderBlock, spliceBlock, hasBlock, BEGIN, END } from "../lib/prompt-sync";
import { buildReport, type EnvMeta } from "../lib/report";
import { summarize } from "../lib/stats";
import { decide } from "../lib/gates";

const env: EnvMeta = {
  timestamp: "2026-07-24T13:30:00Z", run_id: "abcd1234-0000-0000-0000-000000000000",
  git_sha: "deadbeefcafe1234", os: "darwin 24.6.0", arch: "arm64",
  cpu_count: 16, mem_gb: 51.5, node: "v24.16.0",
};

const report = (over: Partial<Parameters<typeof buildReport>[0]> = {}) => buildReport({
  workflow_version: "3.0",
  env,
  profile: "simple",
  steps: [{ id: "think", action: "think", ok: true, duration_ms: 900 }],
  step_summaries: { think: summarize([900]) },
  total: summarize([7000, 7200, 6800]),
  cache: { hits: 4, misses: 5 },
  parallelism: 1.2,
  decision: decide({
    steps: { think: summarize([900]), sandbox_test: summarize([40]) },
    total: summarize([7000, 7200, 6800]),
    errorRatePct: 0, coveragePct: 99.4, security: { high: 0 }, chaosSuccess: 1,
    totals: [7000, 7200, 6800],
  }),
  audit: { complete: false, missing: ["coverage"] },
  ...over,
});

const input = (over = {}) => ({
  report: report(),
  stepSummaries: { think: summarize([900, 1100]), sandbox_test: summarize([40, 45]) },
  missing: ["coverage"],
  corrections: [],
  ...over,
});

describe("renderBlock", () => {
  it("carries the measured distribution, not just a median", () => {
    const b = renderBlock(input());
    for (const k of ["p50", "p95", "p99", "p999", "stddev", "cv", "95% CI"]) expect(b).toContain(k);
    expect(b).toContain("| runs (n) | 3 |");
  });

  it("stamps run id, timestamp and environment for reproducibility", () => {
    const b = renderBlock(input());
    expect(b).toContain("abcd1234-0000-0000-0000-000000000000");
    expect(b).toContain("2026-07-24T13:30:00Z");
    expect(b).toContain("darwin 24.6.0/arm64");
    expect(b).toContain("`deadbeef`");
  });

  it("orders steps worst-p95-first, because that is where the budget goes", () => {
    const b = renderBlock(input());
    expect(b.indexOf("| think |")).toBeLessThan(b.indexOf("| sandbox_test |"));
  });

  // Gate values come from the report's OWN decision, while the step table comes from
  // `stepSummaries`. In a real run both are built from the same aggregate; the fixture feeds
  // them different sets on purpose, and this pins which one each column reads.
  it("labels each gate PASS / FAIL / MISS with its limit, sourced from the decision", () => {
    const b = renderBlock(input());
    expect(b).toMatch(/\| p95\(think\) \| FAIL 900 \/ 350 \|/);
    expect(b).toMatch(/\| chaos \| PASS 1 \/ 0\.95 \|/);
    expect(b).toMatch(/\| coverage \| PASS 99\.4 \/ 90 \|/);
    expect(b).toContain("| think | 1100 | 2 |"); // table still reads stepSummaries
  });

  it("reports self-audit gaps rather than claiming completeness", () => {
    expect(renderBlock(input())).toContain("self-audit gaps: coverage");
    expect(renderBlock(input({ missing: [], report: report({ audit: { complete: true, missing: [] } }) })))
      .toContain("no blind spots");
  });

  // A prompt that keeps its disproven claims teaches them to every model that reads it.
  it("includes corrections when the source prompt was measured wrong", () => {
    const b = renderBlock(input({ corrections: ["p95(think) ≤ 350 ms is unreachable with real LLM calls"] }));
    expect(b).toContain("Corrections to this prompt");
    expect(b).toContain("unreachable with real LLM calls");
  });

  it("omits the corrections section when there are none", () => {
    expect(renderBlock(input())).not.toContain("Corrections to this prompt");
  });

  it("is delimited so splicing can find it", () => {
    const b = renderBlock(input());
    expect(b.startsWith(BEGIN)).toBe(true);
    expect(b.trimEnd().endsWith(END)).toBe(true);
  });
});

describe("spliceBlock", () => {
  it("appends when the document has no block yet", () => {
    const out = spliceBlock("# My prompt\n\nsome prose\n", renderBlock(input()));
    expect(out).toContain("# My prompt");
    expect(out).toContain("some prose");
    expect(hasBlock(out)).toBe(true);
  });

  // The prompt is the operator's document: everything outside the markers must survive
  // byte-for-byte, or the tool is rewriting prose it does not own.
  it("replaces an existing block and preserves everything around it", () => {
    const first = spliceBlock("HEAD\n\nbody\n", renderBlock(input()));
    const second = spliceBlock(first, renderBlock(input({
      report: report({ total: summarize([1, 2, 3]) }),
    })));
    expect(second.startsWith("HEAD\n\nbody")).toBe(true);
    expect(second.split(BEGIN)).toHaveLength(2);   // exactly one block, not two
    expect(second).toContain("| p50 | 2 ms |");    // new numbers
    expect(second).not.toContain("| p50 | 7000 ms |");
  });

  it("keeps trailing content after the block intact", () => {
    const doc = `intro\n${BEGIN}\nold\n${END}\nTAIL-MARKER\n`;
    const out = spliceBlock(doc, renderBlock(input()));
    expect(out).toContain("intro");
    expect(out).toContain("TAIL-MARKER");
    expect(out).not.toContain("\nold\n");
  });

  it("handles an empty/nullish document", () => {
    expect(hasBlock(spliceBlock("", renderBlock(input())))).toBe(true);
    expect(hasBlock(spliceBlock(undefined as never, renderBlock(input())))).toBe(true);
  });

  it("ignores a malformed block (END before BEGIN) and appends instead of corrupting", () => {
    const doc = `${END}\nstuff\n`;
    const out = spliceBlock(doc, renderBlock(input()));
    expect(out).toContain("stuff");
    expect(out.indexOf(BEGIN)).toBeGreaterThan(0);
  });
});

describe("hasBlock", () => {
  it("detects presence and rejects partial markers", () => {
    expect(hasBlock("no markers")).toBe(false);
    expect(hasBlock(`${BEGIN} only begin`)).toBe(false);
    expect(hasBlock(`${BEGIN}\nx\n${END}`)).toBe(true);
  });
});
