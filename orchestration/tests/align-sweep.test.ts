import { describe, it, expect } from "vitest";
import {
  isAlignableBase, paramProfileFor, toAlignAgg, selectBestAligned,
  regressionCheck, renderMatrix, alignedModelFor, type SweepRow,
} from "../bin/lib/align-sweep";
import { DEFAULT_ALIGN_PARAMS } from "../bin/lib/modelfile";

describe("isAlignableBase", () => {
  it("accepts real local base chat models", () => {
    for (const m of ["qwen3:8b", "qwen3:4b", "qwen3-coder:30b", "deepseek-r1:32b", "gpt-oss:20b", "phi4:latest"])
      expect(isAlignableBase(m)).toBe(true);
  });
  it("rejects cloud tails, embeddings, vision, existing -ca variants, and the custom reviewer", () => {
    for (const m of ["gpt-oss:120b-cloud", "qwen3-coder:480b-cloud", "nomic-embed-text:latest",
      "qwen2.5vl:32b", "qwen2.5vl:7b", "qwen3-8b-ca:latest", "ollamas-reviewer:latest"])
      expect(isAlignableBase(m)).toBe(false);
  });
});

describe("paramProfileFor", () => {
  it("returns a params object with a temperature for every family", () => {
    for (const m of ["qwen3:8b", "gpt-oss:20b", "phi4:latest", "deepseek-r1:32b", "totally-unknown:1b"]) {
      const p = paramProfileFor(m);
      expect(typeof p.temperature).toBe("number");
      expect(p.temperature).toBeGreaterThanOrEqual(0);
    }
  });
  it("an unknown model falls back to the default profile", () => {
    expect(paramProfileFor("totally-unknown:1b")).toEqual(DEFAULT_ALIGN_PARAMS);
  });
});

describe("toAlignAgg", () => {
  it("maps conformance-mean into the optimize Agg's correctRatio slot", () => {
    const a = toAlignAgg("qwen3-8b-ca", 0.93, 75.4);
    expect(a.model).toBe("qwen3-8b-ca");
    expect(a.correctRatio).toBe(0.93);
    expect(a.medianTokS).toBe(75.4);
  });
});

describe("selectBestAligned (reuses optimize.scoreAll)", () => {
  const row = (base: string, aligned: string, mean: number, tokS: number): SweepRow =>
    ({ base, aligned, baseMean: 0.5, alignedMean: mean, delta: mean - 0.5, tokS, byDimension: {} });
  it("picks the aligned variant with the best conformance × speed above the gate", () => {
    const rows = [row("qwen3:4b", "qwen3-4b-ca", 0.93, 92), row("gpt-oss:20b", "gpt-oss-20b-ca", 0.90, 90)];
    const best = selectBestAligned(rows, 52);
    expect(best?.model).toBe("qwen3-4b-ca"); // higher conformance + comparable speed
  });
  it("rejects a variant below the 0.7 conformance gate", () => {
    const rows = [row("weak:1b", "weak-1b-ca", 0.4, 200)];
    expect(selectBestAligned(rows, 52)).toBeNull();
  });
  it("null on empty", () => { expect(selectBestAligned([], 52)).toBeNull(); });
});

describe("regressionCheck", () => {
  it("passes on a gain and on parity", () => {
    expect(regressionCheck(0.26, 0.93).ok).toBe(true);
    expect(regressionCheck(1, 1).ok).toBe(true);
  });
  it("fails when the aligned variant regresses below the base", () => {
    expect(regressionCheck(1, 0.83).ok).toBe(false);
  });
  it("fails when the aligned variant is below the conformance floor", () => {
    expect(regressionCheck(0.2, 0.5, 0.7).ok).toBe(false); // 0.5 < floor 0.7
  });
});

describe("alignedModelFor", () => {
  it("resolves a base to its -ca variant tag", () => {
    expect(alignedModelFor("qwen3:8b")).toBe("qwen3-8b-ca");
  });
});

describe("renderMatrix", () => {
  it("renders a table with every row's base, aligned, and delta", () => {
    const rows: SweepRow[] = [
      { base: "qwen3:8b", aligned: "qwen3-8b-ca", baseMean: 1, alignedMean: 1, delta: 0, tokS: 75, byDimension: {} },
      { base: "qwen3:4b", aligned: "qwen3-4b-ca", baseMean: 0.26, alignedMean: 0.93, delta: 0.67, tokS: 92, byDimension: {} },
    ];
    const md = renderMatrix(rows);
    expect(md).toContain("qwen3-8b-ca");
    expect(md).toContain("qwen3-4b-ca");
    expect(md).toMatch(/\+67%|67%/);
  });
});
