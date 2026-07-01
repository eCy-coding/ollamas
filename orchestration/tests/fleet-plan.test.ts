import { describe, it, expect } from "vitest";
import {
  buildFleetPlan, assertMaxTwo, runtimeOf, STREAMS,
} from "../bin/lib/fleet-plan";

const LIVE = [
  "qwen3-coder-64k:latest", "qwen3:8b-16k", "ollamas-reviewer:latest", "qwen2.5vl:32b",
  "qwen2.5vl:7b", "qwen3:8b", "qwen3:30b-a3b", "deepseek-r1:32b", "qwen3-coder:30b",
  "qwen3:4b", "gpt-oss:20b", "kimi-k2.5:cloud", "nomic-embed-text:latest",
  "gpt-oss:20b-cloud", "gpt-oss:120b-cloud", "qwen3-coder:480b-cloud", "llama3.3:70b",
];

describe("runtimeOf — cloud vs local (single-GPU tag)", () => {
  it("cloud suffix → cloud", () => {
    expect(runtimeOf("qwen3-coder:480b-cloud")).toBe("cloud");
    expect(runtimeOf("gpt-oss:120b-cloud")).toBe("cloud");
    expect(runtimeOf("kimi-k2.5:cloud")).toBe("cloud");
  });
  it("local model → local", () => {
    expect(runtimeOf("qwen3-coder:30b")).toBe("local");
    expect(runtimeOf("qwen3:8b")).toBe("local");
  });
  it("null → unknown", () => expect(runtimeOf(null)).toBe("unknown"));
});

describe("buildFleetPlan — live fleet", () => {
  const plan = buildFleetPlan(LIVE);
  it("2 slots per stream (Terminal.app + iTerm2)", () => {
    expect(plan.assignments.length).toBe(STREAMS.length * 2);
    for (const s of STREAMS) {
      const slots = plan.assignments.filter((a) => a.stream === s.id);
      expect(slots.map((a) => a.slot).sort()).toEqual(["iterm2", "terminal"]);
    }
  });
  it("HARD CONSTRAINT: every model in ≤2 streams", () => {
    expect(plan.maxTwoOk).toBe(true);
    expect(() => assertMaxTwo(plan)).not.toThrow();
  });
  it("each stream's two slots use DISTINCT models (ensemble)", () => {
    for (const s of STREAMS) {
      const models = plan.assignments.filter((a) => a.stream === s.id).map((a) => a.model);
      if (models[0] && models[1]) expect(models[0]).not.toBe(models[1]);
    }
  });
  it("no stream left fully unassigned on the live fleet", () => {
    expect(plan.unassigned.length).toBe(0);
  });
  it("at least one cloud slot per stream (single-GPU: ≤1 local needed at a time)", () => {
    for (const s of STREAMS) {
      const rts = plan.assignments.filter((a) => a.stream === s.id).map((a) => a.runtime);
      expect(rts).toContain("cloud");
    }
  });
  it("capability match: typescript-core uses a qwen3-coder model", () => {
    const core = plan.assignments.filter((a) => a.stream === "typescript-core").map((a) => a.model);
    expect(core.some((m) => m?.startsWith("qwen3-coder"))).toBe(true);
  });
});

describe("buildFleetPlan — degraded fleet surfaces gaps", () => {
  it("empty fleet → all slots unassigned, maxTwo trivially ok", () => {
    const plan = buildFleetPlan([]);
    expect(plan.unassigned.length).toBe(STREAMS.length * 2);
    expect(plan.assignments.every((a) => a.model === null)).toBe(true);
    expect(plan.maxTwoOk).toBe(true);
  });
  it("scarce fleet respects ≤2 cap even when it means null slots", () => {
    const plan = buildFleetPlan(["qwen3-coder:480b-cloud"]); // 1 model, cap 2 → fills ≤2 slots only
    expect(plan.perModel.find((p) => p.model === "qwen3-coder:480b-cloud")!.streams.length).toBeLessThanOrEqual(2);
    expect(plan.maxTwoOk).toBe(true);
    expect(plan.unassigned.length).toBeGreaterThan(0);
  });
});
