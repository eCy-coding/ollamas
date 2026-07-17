import { describe, it, expect } from "vitest";
import {
  parseOrgChart, assignRole, wilsonLower, actorStats, errorSignature, detectRecurrence,
  buildDispatchPrompt, recordOutcome,
  type OrgChart, type LedgerEntry, type TaskSpec,
} from "../bin/lib/organization";

const CHART_JSON = {
  version: 1,
  ts: "2026-07-18T00:00:00Z",
  actors: [
    { id: "emre", kind: "operator", role: "T0", duties: [], capabilities: ["decision"], reportsTo: null, escalatesTo: null, costRank: 3 },
    { id: "conductor", kind: "model", role: "Conductor", duties: [], capabilities: ["code", "conduct"], reportsTo: "emre", escalatesTo: "joker", model: "qwen3-coder:30b", costRank: 0 },
    { id: "coder-b", kind: "model", role: "Coder B", duties: [], capabilities: ["code"], reportsTo: "conductor", escalatesTo: "conductor", model: "qwen3:8b", costRank: 0 },
    { id: "joker", kind: "model", role: "Joker", duties: [], capabilities: ["review", "code"], reportsTo: "conductor", escalatesTo: "emre", model: "qwen3:8b", costRank: 1 },
    { id: "odysseus", kind: "service", role: "External", duties: [], capabilities: ["research"], reportsTo: "emre", escalatesTo: "conductor", costRank: 2 },
  ],
};
function chart(): OrgChart { return parseOrgChart(JSON.parse(JSON.stringify(CHART_JSON))); }

function outcome(actorId: string, ok: boolean, i: number, taskId = "t"): LedgerEntry {
  return { type: "outcome", tier: ok ? "episodic" : "learned", ts: `2026-07-18T0${i}:00:00Z`, taskId, actorId, ok, summary: ok ? "ok" : "fail" };
}

describe("wilsonLower", () => {
  it("bounds: n=0 → 0; results in [0,1]", () => {
    expect(wilsonLower(0, 0)).toBe(0);
    expect(wilsonLower(10, 10)).toBeGreaterThan(0);
    expect(wilsonLower(10, 10)).toBeLessThan(1);
    expect(wilsonLower(0, 10)).toBeGreaterThanOrEqual(0);
  });
  it("small-n honesty: 1/1 does NOT outrank 9/10", () => {
    expect(wilsonLower(9, 10)).toBeGreaterThan(wilsonLower(1, 1));
  });
  it("monotone in successes at fixed n", () => {
    expect(wilsonLower(8, 10)).toBeGreaterThan(wilsonLower(5, 10));
  });
  it("more evidence at same rate tightens the bound upward", () => {
    expect(wilsonLower(90, 100)).toBeGreaterThan(wilsonLower(9, 10));
  });
});

describe("actorStats", () => {
  it("aggregates only outcome entries and computes wilson", () => {
    const entries: LedgerEntry[] = [
      { type: "dispatch", tier: "episodic", ts: "t", taskId: "t", actorId: "a", summary: "d" },
      outcome("a", true, 1), outcome("a", true, 2), outcome("a", false, 3),
      outcome("b", true, 4),
    ];
    const m = actorStats(entries);
    expect(m.get("a")).toMatchObject({ n: 3, ok: 2 });
    expect(m.get("a")!.wilson).toBeCloseTo(wilsonLower(2, 3), 10);
    expect(m.get("b")!.n).toBe(1);
  });
});

