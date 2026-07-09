import { describe, it, expect } from "vitest";
import { parsePolicy, resolveTierForClass, isStale, type HierarchyPolicy } from "../bin/lib/hierarchy";

// A structurally-valid policy JSON, built fresh per test so mutations don't leak.
function goodJson(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    routes: [
      { taskClass: "codegen", gateSource: "scorecard", wilsonLow: 0.9, chosenTier: "local", model: "qwen3:8b", estCostUnits: 0, reason: "cheap-passes" },
      { taskClass: "plan", gateSource: "MODEL_SELECTION", wilsonLow: 0.4, chosenTier: "sonnet", model: "claude-sonnet-4-6", estCostUnits: 5, reason: "mid" },
    ],
    gate: { wilsonFloor: 0.8, staleDays: 7 },
    escalationLadder: ["local", "sonnet", "opus"],
    evidence: { scorecard: "orchestration/scorecard.json", benchmarkJson: "orchestration/benchmark.json" },
    ts: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

const NOW = new Date("2026-07-09T00:00:00.000Z"); // 1 day after ts → fresh

describe("parsePolicy — happy path", () => {
  it("accepts a valid policy and returns typed routes", () => {
    const p = parsePolicy(goodJson());
    expect(p.routes).toHaveLength(2);
    expect(p.routes[0].taskClass).toBe("codegen");
    expect(p.gate.wilsonFloor).toBe(0.8);
    expect(p.escalationLadder).toEqual(["local", "sonnet", "opus"]);
    expect(p.evidence.scorecard).toBe("orchestration/scorecard.json");
  });
});

describe("parsePolicy — degenerate-data rejection (7 conditions)", () => {
  it("throws when routes is empty / not an array", () => {
    expect(() => parsePolicy(goodJson({ routes: [] }))).toThrow(/routes must be a non-empty array/);
    expect(() => parsePolicy(goodJson({ routes: "nope" }))).toThrow(/routes must be a non-empty array/);
  });

  it("throws on duplicate taskClass", () => {
    const dup = goodJson({
      routes: [
        { taskClass: "codegen", gateSource: "scorecard", wilsonLow: 0.9, chosenTier: "local", model: "m", estCostUnits: 0, reason: "" },
        { taskClass: "codegen", gateSource: "scorecard", wilsonLow: 0.5, chosenTier: "sonnet", model: "m", estCostUnits: 1, reason: "" },
      ],
    });
    expect(() => parsePolicy(dup)).toThrow(/duplicate taskClass "codegen"/);
  });

  it("throws when chosenTier is not in escalationLadder", () => {
    const bad = goodJson({ escalationLadder: ["local", "sonnet"] }); // "plan" route chooses... still in. force opus route
    (bad.routes as Array<Record<string, unknown>>)[1].chosenTier = "opus";
    expect(() => parsePolicy(bad)).toThrow(/not in escalationLadder/);
  });

  it("throws when wilsonLow is out of [0,1] or NaN", () => {
    const oob = goodJson();
    (oob.routes as Array<Record<string, unknown>>)[0].wilsonLow = 1.5;
    expect(() => parsePolicy(oob)).toThrow(/wilsonLow must be in \[0,1\]/);

    const nan = goodJson();
    (nan.routes as Array<Record<string, unknown>>)[0].wilsonLow = NaN;
    expect(() => parsePolicy(nan)).toThrow(/wilsonLow must be in \[0,1\]/);
  });

  it("throws when gate.wilsonFloor is NaN", () => {
    expect(() => parsePolicy(goodJson({ gate: { wilsonFloor: NaN, staleDays: 7 } }))).toThrow(
      /gate.wilsonFloor must be a finite number/,
    );
  });

  it("throws when evidence.scorecard is missing / empty (no measurement = degenerate)", () => {
    expect(() => parsePolicy(goodJson({ evidence: { scorecard: "", benchmarkJson: "b.json" } }))).toThrow(
      /evidence.scorecard is required and non-empty/,
    );
    expect(() => parsePolicy(goodJson({ evidence: { benchmarkJson: "b.json" } }))).toThrow(
      /evidence.scorecard is required and non-empty/,
    );
  });

  it("throws when ts is unparseable (Date.parse NaN)", () => {
    expect(() => parsePolicy(goodJson({ ts: "not-a-date" }))).toThrow(/ts must be a parseable date string/);
  });
});

describe("resolveTierForClass — deterministic routing", () => {
  const policy: HierarchyPolicy = parsePolicy(goodJson());

  it("gate-pass: wilsonLow >= floor → chosenTier", () => {
    const r = resolveTierForClass(policy, "codegen", { now: NOW });
    expect(r).toEqual({ tier: "local", reason: "gate-pass" });
  });

  it("escalate: wilsonLow < floor → next tier in ladder", () => {
    // codegen chosenTier=local; below floor → escalate to "sonnet"
    const r = resolveTierForClass(policy, "codegen", { wilsonLow: 0.5, now: NOW });
    expect(r).toEqual({ tier: "sonnet", reason: "escalate-below-floor" });
  });

  it("escalate from last tier stays at last tier", () => {
    const opusPolicy = parsePolicy(
      goodJson({
        routes: [{ taskClass: "hard", gateSource: "scorecard", wilsonLow: 0.9, chosenTier: "opus", model: "m", estCostUnits: 9, reason: "" }],
      }),
    );
    const r = resolveTierForClass(opusPolicy, "hard", { wilsonLow: 0.1, now: NOW });
    expect(r).toEqual({ tier: "opus", reason: "escalate-below-floor" });
  });

  it("unknown-class-default: no route → ladder[0] (local)", () => {
    const r = resolveTierForClass(policy, "no-such-class", { now: NOW });
    expect(r).toEqual({ tier: "local", reason: "unknown-class-default" });
  });

  it("stale-fallback: now - ts > staleDays → sonnet (now injected)", () => {
    const staleNow = new Date("2026-08-01T00:00:00.000Z"); // >7 days past ts
    const r = resolveTierForClass(policy, "codegen", { now: staleNow });
    expect(r).toEqual({ tier: "sonnet", reason: "stale-fallback" });
  });
});

describe("isStale — boundary", () => {
  it("fresh within window, stale beyond", () => {
    expect(isStale("2026-07-08T00:00:00.000Z", 7, new Date("2026-07-14T00:00:00.000Z"))).toBe(false);
    expect(isStale("2026-07-08T00:00:00.000Z", 7, new Date("2026-07-16T00:00:00.000Z"))).toBe(true);
  });
});
