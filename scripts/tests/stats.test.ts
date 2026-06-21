// v8 — pure observability stats (percentile / summarize / sloCheck).
import { describe, it, expect } from "vitest";
import { percentile, summarize, sloCheck } from "../../bin/host-bridge/lib/stats.mjs";

describe("percentile", () => {
  it("empty → 0", () => expect(percentile([], 0.5)).toBe(0));
  it("p50 of [10,20,30,40] (interpolated)", () => expect(percentile([10, 20, 30, 40], 0.5)).toBe(25));
  it("clamps p<=0 and p>=1 to bounds", () => {
    expect(percentile([5, 9], 0)).toBe(5);
    expect(percentile([5, 9], 1)).toBe(9);
  });
  it("p95 picks near-max", () => expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBeCloseTo(9.1));
});

describe("summarize", () => {
  it("empty → zeroed summary", () => {
    expect(summarize([])).toMatchObject({ total: 0, errors: 0, errorRate: 0, byTool: {} });
  });

  it("counts, error-rate, percentiles, per-tool", () => {
    const ev = [
      { tool: "a", duration_ms: 100, status: "ok", exit: 0 },
      { tool: "a", duration_ms: 300, status: "ok", exit: 0 },
      { tool: "b", duration_ms: 200, status: "error", exit: 1 },
      { tool: "b", duration_ms: 400, status: "ok", exit: 0 },
    ];
    const s = summarize(ev);
    expect(s.total).toBe(4);
    expect(s.errors).toBe(1);
    expect(s.errorRate).toBeCloseTo(0.25);
    expect(s.p50).toBe(250); // [100,200,300,400] → interp 250
    expect(s.avg).toBe(250);
    expect(s.byTool.a).toEqual({ count: 2, errors: 0 });
    expect(s.byTool.b).toEqual({ count: 2, errors: 1 });
  });

  it("treats nonzero exit as error even if status missing", () => {
    expect(summarize([{ tool: "x", duration_ms: 1, exit: 2 }]).errors).toBe(1);
  });
});

describe("sloCheck", () => {
  const now = 1_000_000_000_000;
  const mk = (ts_ms: number, error = false) => ({ ts_ms, status: error ? "error" : "ok", exit: error ? 1 : 0, duration_ms: 10 });

  it("no traffic in window → healthy, no alert", () => {
    const r = sloCheck([], { now });
    expect(r.alert).toBe(false);
    expect(r.sli).toBe(1);
  });

  it("filters out events older than the window", () => {
    const ev = [mk(now - 7200000, true), mk(now - 1000)]; // first is 2h old (outside 1h)
    const r = sloCheck(ev, { now, windowMs: 3600000 });
    expect(r.window).toBe(1);
    expect(r.errorRate).toBe(0);
  });

  it("burn-rate alert when error-rate exceeds budget", () => {
    // target 0.99 → budget 1%. 2/10 errors = 20% → burn 20x → alert.
    const ev = Array.from({ length: 10 }, (_, i) => mk(now - i * 1000, i < 2));
    const r = sloCheck(ev, { now, target: 0.99 });
    expect(r.errorRate).toBeCloseTo(0.2);
    expect(r.burnRate).toBeCloseTo(20);
    expect(r.alert).toBe(true);
  });

  it("within budget → no alert", () => {
    const ev = Array.from({ length: 200 }, (_, i) => mk(now - i * 1000, i < 1)); // 0.5% < 1%
    const r = sloCheck(ev, { now, target: 0.99 });
    expect(r.alert).toBe(false);
  });
});
