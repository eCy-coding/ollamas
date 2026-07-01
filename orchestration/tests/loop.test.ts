import { describe, it, expect } from "vitest";
import { isConverged, shouldContinue, renderRound, renderLoopReport, type LoopState } from "../bin/lib/loop";

const converged: LoopState = { acceptanceDone: 12, total: 12, gateClean: true, nextP1: 0, round: 1 };

describe("loop — convergence detection", () => {
  it("isConverged only when acceptance complete + gate clean + P1 drained", () => {
    expect(isConverged(converged)).toBe(true);
    expect(isConverged({ ...converged, acceptanceDone: 11 })).toBe(false);
    expect(isConverged({ ...converged, gateClean: false })).toBe(false);
    expect(isConverged({ ...converged, nextP1: 2 })).toBe(false);
  });

  it("isConverged false when total is zero (no criteria known)", () => {
    expect(isConverged({ acceptanceDone: 0, total: 0, gateClean: true, nextP1: 0, round: 1 })).toBe(false);
  });

  it("shouldContinue keeps looping when not converged and under the cap", () => {
    const notConverged: LoopState = { ...converged, nextP1: 2, round: 1 };
    expect(shouldContinue(notConverged, 3)).toBe(true);
  });

  it("shouldContinue stops at the round cap (bounded — never unstoppable)", () => {
    const notConverged: LoopState = { ...converged, nextP1: 2, round: 3 };
    expect(shouldContinue(notConverged, 3)).toBe(false);
  });

  it("shouldContinue stops immediately once converged even under the cap", () => {
    expect(shouldContinue(converged, 3)).toBe(false);
  });
});

describe("loop — rendering", () => {
  it("renderRound marks converged vs not", () => {
    expect(renderRound(converged)).toContain("CONVERGED ✅");
    expect(renderRound({ ...converged, nextP1: 2 })).toContain("not converged");
  });

  it("renderLoopReport shows CONVERGED verdict + no remaining section", () => {
    const md = renderLoopReport([converged], 3, "2026-07-02T00:00:00Z");
    expect(md).toContain("# E2E_LOOP.md");
    expect(md).toContain("## Verdict: CONVERGED ✅");
    expect(md).not.toContain("## Remaining");
  });

  it("renderLoopReport lists honest gaps when not converged after the cap", () => {
    const stuck: LoopState = { acceptanceDone: 11, total: 12, gateClean: false, nextP1: 2, round: 3 };
    const md = renderLoopReport([{ ...stuck, round: 1 }, { ...stuck, round: 2 }, stuck], 3, "2026-07-02T00:00:00Z");
    expect(md).toContain("NOT CONVERGED after 3 round(s)");
    expect(md).toContain("## Remaining");
    expect(md).toContain("1 acceptance criteria unticked");
    expect(md).toContain("GATE_SKIP");
    expect(md).toContain("2 P1 safe-additive");
  });
});
