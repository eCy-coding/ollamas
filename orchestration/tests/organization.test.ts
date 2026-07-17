import { describe, it, expect } from "vitest";
import {
  parseOrgChart, mergeRosterSeats, assignRole, consultErrors, faultsAsRules,
  buildDispatchPrompt, recordOutcome, tokenize,
  type OrgChart, type PreventionRule, type TaskSpec,
} from "../bin/lib/organization";

const CHART_JSON = {
  version: 1,
  ts: "2026-07-18T00:00:00Z",
  actors: [
    { id: "emre", kind: "operator", role: "T0", duties: [], capabilities: ["decision"], reportsTo: null, escalatesTo: null, costRank: 3 },
    { id: "conductor", kind: "model", role: "Conductor", duties: ["conduct the loop"], capabilities: ["conduct", "code"], reportsTo: "emre", escalatesTo: "joker", model: "qwen3-coder:30b", costRank: 0 },
    { id: "joker", kind: "model", role: "Joker", duties: [], capabilities: ["conduct-standby", "review"], reportsTo: "conductor", escalatesTo: "emre", model: "qwen3:8b", costRank: 0 },
    { id: "odysseus", kind: "service", role: "External Specialist", duties: [], capabilities: ["research"], reportsTo: "emre", escalatesTo: "conductor", endpoint: "http://127.0.0.1:7860", costRank: 2, knownFaults: [{ id: "ORG-FAULT-ODY-001", note: "Bridge returns ok:true even when the response text embeds an error — scan payload before recording success." }] },
    { id: "cloud-code", kind: "pool", role: "Cloud code", duties: [], capabilities: ["code"], reportsTo: "emre", escalatesTo: "emre", costRank: 1 },
  ],
};

function chart(): OrgChart { return parseOrgChart(JSON.parse(JSON.stringify(CHART_JSON))); }

describe("parseOrgChart", () => {
  it("parses a valid chart", () => {
    const c = chart();
    expect(c.actors).toHaveLength(5);
    expect(c.actors[1].knownFaults).toEqual([]);
  });
  it("rejects non-object / empty actors / bad version", () => {
    expect(() => parseOrgChart(null)).toThrow("must be an object");
    expect(() => parseOrgChart({ version: 1, ts: "2026-07-18", actors: [] })).toThrow("non-empty array");
    expect(() => parseOrgChart({ version: NaN, ts: "2026-07-18", actors: [{}] })).toThrow("finite number");
  });
  it("rejects duplicate ids, invalid kind, capability-less actors", () => {
    const dup = JSON.parse(JSON.stringify(CHART_JSON));
    dup.actors.push({ ...dup.actors[1] });
    expect(() => parseOrgChart(dup)).toThrow('duplicate actor id');
    const badKind = JSON.parse(JSON.stringify(CHART_JSON));
    badKind.actors[0].kind = "wizard";
    expect(() => parseOrgChart(badKind)).toThrow("kind must be one of");
    const noCap = JSON.parse(JSON.stringify(CHART_JSON));
    noCap.actors[0].capabilities = [];
    expect(() => parseOrgChart(noCap)).toThrow("at least one capability");
  });
  it("rejects a dangling reporting line (broken chain of command)", () => {
    const bad = JSON.parse(JSON.stringify(CHART_JSON));
    bad.actors[1].escalatesTo = "ghost";
    expect(() => parseOrgChart(bad)).toThrow('unknown actor "ghost"');
  });
});

describe("mergeRosterSeats", () => {
  it("merges available seats as model actors, skips duplicates of structural models", () => {
    const merged = mergeRosterSeats(chart(), [
      { capability: "vision", role: "analyst", model: "qwen2.5vl:32b", available: true, responsibility: "UI analysis" },
      { capability: "fast-verify", role: "reviewer", model: "qwen3:8b", available: true },
      { capability: "adversarial", role: "adversary", model: "gpt-oss:120b-cloud", available: false },
    ]);
    const ids = merged.actors.map((a) => a.id);
    expect(ids).toContain("seat:vision");
    expect(ids).not.toContain("seat:fast-verify"); // qwen3:8b already structural (joker)
    expect(ids).not.toContain("seat:adversarial"); // unavailable
    const seat = merged.actors.find((a) => a.id === "seat:vision")!;
    expect(seat.reportsTo).toBe("conductor");
    expect(seat.costRank).toBe(0);
  });
  it("cloud seat models get costRank 1", () => {
    const merged = mergeRosterSeats(chart(), [
      { capability: "deep-code", role: "architect", model: "qwen3-coder:480b-cloud", available: true },
    ]);
    expect(merged.actors.find((a) => a.id === "seat:deep-code")!.costRank).toBe(1);
  });
});

