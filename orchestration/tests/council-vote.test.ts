import { describe, it, expect } from "vitest";
import { tallyVotes, summarizeCouncil, COUNCIL_QUORUM, type LaneResult } from "../bin/lib/council";

const seat = (lane: string, model: string, ok: boolean, kinds: ("TASK" | "RISK" | "LANG")[]): LaneResult => ({
  lane, model, ok, findings: kinds.map((kind) => ({ lane, model, kind, text: `${kind} x` })),
});

describe("tallyVotes — per-lane weighted quorum", () => {
  it("majority of responding seats agree → EXECUTE", () => {
    const v = tallyVotes([
      seat("cli", "a", true, ["TASK"]),
      seat("cli", "b", true, ["TASK", "RISK"]),
      seat("cli", "c", true, ["LANG"]), // responded but no TASK/RISK → does not agree
    ]);
    expect(v[0].participating).toBe(3);
    expect(v[0].agreeing).toBe(2);
    expect(v[0].confidence).toBeCloseTo(2 / 3);
    expect(v[0].decision).toBe("EXECUTE"); // 0.66 > 0.6
  });

  it("below quorum → HOLD", () => {
    const v = tallyVotes([
      seat("cli", "a", true, ["TASK"]),
      seat("cli", "b", true, ["LANG"]),
      seat("cli", "c", true, ["LANG"]),
    ]);
    expect(v[0].confidence).toBeCloseTo(1 / 3);
    expect(v[0].decision).toBe("HOLD"); // 0.33 < 0.6
  });

  it("silent lane / no participants → HOLD (never act on silence)", () => {
    const v = tallyVotes([seat("cli", "a", false, ["TASK"])]); // did not respond
    expect(v[0].participating).toBe(0);
    expect(v[0].confidence).toBe(0);
    expect(v[0].decision).toBe("HOLD");
  });

  it("quorum threshold is exclusive (>0.6, exactly 0.6 → HOLD)", () => {
    // 3/5 = 0.6 exactly → not strictly greater → HOLD
    const seats = [
      ...Array(3).fill(0).map((_, i) => seat("x", `y${i}`, true, ["TASK"])),
      ...Array(2).fill(0).map((_, i) => seat("x", `n${i}`, true, ["LANG"])),
    ];
    const v = tallyVotes(seats);
    expect(v[0].confidence).toBeCloseTo(COUNCIL_QUORUM);
    expect(v[0].decision).toBe("HOLD");
  });
});

describe("summarizeCouncil — global decision", () => {
  it("EXECUTE when any lane clears quorum", () => {
    const s = summarizeCouncil([
      seat("cli", "a", true, ["TASK"]), seat("cli", "b", true, ["TASK"]),
      seat("web", "a", true, ["LANG"]),
    ]);
    expect(s.decision).toBe("EXECUTE");
    expect(s.votes.length).toBe(2);
  });
  it("HOLD when no lane clears quorum", () => {
    const s = summarizeCouncil([seat("cli", "a", true, ["LANG"])]);
    expect(s.decision).toBe("HOLD");
  });
});
