// server/hierarchy-bridge.test.ts — B7: TDD suite for the hierarchy tier-router bridge.
// Pure adapter over orchestration/bin/lib/hierarchy.ts (the dormant Wilson-gate engine).
// No live LLM calls — everything here is fixture-driven and IO-isolated (temp policy files).
import { describe, test, expect, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseModeFromEnv,
  checkPolicyUsable,
  computeRecommendation,
  reorderChainForTier,
  getHierarchyRecommendation,
  getHierarchySnapshot,
  _resetPolicyCacheForTest,
  _resetRecommendationRingForTest,
  type HierarchyMode,
} from "./hierarchy-bridge";
import type { HierarchyPolicy } from "../orchestration/bin/lib/hierarchy";
import { register as metricsRegister } from "./metrics";

function goodPolicy(overrides: Partial<HierarchyPolicy> = {}): HierarchyPolicy {
  return {
    routes: [
      { taskClass: "codegen", gateSource: "scorecard", wilsonLow: 0.92, chosenTier: "local", model: "qwen3:8b", estCostUnits: 0, reason: "cheap-passes" },
      { taskClass: "plan", gateSource: "MODEL_SELECTION", wilsonLow: 0.4, chosenTier: "sonnet", model: "claude-sonnet-4-6", estCostUnits: 5, reason: "mid" },
      { taskClass: "review", gateSource: "scorecard", wilsonLow: 0.6, chosenTier: "opus", model: "claude-opus-4-7", estCostUnits: 20, reason: "high-stakes" },
    ],
    gate: { wilsonFloor: 0.8, staleDays: 7 },
    escalationLadder: ["local", "sonnet", "opus"],
    evidence: { scorecard: "orchestration/scorecard.json", benchmarkJson: "orchestration/benchmark.json" },
    ts: new Date().toISOString(), // always fresh relative to "now" in tests below
    ...overrides,
  };
}

function degeneratePolicy(): HierarchyPolicy {
  // Structurally valid but statistically degenerate: every route resolves to the SAME tier —
  // this is the exact S0 GOTCHA (bench-correctness dataset invalid → policy can't distinguish tiers).
  return goodPolicy({
    routes: [
      { taskClass: "codegen", gateSource: "scorecard", wilsonLow: 0.9, chosenTier: "local", model: "m", estCostUnits: 0, reason: "" },
      { taskClass: "plan", gateSource: "scorecard", wilsonLow: 0.9, chosenTier: "local", model: "m", estCostUnits: 0, reason: "" },
    ],
  });
}

