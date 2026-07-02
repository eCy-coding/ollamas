import { describe, it, expect } from "vitest";
import { orderSlotsByMission, maxTwoOkOrdered, type SlotLike } from "../bin/lib/fleet-order";
import { buildMission, DEFAULT_DEPS, type AssignmentLike } from "../bin/lib/mission";

// A mission over the canonical DAG: shell-harden → mjs-migration → typescript-core → {errors,concurrency} → test-coverage.
// All 6 canonical streams so DEFAULT_DEPS (which references errors/concurrency) resolves in topoSort.
const ASSIGN: AssignmentLike[] = [
  { stream: "shell-harden", concern: "env", model: "qwen3:8b" },
  { stream: "mjs-migration", concern: "ts", model: "gpt-oss:20b-cloud" },
  { stream: "typescript-core", concern: "types", model: "qwen3-coder:480b-cloud" },
  { stream: "errors-resilience", concern: "sse", model: "gpt-oss:120b-cloud" },
  { stream: "concurrency-safety", concern: "race", model: "gpt-oss:120b-cloud" },
  { stream: "test-coverage", concern: "vitest", model: "qwen3:8b" },
];
const MISSION = buildMission(ASSIGN, new Map(Object.entries(DEFAULT_DEPS)));

interface Slot extends SlotLike { model: string | null }
// Deliberately shuffled input order (test-coverage first, shell-harden last) to prove re-ordering.
const SLOTS: Slot[] = [
  { stream: "test-coverage", app: "Terminal.app", slot: "A", model: "qwen3:8b" },
  { stream: "typescript-core", app: "iTerm2", slot: "B", model: "qwen3-coder:480b-cloud" },
  { stream: "shell-harden", app: "Terminal.app", slot: "C", model: "qwen3:8b" },
  { stream: "shell-harden", app: "iTerm2", slot: "D", model: "gpt-oss:20b-cloud" },
];

describe("orderSlotsByMission — T1→Tn ethical launch order", () => {
  const ordered = orderSlotsByMission(SLOTS, MISSION);

  it("sorts slots by their stream's mission dependency order", () => {
    const streams = ordered.map((o) => o.slot.stream);
    expect(streams.indexOf("shell-harden")).toBeLessThan(streams.indexOf("typescript-core"));
    expect(streams.indexOf("typescript-core")).toBeLessThan(streams.indexOf("test-coverage"));
  });

  it("keeps both slots of the same stream together, preserving input app/slot order (stable)", () => {
    const sh = ordered.filter((o) => o.slot.stream === "shell-harden").map((o) => o.slot.slot);
    expect(sh).toEqual(["C", "D"]); // C before D as in the input
  });

  it("annotates each slot with the mission order, ethical tier and dependsOn", () => {
    const ts = ordered.find((o) => o.slot.stream === "typescript-core")!;
    expect(ts.missionOrder).toBeGreaterThan(0);
    expect(["safe", "host"]).toContain(ts.tier); // never "privileged"
    expect(ts.dependsOn).toContain("mjs-migration");
  });

  it("places a stream absent from the mission LAST, without dropping it", () => {
    const withExtra = orderSlotsByMission(
      [...SLOTS, { stream: "ghost-stream", app: "Terminal.app", slot: "Z", model: "m" }],
      MISSION,
    );
    expect(withExtra).toHaveLength(SLOTS.length + 1);
    expect(withExtra[withExtra.length - 1].slot.stream).toBe("ghost-stream");
  });
});

describe("maxTwoOkOrdered — ≤2 tasks/model preserved through ordering", () => {
  it("true when no model spans >2 streams", () => {
    const ordered = orderSlotsByMission(SLOTS, MISSION);
    expect(maxTwoOkOrdered(ordered, (s) => s.model)).toBe(true); // qwen3:8b in shell-harden + test-coverage = 2
  });
  it("false when a model spans 3 streams", () => {
    const over: Slot[] = [
      { stream: "a", app: "Terminal.app", slot: "1", model: "m" },
      { stream: "b", app: "Terminal.app", slot: "2", model: "m" },
      { stream: "c", app: "Terminal.app", slot: "3", model: "m" },
    ];
    const ordered = orderSlotsByMission(over, MISSION);
    expect(maxTwoOkOrdered(ordered, (s) => s.model)).toBe(false);
  });
});
