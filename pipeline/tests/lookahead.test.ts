import { describe, it, expect } from "vitest";
import { progress, shouldPrefetch, nextPlan, savedMs, renderLookahead, LOOKAHEAD_AT } from "../lib/lookahead";

describe("progress", () => {
  it("computes the ratio", () => {
    expect(progress(9, 12).ratio).toBe(0.75);
    expect(progress(18, 18).ratio).toBe(1);
  });

  it("clamps out-of-range inputs instead of producing a ratio above 1", () => {
    expect(progress(50, 10).ratio).toBe(1);
    expect(progress(-5, 10).done).toBe(0);
  });

  it("is 0 for an empty run rather than NaN", () => {
    expect(progress(0, 0).ratio).toBe(0);
  });
});

describe("shouldPrefetch", () => {
  // The operator's rule is 75 %; the gate asserts the constant so a silent drift to 0.8 or
  // 0.5 is a test failure rather than a behaviour change nobody notices.
  it("uses 0.75 as the trigger", () => {
    expect(LOOKAHEAD_AT).toBe(0.75);
  });

  it("fires at exactly the boundary and not before", () => {
    expect(shouldPrefetch(progress(13, 18), false)).toBe(false); // 0.722
    expect(shouldPrefetch(progress(14, 18), false)).toBe(true);  // 0.777
    expect(shouldPrefetch(progress(3, 4), false)).toBe(true);    // exactly 0.75
  });

  // Fire-once is the caller's latch made explicit: without it the trigger would re-fire on
  // every remaining step and start a new pool each time.
  it("never fires twice", () => {
    expect(shouldPrefetch(progress(18, 18), true)).toBe(false);
  });

  it("does not fire for an empty run", () => {
    expect(shouldPrefetch(progress(0, 0), false)).toBe(false);
  });

  it("honours a custom threshold", () => {
    expect(shouldPrefetch(progress(5, 10), false, 0.5)).toBe(true);
    expect(shouldPrefetch(progress(4, 10), false, 0.5)).toBe(false);
  });
});

describe("nextPlan", () => {
  const profiles = ["simple", "medium", "complex"];

  it("advances to the following profile", () => {
    const p = nextPlan("simple", profiles)!;
    expect(p.profile).toBe("medium");
    expect(p.reason).toMatch(/advancing simple → medium/);
  });

  it("wraps at the end of the sweep", () => {
    const p = nextPlan("complex", profiles)!;
    expect(p.profile).toBe("simple");
    expect(p.reason).toMatch(/wrapping/);
  });

  it("falls back to the first profile for an unknown current", () => {
    expect(nextPlan("nope", profiles)!.profile).toBe("simple");
  });

  it("returns null when there is nothing to plan", () => {
    expect(nextPlan("simple", [])).toBeNull();
  });

  it("carries the pool size and the work worth prefetching", () => {
    const p = nextPlan("simple", profiles, { poolSize: 5, questionOf: () => "q" })!;
    expect(p.poolSize).toBe(5);
    expect(p.question).toBe("q");
    expect(p.prefetch).toEqual(["search", "think"]);
  });
});

describe("savedMs", () => {
  // Only the OVERLAP counts. Preparation that ran after the current work finished bought
  // nothing, and reporting it as a gain would be flattering arithmetic.
  it("counts only the part that overlapped the remaining work", () => {
    expect(savedMs(3000, 200)).toBe(200);
    expect(savedMs(150, 900)).toBe(150);
  });

  it("is 0 when nothing overlapped", () => {
    expect(savedMs(0, 500)).toBe(0);
    expect(savedMs(undefined, 500)).toBe(0);
    expect(savedMs(500, 0)).toBe(0);
    expect(savedMs(-10, 500)).toBe(0);
  });
});

describe("renderLookahead", () => {
  const plan = { profile: "medium", question: "q", poolSize: 3, prefetch: ["search"] as ("search" | "think")[], reason: "r" };

  it("says plainly when the run was too short to trigger", () => {
    expect(renderLookahead({ fired: false }, 0)).toMatch(/not triggered/);
  });

  it("reports a failed preparation instead of implying a gain", () => {
    const s = renderLookahead({ fired: true, firedAt: 0.78, error: "docker down" }, 0);
    expect(s).toMatch(/preparation failed — docker down/);
    expect(s).not.toMatch(/overlapped/);
  });

  it("reports where it fired, what it warmed and the measured overlap", () => {
    const s = renderLookahead(
      { fired: true, firedAt: 0.78, plan: { ...plan, prefetch: ["search", "think"] }, warmed: 3, prefetched: ["search", "think"] },
      420,
    );
    expect(s).toContain("fired at 0.78");
    expect(s).toContain("medium");
    expect(s).toContain("warmed 3 container(s)");
    expect(s).toContain("overlapped 420ms");
  });

  it("says 'nothing' rather than an empty gap when no prefetch completed", () => {
    expect(renderLookahead({ fired: true, firedAt: 0.8, plan, warmed: 0, prefetched: [] }, 0))
      .toContain("prefetched nothing");
  });
});
