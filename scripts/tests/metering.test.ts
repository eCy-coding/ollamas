// Scripts domain v11 — metering core. Tier-weighted billable units + cost, period
// grouping, budget breach, and empty-stream safety (no NaN).
import { describe, test, expect } from "vitest";
import { meter, filterPeriod, periodOf, DEFAULT_TIER_WEIGHTS } from "../../bin/host-bridge/lib/metering.mjs";

const ev = (tool: string, exit = 0, ts = "2026-06-10T00:00:00.000Z") => ({ tool, exit, status: exit ? "error" : "ok", ts, ts_ms: Date.parse(ts) });

describe("metering core", () => {
  test("empty stream → zeros, no NaN", () => {
    const m = meter([], { rate: 0.01 });
    expect(m.totals).toEqual({ calls: 0, errors: 0, billableUnits: 0, estCost: 0 });
    expect(m.byTool).toEqual({});
    expect(Number.isNaN(m.totals.estCost)).toBe(false);
  });

  test("tier-weighted billable units + est cost", () => {
    // 2× safe (w1) + 1× host (w3) = 5 units; rate 0.01 → cost 0.05
    const events = [ev("run_tests"), ev("git_ops"), ev("git_commit")];
    const toolTier = { run_tests: "safe", git_ops: "safe", git_commit: "host" };
    const m = meter(events, { toolTier, rate: 0.01 });
    expect(m.totals.billableUnits).toBe(5);
    expect(m.totals.estCost).toBe(0.05);
    expect(m.byTool.git_commit.billableUnits).toBe(DEFAULT_TIER_WEIGHTS.host);
    expect(m.byTool.run_tests.count).toBe(1);
  });

  test("errors counted per tool and in totals", () => {
    const m = meter([ev("build_app", 1), ev("build_app", 0)], { toolTier: { build_app: "host" } });
    expect(m.byTool.build_app.count).toBe(2);
    expect(m.byTool.build_app.errors).toBe(1);
    expect(m.totals.errors).toBe(1);
  });

  test("budget breach flagged", () => {
    const events = Array.from({ length: 10 }, () => ev("self_heal"));
    const m = meter(events, { toolTier: { self_heal: "host" }, rate: 1, budget: 5 });
    expect(m.totals.estCost).toBe(30); // 10×3×1
    expect(m.overBudget).toBe(true);
    const under = meter(events, { toolTier: { self_heal: "host" }, rate: 1, budget: 1000 });
    expect(under.overBudget).toBe(false);
  });

  test("period grouping via periodOf + filterPeriod", () => {
    const events = [ev("run_tests", 0, "2026-05-20T00:00:00.000Z"), ev("run_tests", 0, "2026-06-01T00:00:00.000Z")];
    expect(periodOf(events[0])).toBe("2026-05");
    const june = filterPeriod(events, "2026-06");
    expect(june.length).toBe(1);
    expect(meter(june).totals.calls).toBe(1);
  });

  test("unknown tool defaults to safe weight", () => {
    const m = meter([ev("mystery")], { rate: 2 });
    expect(m.byTool.mystery.tier).toBe("safe");
    expect(m.byTool.mystery.billableUnits).toBe(1);
    expect(m.totals.estCost).toBe(2);
  });
});