describe("assignRole (cheapest capable)", () => {
  it("prefers the cheapest actor with the capability", () => {
    const a = assignRole(chart(), { id: "t1", goal: "fix bug", cls: "code" });
    expect(a.actorId).toBe("conductor"); // costRank 0 beats cloud-code rank 1
    expect(a.reason).toBe("capability-match");
  });
  it("routes research to the external specialist and carries knownFaults", () => {
    const a = assignRole(chart(), { id: "t2", goal: "research X", cls: "research" });
    expect(a.actorId).toBe("odysseus");
    expect(a.knownFaults[0].id).toBe("ORG-FAULT-ODY-001");
  });
  it("never auto-assigns the operator; unknown class escalates to the conductor", () => {
    const a = assignRole(chart(), { id: "t3", goal: "decide something", cls: "decision" });
    expect(a.actorId).toBe("conductor");
    expect(a.reason).toBe("escalate-no-capable");
  });
});

describe("consultErrors", () => {
  const rules: PreventionRule[] = [
    { id: "ERR-ORCH-006", source: "orchestration", text: "fleet-apply commitShipped git add -A staged foreign lane dirty files", rule: "Targeted git add only — git add -A is forbidden in the shared tree." },
    { id: "PROB-transient-error", source: "PROBLEM_REGISTRY", text: "transient timeout ETIMEDOUT 429 rate limit", rule: "Exponential backoff with full jitter; fail fast on non-transient." },
  ];
  it("matches by token overlap and returns the rule verbatim", () => {
    const task: TaskSpec = { id: "t", goal: "commit files with git add in the shared lane tree", cls: "code" };
    const hits = consultErrors(rules, task);
    expect(hits.map((h) => h.id)).toContain("ERR-ORCH-006");
    expect(hits[0].rule).toMatch(/git add -A is forbidden/);
  });
  it("misses when overlap is below the floor", () => {
    expect(consultErrors(rules, { id: "t", goal: "draw a diagram", cls: "vision" })).toEqual([]);
  });
  it("includes assignee knownFaults via faultsAsRules", () => {
    const a = assignRole(chart(), { id: "t", goal: "research topic", cls: "research" });
    const all = [...rules, ...faultsAsRules(a)];
    const hits = consultErrors(all, { id: "t", goal: "record success from bridge response payload", cls: "research" });
    expect(hits.map((h) => h.id)).toContain("ORG-FAULT-ODY-001");
  });
});

describe("buildDispatchPrompt", () => {
  it("contains role, task and the prevention rules verbatim", () => {
    const c = chart();
    const task: TaskSpec = { id: "t9", goal: "refactor the router", cls: "code" };
    const a = assignRole(c, task);
    const rules: PreventionRule[] = [{ id: "R1", source: "s", text: "x", rule: "Never do the bad thing." }];
    const p = buildDispatchPrompt(c, a, task, rules);
    expect(p).toContain("# ROLE: Conductor");
    expect(p).toContain("## TASK t9");
    expect(p).toContain("[R1] Never do the bad thing.");
    expect(p).toContain("PROPOSE, don't mutate");
  });
  it("states explicitly when no rules matched", () => {
    const c = chart();
    const task: TaskSpec = { id: "t9", goal: "g", cls: "code" };
    const p = buildDispatchPrompt(c, assignRole(c, task), task, []);
    expect(p).toContain("no matching registered errors");
  });
});

describe("recordOutcome", () => {
  const base = { taskId: "t1", actorId: "conductor", ts: "2026-07-18T01:00:00Z" };
  it("success → episodic ledger entry, no registry append", () => {
    const r = recordOutcome({ ...base, ok: true, summary: "applied clean" }, { rulesApplied: ["R1"], nextErrorSeq: 7 });
    expect(r.ledger.tier).toBe("episodic");
    expect(r.ledger.rulesApplied).toEqual(["R1"]);
    expect(r.registryAppend).toBeUndefined();
  });
  it("failure → learned tier + ERR-ORG-NNN proposal with a prevention rule", () => {
    const r = recordOutcome({ ...base, ok: false, summary: "gate red", error: "tsc failed on router.ts" }, { rulesApplied: [], nextErrorSeq: 7 });
    expect(r.ledger.tier).toBe("learned");
    expect(r.registryAppend!.id).toBe("ERR-ORG-007");
    expect(r.registryAppend!.root_cause).toBe("tsc failed on router.ts");
    expect(r.registryAppend!.prevention_rule).toContain("tsc failed on router.ts");
    expect(r.registryAppend!.recurrence_count).toBe(0);
  });
});

describe("tokenize", () => {
  it("lowercases, drops stopwords and short tokens, keeps paths", () => {
    const t = tokenize("The git add -A of orchestration/bin/lib IS bad");
    expect(t).toContain("git");
    expect(t).toContain("orchestration/bin/lib");
    expect(t).not.toContain("the");
    expect(t).not.toContain("is");
  });
});
