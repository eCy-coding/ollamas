import { describe, it, expect } from "vitest";
import { topoSort, ethicalTier, buildMission, renderMission, type AssignmentLike } from "../bin/lib/mission";

describe("topoSort — dependency ordering (Kahn)", () => {
  const deps = new Map<string, string[]>([
    ["a", []], ["b", ["a"]], ["c", ["b"]], ["d", ["a"]],
  ]);
  it("orders dependencies before dependents", () => {
    const order = topoSort(["a", "b", "c", "d"], deps);
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("b"));
    expect(order.indexOf("b")).toBeLessThan(order.indexOf("c"));
    expect(order.indexOf("a")).toBeLessThan(order.indexOf("d"));
    expect(order).toHaveLength(4);
  });
  it("throws on a cycle (no guessing an order)", () => {
    const cyclic = new Map<string, string[]>([["x", ["y"]], ["y", ["x"]]]);
    expect(() => topoSort(["x", "y"], cyclic)).toThrow(/cycle/);
  });
  it("throws on an unknown dependency", () => {
    const bad = new Map<string, string[]>([["a", ["ghost"]]]);
    expect(() => topoSort(["a"], bad)).toThrow(/unknown dependency/);
  });
  it("is deterministic (stable input order for independent nodes)", () => {
    const indep = new Map<string, string[]>([["p", []], ["q", []], ["r", []]]);
    expect(topoSort(["p", "q", "r"], indep)).toEqual(["p", "q", "r"]);
  });
});

describe("ethicalTier — never privileged (etik sınır)", () => {
  it("test-coverage is safe (read + new file only)", () => {
    expect(ethicalTier("test-coverage")).toBe("safe");
  });
  it("editing/migration/hardening streams are host (propose + gate), never privileged", () => {
    for (const s of ["shell-harden", "mjs-migration", "typescript-core", "errors-resilience", "concurrency-safety"]) {
      expect(ethicalTier(s)).toBe("host");
    }
  });
});

const ASSIGN: AssignmentLike[] = [
  { stream: "shell-harden", concern: "env-guard", model: "qwen3:8b" },
  { stream: "shell-harden", concern: "env-guard", model: "gpt-oss:20b-cloud" },
  { stream: "typescript-core", concern: "types", model: "qwen3-coder:480b-cloud" },
  { stream: "typescript-core", concern: "types", model: "qwen3-coder:30b" },
  { stream: "test-coverage", concern: "vitest", model: "qwen3:8b" },
];
const DEPS = new Map<string, string[]>([
  ["shell-harden", []],
  ["typescript-core", ["shell-harden"]],
  ["test-coverage", ["typescript-core"]],
]);

describe("buildMission — sequenced ethical mission", () => {
  it("produces one ordered step per stream, dependency-respecting", () => {
    const m = buildMission(ASSIGN, DEPS);
    expect(m.steps.map((s) => s.stream)).toEqual(["shell-harden", "typescript-core", "test-coverage"]);
    expect(m.steps[0].order).toBe(1);
    expect(m.steps[1].dependsOn).toContain("shell-harden");
    expect(m.ok).toBe(true);
  });

  it("assigns ethical tiers (never privileged) + a gate per step", () => {
    const m = buildMission(ASSIGN, DEPS);
    expect(m.steps.find((s) => s.stream === "test-coverage")!.tier).toBe("safe");
    expect(m.steps.find((s) => s.stream === "typescript-core")!.tier).toBe("host");
    for (const s of m.steps) {
      expect(["safe", "host"]).toContain(s.tier); // never "privileged"
      expect(s.gate.length).toBeGreaterThan(0);
    }
  });

  it("collects ensemble models per stream and preserves ≤2/model", () => {
    const m = buildMission(ASSIGN, DEPS);
    expect(m.steps.find((s) => s.stream === "typescript-core")!.models).toEqual(["qwen3-coder:480b-cloud", "qwen3-coder:30b"]);
    expect(m.maxTwoOk).toBe(true);
  });

  it("flags ≤2/model violation when a model spans 3 streams", () => {
    const over: AssignmentLike[] = [
      { stream: "a", concern: "x", model: "m" },
      { stream: "b", concern: "x", model: "m" },
      { stream: "c", concern: "x", model: "m" },
    ];
    const deps = new Map<string, string[]>([["a", []], ["b", ["a"]], ["c", ["b"]]]);
    expect(buildMission(over, deps).maxTwoOk).toBe(false);
  });

  it("renderMission shows the ordered table + ethical-bounds section", () => {
    const md = renderMission(buildMission(ASSIGN, DEPS), "2026-07-02T00:00:00Z");
    expect(md).toContain("# MISSION.md");
    expect(md).toContain("| T1 | shell-harden");
    expect(md).toContain("Ethical bounds");
    expect(md).toContain("privileged");
    expect(md).not.toContain("| T1 | typescript-core"); // dependency order enforced
  });
});
