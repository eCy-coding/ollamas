// orchestra.test.ts — behavior of orchestra.ts's pure conductor core. orchestra.ts is a long-running
// tick loop (spawns child CLIs, probes Ollama, writes state) — all IO. Its decision logic lives in pure
// helpers: the REPAIR stream picker + proposal tokens (orchestra-repair) and the task-drain ledger
// (task-progress). Those are asserted here; the IO tick/main is exercised by orchestra-* e2e suites.
import { describe, it, expect } from "vitest";
import { orderStreams, proposalHeader, applyToken, ORCHESTRA_SLOT } from "../bin/lib/orchestra-repair";
import { statusOf, nextPending, mark, summary, laneSummary } from "../bin/lib/task-progress";
import type { Task } from "../bin/lib/task-catalog";

const T = (id: string, lane = "orchestration"): Task => ({ id, lane, target: `t/${id}.ts`, goal: "g" });

describe("orchestra/repair stream selection", () => {
  it("orders streams the task names first, preserving order for the rest", () => {
    expect(orderStreams("fix the backend now", ["frontend", "backend", "cli"])).toEqual(["backend", "frontend", "cli"]);
  });
  it("is stable (no reorder) when the task names nothing / is empty", () => {
    expect(orderStreams("", ["frontend", "backend"])).toEqual(["frontend", "backend"]);
    expect(orderStreams(null, ["a", "b"])).toEqual(["a", "b"]);
  });
  it("formats the proposal header + apply token fleet-apply parses", () => {
    expect(proposalHeader("backend", "qwen3:8b")).toBe(`# backend · ${ORCHESTRA_SLOT} · qwen3:8b`);
    expect(applyToken("backend")).toBe(`backend.${ORCHESTRA_SLOT}`);
  });
});

describe("orchestra/task-drain ledger", () => {
  const catalog = [T("a"), T("b", "backend"), T("c")];

  it("treats an absent id as pending and drains pending tasks in catalog order", () => {
    expect(statusOf({}, "a")).toBe("pending");
    expect(nextPending(catalog, {})?.id).toBe("a");
    expect(nextPending(catalog, { a: "done", b: "proposed" })?.id).toBe("c");
    expect(nextPending(catalog, { a: "done", b: "done", c: "done" })).toBeNull();
  });

  it("mark returns a new ledger and ignores unknown status", () => {
    const p0: Record<string, "pending" | "proposed" | "done"> = {};
    const p1 = mark(p0, "a", "done");
    expect(p1).not.toBe(p0);          // immutable
    expect(p1.a).toBe("done");
    // @ts-expect-error — unknown status is ignored, ledger unchanged
    expect(mark(p1, "a", "bogus")).toBe(p1);
  });

  it("rolls up totals and per-lane done/total", () => {
    const prog = { a: "done", b: "proposed" } as Record<string, "pending" | "proposed" | "done">;
    expect(summary(catalog, prog)).toEqual({ total: 3, done: 1, proposed: 1, pending: 1 });
    expect(laneSummary(catalog, prog)).toEqual([
      { lane: "orchestration", done: 1, total: 2 },
      { lane: "backend", done: 0, total: 1 },
    ]);
  });
});