const tmpFiles: string[] = [];
function writePolicyFile(policy: HierarchyPolicy | Record<string, unknown>): string {
  const file = path.join(os.tmpdir(), `ollamas-hierarchy-policy-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(file, JSON.stringify(policy));
  tmpFiles.push(file);
  return file;
}

afterEach(() => {
  delete process.env.HIERARCHY_ROUTING;
  delete process.env.HIERARCHY_POLICY_PATH;
  _resetPolicyCacheForTest();
  _resetRecommendationRingForTest();
  vi.restoreAllMocks();
  for (const f of tmpFiles.splice(0)) { try { fs.unlinkSync(f); } catch {} }
});

describe("parseModeFromEnv", () => {
  test("unset/empty/unknown default to advisory (fail-safe)", () => {
    expect(parseModeFromEnv(undefined)).toBe("advisory");
    expect(parseModeFromEnv("")).toBe("advisory");
    expect(parseModeFromEnv("advisory")).toBe("advisory");
    expect(parseModeFromEnv("bogus")).toBe("advisory");
  });
  test('"0" means fully off', () => {
    expect(parseModeFromEnv("0")).toBe("off");
  });
  test('"enforce" is recognized', () => {
    expect(parseModeFromEnv("enforce")).toBe("enforce");
  });
});

describe("checkPolicyUsable — degeneracy gate", () => {
  test("null policy is not usable", () => {
    const r = checkPolicyUsable(null);
    expect(r.usable).toBe(false);
    expect(r.reason).toMatch(/no-policy/);
  });
  test("empty routes is not usable (empty stats)", () => {
    const r = checkPolicyUsable(goodPolicy({ routes: [] }));
    expect(r.usable).toBe(false);
    expect(r.reason).toMatch(/empty-stats/);
  });
  test("all-tiers-equal policy is degenerate (the historical bad-bench GOTCHA)", () => {
    const r = checkPolicyUsable(degeneratePolicy());
    expect(r.usable).toBe(false);
    expect(r.reason).toMatch(/degenerate/);
  });
  test("policy with distinguishable tiers is usable", () => {
    const r = checkPolicyUsable(goodPolicy());
    expect(r.usable).toBe(true);
  });
});

describe("computeRecommendation — pure decision core", () => {
  const NOW = new Date();

  test("requestedMode off short-circuits regardless of policy", () => {
    const rec = computeRecommendation(null, "codegen", "off", { now: NOW });
    expect(rec.mode).toBe("off");
    expect(rec.requestedMode).toBe("off");
  });

  test("advisory mode with a valid policy reports the recommended tier but stays advisory", () => {
    const rec = computeRecommendation(goodPolicy(), "codegen", "advisory", { now: NOW });
    expect(rec.mode).toBe("advisory");
    expect(rec.tier).toBe("local"); // codegen route, wilsonLow 0.92 >= floor 0.8 → gate-pass
    expect(rec.policyUsable).toBe(true);
  });

  test("advisory mode with no policy falls back to ladder default, still advisory", () => {
    const rec = computeRecommendation(null, "codegen", "advisory", { now: NOW });
    expect(rec.mode).toBe("advisory");
    expect(rec.policyUsable).toBe(false);
    expect(rec.tier).toBe("local");
  });

  test("enforce mode with a usable, fresh policy stays enforce and resolves via the Wilson gate", () => {
    const rec = computeRecommendation(goodPolicy(), "plan", "enforce", { now: NOW });
    expect(rec.mode).toBe("enforce");
    // plan route: wilsonLow 0.4 < gate.wilsonFloor 0.8 → escalate past chosenTier "sonnet" to "opus".
    expect(rec.tier).toBe("opus");
    expect(rec.reason).toBe("escalate-below-floor");
  });

  test("enforce mode with NULL policy is forced back to advisory — enforce must be impossible with no data", () => {
    const rec = computeRecommendation(null, "codegen", "enforce", { now: NOW });
    expect(rec.mode).toBe("advisory");
    expect(rec.policyUsable).toBe(false);
    expect(rec.policyReason).toMatch(/no-policy/);
  });

  test("enforce mode with a DEGENERATE policy is forced back to advisory", () => {
    const rec = computeRecommendation(degeneratePolicy(), "codegen", "enforce", { now: NOW });
    expect(rec.mode).toBe("advisory");
    expect(rec.policyUsable).toBe(false);
    expect(rec.policyReason).toMatch(/degenerate/);
  });

  test("unknown task class defaults sanely even in enforce mode", () => {
    const rec = computeRecommendation(goodPolicy(), "no-such-class", "enforce", { now: NOW });
    expect(rec.mode).toBe("enforce");
    expect(rec.tier).toBe("local"); // ladder[0] via resolveTierForClass's unknown-class-default
    expect(rec.reason).toBe("unknown-class-default");
  });
});

describe("reorderChainForTier — safe reordering (never drops a provider)", () => {
  const chain = ["fleet", "ollama-local", "gemini", "openai", "demo"];

  test("tier local leaves the chain untouched (local already first)", () => {
    expect(reorderChainForTier(chain, "local")).toEqual(chain);
  });

  test("tier sonnet/opus moves local-tier providers after cloud, before demo — same set, no drops", () => {
    const reordered = reorderChainForTier(chain, "sonnet");
    expect(reordered).toEqual(["gemini", "openai", "fleet", "ollama-local", "demo"]);
    expect([...reordered].sort()).toEqual([...chain].sort()); // set-equality invariant
  });

  test("no demo in chain still reorders safely", () => {
    const noDemo = ["fleet", "ollama-local", "gemini", "openai"];
    const reordered = reorderChainForTier(noDemo, "opus");
    expect(reordered).toEqual(["gemini", "openai", "fleet", "ollama-local"]);
  });

  test("all-local chain (no cloud tier present) is left unchanged — nothing safe to reorder around", () => {
    const allLocal = ["fleet", "ollama-local"];
    expect(reorderChainForTier(allLocal, "opus")).toEqual(allLocal);
  });
});

describe("getHierarchyRecommendation — mode routing via env + disk policy", () => {
  test('HIERARCHY_ROUTING="0" is fully off — no disk read, no ring entry', () => {
    process.env.HIERARCHY_ROUTING = "0";
    process.env.HIERARCHY_POLICY_PATH = "/definitely/does/not/exist.json";
    const rec = getHierarchyRecommendation("codegen");
    expect(rec.mode).toBe("off");
    expect(getHierarchySnapshot().recentRecommendations).toHaveLength(0);
  });

  test("unset env defaults to advisory with a missing policy file (safe boot state)", () => {
    process.env.HIERARCHY_POLICY_PATH = path.join(os.tmpdir(), "no-such-hierarchy-policy.json");
    const rec = getHierarchyRecommendation("codegen");
    expect(rec.mode).toBe("advisory");
    expect(rec.policyUsable).toBe(false);
  });

  test("enforce + usable policy file on disk → real enforce recommendation, recorded in the ring", () => {
    process.env.HIERARCHY_ROUTING = "enforce";
    process.env.HIERARCHY_POLICY_PATH = writePolicyFile(goodPolicy());
    const rec = getHierarchyRecommendation("codegen");
    expect(rec.mode).toBe("enforce");
    expect(rec.tier).toBe("local");
    const snap = getHierarchySnapshot();
    expect(snap.mode).toBe("enforce");
    expect(snap.policyValid).toBe(true);
    expect(snap.recentRecommendations.length).toBe(1);
    expect(snap.recentRecommendations[0].taskClass).toBe("codegen");
  });

  test("enforce + degenerate policy file on disk → warn-logged forced advisory, enforce unreachable", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    process.env.HIERARCHY_ROUTING = "enforce";
    process.env.HIERARCHY_POLICY_PATH = writePolicyFile(degeneratePolicy());
    const rec = getHierarchyRecommendation("codegen");
    expect(rec.mode).toBe("advisory");
    expect(warnSpy).toHaveBeenCalled();
    expect(String(warnSpy.mock.calls[0][0])).toMatch(/degenerate|advisory/i);
  });

  test("malformed policy JSON on disk degrades to null policy → advisory, never throws", () => {
    const file = path.join(os.tmpdir(), `ollamas-hierarchy-bad-${Date.now()}.json`);
    fs.writeFileSync(file, "{not valid json");
    tmpFiles.push(file);
    process.env.HIERARCHY_ROUTING = "enforce";
    process.env.HIERARCHY_POLICY_PATH = file;
    expect(() => getHierarchyRecommendation("codegen")).not.toThrow();
    expect(getHierarchyRecommendation("codegen").mode).toBe("advisory");
  });
});

describe("metrics (C2) — hierarchy recommendations exported via server/metrics.ts", () => {
  test("getHierarchyRecommendation increments ollamas_hierarchy_recommendations_total{tier,mode}", async () => {
    process.env.HIERARCHY_ROUTING = "enforce";
    process.env.HIERARCHY_POLICY_PATH = writePolicyFile(goodPolicy());
    const before = (await metricsRegister.getSingleMetric("ollamas_hierarchy_recommendations_total")!.get()).values
      .find((v) => v.labels.tier === "local" && v.labels.mode === "enforce")?.value ?? 0;
    getHierarchyRecommendation("codegen"); // resolves to tier="local", mode="enforce" per goodPolicy()
    const after = (await metricsRegister.getSingleMetric("ollamas_hierarchy_recommendations_total")!.get()).values
      .find((v) => v.labels.tier === "local" && v.labels.mode === "enforce")?.value ?? 0;
    expect(after).toBe(before + 1);
  });

  test('mode "0" (fully off) records no metric sample — matches "no ring-buffer entry" behavior', async () => {
    const before = (await metricsRegister.getSingleMetric("ollamas_hierarchy_recommendations_total")!.get()).values
      .find((v) => v.labels.tier === "local" && v.labels.mode === "off")?.value ?? 0;
    process.env.HIERARCHY_ROUTING = "0";
    getHierarchyRecommendation("codegen");
    const after = (await metricsRegister.getSingleMetric("ollamas_hierarchy_recommendations_total")!.get()).values
      .find((v) => v.labels.tier === "local" && v.labels.mode === "off")?.value ?? 0;
    expect(after).toBe(before); // "off" short-circuits before the metric increment, same as the ring buffer
  });
});

describe("getHierarchySnapshot — shape", () => {
  test("has the documented fields even before any recommendation was computed", () => {
    const snap = getHierarchySnapshot();
    expect(snap).toHaveProperty("mode");
    expect(snap).toHaveProperty("policyValid");
    expect(snap).toHaveProperty("policyReason");
    expect(snap).toHaveProperty("recentRecommendations");
    expect(snap).toHaveProperty("updatedAt");
    expect(Array.isArray(snap.recentRecommendations)).toBe(true);
  });
});
