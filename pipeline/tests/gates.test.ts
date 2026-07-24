import { describe, it, expect } from "vitest";
import { evaluate, decide, renderGates, DEFAULT_THRESHOLDS, type Evidence } from "../lib/gates";
import { summarize } from "../lib/stats";

const good: Evidence = {
  steps: {
    think: summarize([200, 210, 220]),
    think_sandbox: summarize([180, 190, 195]),
    sandbox_test: summarize([300, 320, 340]),
  },
  total: summarize([1500, 1600, 1700]),
  errorRatePct: 0,
  coveragePct: 95,
  security: { high: 0, critical: 0 },
  chaosSuccess: 0.99,
  totals: [1500, 1600, 1700],
};

const gate = (name: string, ev: Evidence) => evaluate(ev).find((g) => g.name === name)!;

describe("evaluate", () => {
  it("passes every gate on healthy evidence", () => {
    expect(evaluate(good).every((g) => g.ok)).toBe(true);
  });

  // The single most dangerous bug this gate could have: an absent measurement reading as 0
  // and clearing a "≤" threshold — green exactly when a step produced nothing.
  it("treats a MISSING measurement as failure, not as zero", () => {
    const g = gate("p95(think)", { ...good, steps: {} });
    expect(g.ok).toBe(false);
    expect(g.measured).toBeNull();
    expect(g.detail).toMatch(/no measurement/);
  });

  it("takes the WORST of the think_* family against one budget", () => {
    const ev: Evidence = { ...good, steps: { think: summarize([100]), think_final: summarize([9000]) } };
    const g = gate("p95(think)", ev);
    expect(g.measured).toBe(9000);
    expect(g.ok).toBe(false);
  });

  it("fails coverage below the floor and passes at exactly the floor", () => {
    expect(gate("coverage", { ...good, coveragePct: 89.9 }).ok).toBe(false);
    expect(gate("coverage", { ...good, coveragePct: 90 }).ok).toBe(true);
  });

  it("blocks on any high/critical security finding", () => {
    expect(gate("security", { ...good, security: { high: 1 } }).ok).toBe(false);
    expect(gate("security", { ...good, security: { critical: 2, high: 0 } }).measured).toContain("critical=2");
    expect(gate("security", { ...good, security: { low: 12 } }).ok).toBe(true);
  });

  it("reports a scan that never ran as MISS, not clean", () => {
    const g = gate("security", { ...good, security: undefined });
    expect(g.ok).toBe(false);
    expect(g.detail).toMatch(/did not run/);
  });

  it("reports chaos that never ran as MISS", () => {
    const g = gate("chaos", { ...good, chaosSuccess: undefined });
    expect(g.ok).toBe(false);
    expect(g.measured).toBeNull();
  });

  it("fails chaos below the pass threshold", () => {
    expect(gate("chaos", { ...good, chaosSuccess: 0.94 }).ok).toBe(false);
    expect(gate("chaos", { ...good, chaosSuccess: 0.95 }).ok).toBe(true);
  });

  it("fails when the error rate exceeds the budget", () => {
    expect(gate("error_rate", { ...good, errorRatePct: 0.5 }).ok).toBe(false);
  });
});

describe("decide", () => {
  it("go_ahead only when every gate passes", () => {
    expect(decide(good).go_ahead).toBe(true);
    const bad = decide({ ...good, coveragePct: 10 });
    expect(bad.go_ahead).toBe(false);
    expect(bad.failed).toContain("coverage");
    expect(bad.reason).toMatch(/failed: coverage/);
  });

  // Weak evidence must NOT silently relax the gates, and must NOT be hidden either.
  it("flags weak evidence without flipping the decision", () => {
    const d = decide({ ...good, totals: [1500] });
    expect(d.go_ahead).toBe(true);
    expect(d.weak_evidence).toBe(true);
    expect(d.reason).toMatch(/evidence is weak/);
  });

  it("flags a noisy run set as weak", () => {
    const d = decide({ ...good, totals: [100, 5000, 200, 9000] });
    expect(d.weak_evidence).toBe(true);
  });

  it("does not flag a healthy run set", () => {
    expect(decide(good).weak_evidence).toBe(false);
  });

  it("honours custom thresholds", () => {
    const strict = { ...DEFAULT_THRESHOLDS, latency_p95_total_ms: 10 };
    expect(decide(good, strict).go_ahead).toBe(false);
  });
});

describe("renderGates", () => {
  it("labels missing measurements MISS and failures FAIL", () => {
    const lines = renderGates(evaluate({ ...good, coveragePct: 1, security: undefined }));
    expect(lines.some((l) => l.startsWith("  FAIL") && l.includes("coverage"))).toBe(true);
    expect(lines.some((l) => l.startsWith("  MISS") && l.includes("security"))).toBe(true);
    expect(lines.some((l) => l.startsWith("  PASS"))).toBe(true);
  });
});
