import { describe, it, expect } from "vitest";
import { statusOf, nextPending, mark, summary, laneSummary, type Progress } from "../bin/lib/task-progress";
import type { Task } from "../bin/lib/task-catalog";

const cat: Task[] = [
  { id: "a", lane: "backend", target: "x", goal: "g" },
  { id: "b", lane: "backend", target: "y", goal: "g" },
  { id: "c", lane: "cli", target: "z", goal: "g" },
];

describe("statusOf / mark", () => {
  it("absent id is pending", () => { expect(statusOf({}, "a")).toBe("pending"); });
  it("mark sets status immutably", () => {
    const p = mark({}, "a", "done");
    expect(p.a).toBe("done");
    expect(statusOf(p, "a")).toBe("done");
  });
  it("mark ignores bad status", () => { expect(mark({}, "a", "bogus" as any)).toEqual({}); });
});

describe("nextPending — drain order", () => {
  it("returns first pending, skipping done/proposed", () => {
    const p: Progress = { a: "done", b: "proposed" };
    expect(nextPending(cat, p)?.id).toBe("c");
  });
  it("null when all done/proposed (drained)", () => {
    expect(nextPending(cat, { a: "done", b: "done", c: "proposed" })).toBeNull();
  });
  it("first task when ledger empty", () => { expect(nextPending(cat, {})?.id).toBe("a"); });
});

describe("summary / laneSummary", () => {
  it("counts done/proposed/pending", () => {
    expect(summary(cat, { a: "done", b: "proposed" })).toEqual({ total: 3, done: 1, proposed: 1, pending: 1 });
  });
  it("per-lane done/total", () => {
    expect(laneSummary(cat, { a: "done" })).toEqual([
      { lane: "backend", done: 1, total: 2 },
      { lane: "cli", done: 0, total: 1 },
    ]);
  });
});