describe("errorSignature + detectRecurrence", () => {
  const base = { taskId: "t1", actorId: "conductor", ts: "2026-07-18T01:00:00Z", ok: false, summary: "gate red" };
  it("signature is deterministic and actor-scoped", () => {
    const s1 = errorSignature({ ...base, error: "tsc failed on router.ts" });
    const s2 = errorSignature({ ...base, error: "tsc failed on router.ts" });
    const s3 = errorSignature({ ...base, actorId: "joker", error: "tsc failed on router.ts" });
    expect(s1).toBe(s2);
    expect(s1).not.toBe(s3);
    expect(s1.startsWith("conductor:")).toBe(true);
  });
  it("recurrence counts only failed outcomes with the same sig", () => {
    const r1 = recordOutcome({ ...base, error: "tsc failed on router.ts" }, { rulesApplied: [], nextErrorSeq: 1 });
    const sig = errorSignature({ ...base, error: "tsc failed on router.ts" });
    expect(detectRecurrence([r1.ledger], sig)).toBe(1);
    expect(detectRecurrence([r1.ledger, outcome("conductor", true, 5)], sig)).toBe(1);
    expect(detectRecurrence([outcome("conductor", true, 5)], sig)).toBe(0);
  });
  it("recurrence hardens the proposal: severity high, count set, route-away in the rule", () => {
    const r = recordOutcome({ ...base, error: "tsc failed on router.ts" }, { rulesApplied: [], nextErrorSeq: 2, recurrenceCount: 1 });
    expect(r.registryAppend!.severity).toBe("high");
    expect(r.registryAppend!.recurrence_count).toBe(1);
    expect(r.registryAppend!.prevention_rule).toContain("RECURRENCE ×2");
    expect(r.registryAppend!.prevention_rule).toContain("do NOT re-dispatch to conductor");
  });
});

describe("assignRole v2 (Contract-Net-lite)", () => {
  const task: TaskSpec = { id: "t", goal: "fix code", cls: "code" };
  it("default path unchanged (regression): no opts → cheapest capable, chart order", () => {
    expect(assignRole(chart(), task)).toMatchObject({ actorId: "conductor", reason: "capability-match" });
  });
  it("evidence-weighted: within the cheapest band, higher wilson wins", () => {
    const stats = new Map([
      ["conductor", { n: 5, ok: 1, wilson: wilsonLower(1, 5) }],
      ["coder-b", { n: 5, ok: 5, wilson: wilsonLower(5, 5) }],
    ]);
    const a = assignRole(chart(), task, { stats });
    expect(a.actorId).toBe("coder-b");
    expect(a.reason).toBe("evidence-weighted");
  });
  it("thin evidence (n<3) bids neutral — order unchanged", () => {
    const stats = new Map([["coder-b", { n: 2, ok: 2, wilson: wilsonLower(2, 2) }]]);
    expect(assignRole(chart(), task, { stats }).actorId).toBe("conductor");
  });
  it("evidence never routes to a more expensive band", () => {
    const stats = new Map([["joker", { n: 10, ok: 10, wilson: wilsonLower(10, 10) }]]); // joker costRank 1
    expect(assignRole(chart(), task, { stats }).costRank).toBe(0);
  });
  it("recurrence-avoid: failed actor excluded, next capable picked", () => {
    const a = assignRole(chart(), task, { avoid: ["conductor"] });
    expect(a.actorId).toBe("coder-b");
    expect(a.reason).toBe("recurrence-avoid");
  });
  it("all capable avoided → escalation ladder of the cheapest avoided actor", () => {
    const a = assignRole(chart(), task, { avoid: ["conductor", "coder-b", "joker"] });
    expect(a.actorId).toBe("joker"); // conductor.escalatesTo = joker (ladder wins over avoid — supervised restart elsewhere)
    expect(a.reason).toBe("recurrence-avoid");
  });
});

describe("buildDispatchPrompt v2", () => {
  it("includes RELEVANT MEMORY when lessons passed, omits when absent", () => {
    const c = chart();
    const task: TaskSpec = { id: "t", goal: "g", cls: "code" };
    const a = assignRole(c, task);
    const withMem = buildDispatchPrompt(c, a, task, [], [{ fact: "lesson: probe timeout must be far below test timeout" }]);
    expect(withMem).toContain("## RELEVANT MEMORY");
    expect(withMem).toContain("probe timeout");
    expect(buildDispatchPrompt(c, a, task, [])).not.toContain("RELEVANT MEMORY");
  });
});
