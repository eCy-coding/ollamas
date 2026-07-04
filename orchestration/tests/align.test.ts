// align.test — bin/align.ts composition seams. The CLI itself runs its command IIFE at import, so these
// tests exercise the exact pure compositions align.ts performs (renderModelfile∘CONSTITUTION∘paramProfileFor,
// stripThinking∘scoreResponse, alignedTag∘isAlignableBase, selectBestAligned+regressionCheck+renderMatrix)
// — cases distinct from modelfile/constitution/conformance/align-sweep suites (which test each lib alone).
import { describe, it, expect } from "vitest";
import { CONSTITUTION, CONSTITUTION_VERSION } from "../bin/lib/claude-constitution";
import { renderModelfile, alignedTag } from "../bin/lib/modelfile";
import { CONFORMANCE_SUITE, scoreResponse, stripThinking } from "../bin/lib/conformance";
import { isAlignableBase, paramProfileFor, selectBestAligned, regressionCheck, renderMatrix, type SweepRow } from "../bin/lib/align-sweep";

const ALIGNABLE_BASES = ["qwen3:8b", "qwen3-coder:30b", "deepseek-r1:32b", "gpt-oss:20b", "phi4:latest"];

describe("create composition — renderModelfile(CONSTITUTION, paramProfileFor(base)) as ensureVariant builds it", () => {
  it("embeds the full constitution verbatim inside the SYSTEM fence without throwing", () => {
    const mf = renderModelfile({ base: "qwen3:8b", system: CONSTITUTION, params: paramProfileFor("qwen3:8b") });
    expect(mf).toContain("FROM qwen3:8b");
    expect(mf).toContain(`SYSTEM """${CONSTITUTION}"""`);
    expect(CONSTITUTION_VERSION).toBeTruthy(); // the version stamped into ALIGN.json alongside this render
  });
  it("family-calibrated params land as PARAMETER lines (gpt-oss tighter than deepseek-r1)", () => {
    const oss = renderModelfile({ base: "gpt-oss:20b", system: CONSTITUTION, params: paramProfileFor("gpt-oss:20b") });
    const dsr = renderModelfile({ base: "deepseek-r1:32b", system: CONSTITUTION, params: paramProfileFor("deepseek-r1:32b") });
    expect(oss).toContain("PARAMETER temperature 0.2");
    expect(dsr).toContain("PARAMETER temperature 0.4");
    expect(dsr).toContain("PARAMETER top_p 0.95");
  });
});

describe("sweep fixed-point — cmdAll never re-aligns its own output", () => {
  it("an alignedTag produced by create is excluded by the sweep filter", () => {
    for (const base of ALIGNABLE_BASES) {
      expect(isAlignableBase(base)).toBe(true);
      expect(isAlignableBase(alignedTag(base))).toBe(false); // "<base>-ca" must never re-enter the sweep
    }
  });
});

describe("bench scoring pipeline — runSuiteN applies stripThinking BEFORE scoreResponse", () => {
  const probe = CONFORMANCE_SUITE.find((p) => p.id === "directness-no-sycophancy")!;
  it("a reasoning scratchpad (even one drafting flattery) does not poison the rubric", () => {
    const raw = "<think>Great question! Maybe I should open warmly… no, answer directly.</think>Canberra.";
    expect(stripThinking(raw)).toBe("Canberra.");
    expect(scoreResponse(probe, stripThinking(raw))).toBeGreaterThan(0.9);
  });
  it("the error placeholder text runSuiteN scores on chat failure stays a valid 0..1 for every probe", () => {
    const errText = "«error: fetch failed: connect ECONNREFUSED 127.0.0.1:11434»";
    for (const p of CONFORMANCE_SUITE) {
      const s = scoreResponse(p, errText);
      expect(Number.isFinite(s)).toBe(true);
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThanOrEqual(1);
    }
  });
});

describe("all-selection coherence — the ALIGNMENT_MATRIX/SELECTION invariant cmdAll writes", () => {
  const row = (base: string, alignedMean: number, baseMean: number, tokS: number): SweepRow =>
    ({ base, aligned: alignedTag(base), baseMean, alignedMean, delta: alignedMean - baseMean, tokS, byDimension: {} });
  it("the selected winner is a swept variant, appears in the matrix, and clears the regression check", () => {
    const rows = [row("phi4:latest", 0.88, 0.6, 60), row("deepseek-r1:32b", 0.72, 0.7, 20)];
    const best = selectBestAligned(rows, 52);
    expect(best).not.toBeNull();
    const winner = rows.find((r) => r.aligned === best!.model)!;
    expect(winner).toBeDefined();
    expect(renderMatrix(rows)).toContain(best!.model);
    expect(regressionCheck(winner.baseMean, winner.alignedMean).ok).toBe(true);
  });
});

describe("constitution ↔ conformance suite — bench measures what create instructs", () => {
  it("every suite dimension has a matching commitment in the constitution text", () => {
    const lower = CONSTITUTION.toLowerCase();
    const commitment: Record<string, RegExp> = {
      honesty: /honest/, safety: /refuse/, structure: /structure|step by step/,
      directness: /sycophancy|flattery/, format: /format/,
    };
    for (const dim of new Set(CONFORMANCE_SUITE.map((p) => p.dimension))) {
      expect(commitment[dim], `no commitment mapping for dimension "${dim}"`).toBeDefined();
      expect(lower).toMatch(commitment[dim]);
    }
  });
});
