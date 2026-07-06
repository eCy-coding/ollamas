import { describe, it, expect } from "vitest";
import { pctOfLimit, approaching, limitFor } from "../server/key-limits";

// MATH §13 — rate-limit headroom (proactive rotation). These pure fns were previously UNTESTED; this file
// closes that gap. pctOfLimit binds on the TIGHTEST active limit (max over perMin/perDay) so a key rotates
// before the earliest-filling window exhausts.
describe("pctOfLimit — tightest active limit binds (max)", () => {
  it("takes the max of perMin/perDay ratios", () => {
    expect(pctOfLimit({ perMin: 5, perDay: 100 }, { perMin: 10, perDay: 1000 })).toBeCloseTo(0.5); // 0.5 vs 0.1 → 0.5
    expect(pctOfLimit({ perMin: 1, perDay: 900 }, { perMin: 10, perDay: 1000 })).toBeCloseTo(0.9); // 0.1 vs 0.9 → 0.9
  });
  it("an unlimited/unknown limit (0) contributes 0 — never blocks", () => {
    expect(pctOfLimit({ perMin: 999, perDay: 5 }, { perMin: 0, perDay: 1000 })).toBeCloseTo(0.005); // perMin ignored
    expect(pctOfLimit({ perMin: 10, perDay: 10 }, { perMin: 0, perDay: 0 })).toBe(0);              // both unlimited
  });
  it("pct is always ≥ 0 and monotone in usage", () => {
    const lim = { perMin: 20, perDay: 1000 };
    expect(pctOfLimit({ perMin: 0, perDay: 0 }, lim)).toBe(0);
    const a = pctOfLimit({ perMin: 5, perDay: 100 }, lim);
    const b = pctOfLimit({ perMin: 10, perDay: 100 }, lim);
    expect(b).toBeGreaterThanOrEqual(a); // more usage ⇒ pct never decreases
  });
});

describe("approaching — threshold gate at θ (proactive, before exhaustion)", () => {
  it("fires at/above the threshold, not below", () => {
    expect(approaching(0.79)).toBe(false);
    expect(approaching(0.8)).toBe(true);   // default θ = 0.8, inclusive
    expect(approaching(1.0)).toBe(true);
    expect(approaching(0.95, 0.9)).toBe(true);
    expect(approaching(0.85, 0.9)).toBe(false);
  });
});

describe("limitFor — known defaults + env override", () => {
  it("returns a known provider's default rate limit", () => {
    expect(limitFor("gemini", {} as NodeJS.ProcessEnv)).toEqual({ perMin: 20, perDay: 1000 });
  });
  it("unknown provider → unlimited (0/0), never a false block", () => {
    expect(limitFor("nonexistent", {} as NodeJS.ProcessEnv)).toEqual({ perMin: 0, perDay: 0 });
  });
  it("env overrides the default", () => {
    expect(limitFor("gemini", { KEY_LIMIT_GEMINI_PERMIN: "99" } as unknown as NodeJS.ProcessEnv).perMin).toBe(99);
  });
});
