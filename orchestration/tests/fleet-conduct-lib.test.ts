import { describe, it, expect } from "vitest";
import { extractOneProposal } from "../bin/lib/fleet-conduct-lib";

const ONE = `## Plan: add a guard
## Change: harden x
## Edit:
### file: x.ts
<<<<<<< SEARCH
const a = 1;
=======
const a = 2;
>>>>>>> REPLACE
## Test: a is 2
VERDICT: DONE.`;

describe("extractOneProposal", () => {
  it("returns a single proposal unchanged (one copy, VERDICT-terminated)", () => {
    const r = extractOneProposal([ONE]);
    expect(r.startsWith("## Plan: add a guard")).toBe(true);
    expect(r.trimEnd().endsWith("VERDICT: DONE.")).toBe(true);
  });

  it("drops a repeated 2nd copy (the living-worker dup-block root cause)", () => {
    // the model emitted the whole block TWICE
    const r = extractOneProposal([ONE + "\n" + ONE]);
    // only ONE SEARCH block survives (the 2nd copy is after the first VERDICT → cut)
    expect((r.match(/<<<<<<< SEARCH/g) ?? []).length).toBe(1);
    expect((r.match(/VERDICT:/g) ?? []).length).toBe(1);
  });

  it("dup across TWO messages is still collapsed to one", () => {
    const r = extractOneProposal([ONE, ONE]);
    expect((r.match(/<<<<<<< SEARCH/g) ?? []).length).toBe(1);
  });

  it("starts at ## Change when there is no ## Plan", () => {
    const noPlan = "chatter before\n## Change: y\nbody\nVERDICT: DONE";
    const r = extractOneProposal([noPlan]);
    expect(r.startsWith("## Change: y")).toBe(true);
  });

  it("falls back to the last message when no marker is present", () => {
    expect(extractOneProposal(["noise", "final answer"])).toBe("final answer");
  });

  it("keeps the whole body when there is no VERDICT line", () => {
    const r = extractOneProposal(["## Change: z\nbody line"]);
    expect(r).toContain("body line");
  });

  it("handles non-array input safely", () => {
    expect(extractOneProposal(null)).toBe("");
    expect(extractOneProposal(undefined)).toBe("");
  });
});
