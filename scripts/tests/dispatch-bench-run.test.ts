import { describe, it, expect } from "vitest";
import { countDupTools, foldMetrics } from "../dispatch-bench-run.mjs";

describe("countDupTools — repeated (tool,args) pairs", () => {
  it("counts each repeat beyond the first", () => {
    const steps = [
      { tool: "write_host_file", args: '{"path":"a"}' },
      { tool: "macos_terminal", args: '{"cmd":"x"}' },
      { tool: "write_host_file", args: '{"path":"a"}' }, // dup of #1
      { tool: "write_host_file", args: '{"path":"a"}' }, // dup again
    ];
    expect(countDupTools(steps)).toBe(2);
  });
  it("no dups → 0; empty → 0", () => {
    expect(countDupTools([{ tool: "a", args: "1" }, { tool: "b", args: "2" }])).toBe(0);
    expect(countDupTools([])).toBe(0);
  });
});

describe("foldMetrics — verdict/correct/steps/tokS from SSE events", () => {
  it("DONE verdict + tool steps → correct, captures tokensPerSec from done event", () => {
    const events = [
      { type: "step", tool: "write_host_file", args: { path: "f" }, ok: true },
      { type: "step", tool: "macos_terminal", args: { cmd: "python3 f" }, ok: true },
      { type: "done", text: "VERDICT: DONE output was 120", tokensPerSec: 14.2 },
    ];
    const m = foldMetrics(events);
    expect(m.verdict).toBe("DONE");
    expect(m.correct).toBe(true);
    expect(m.steps).toBe(2);
    expect(m.dupTools).toBe(0);
    expect(m.tokS).toBe(14.2);
  });
  it("zero tool steps + chatty message → demoSuspected → not correct", () => {
    const m = foldMetrics([{ type: "message", text: "I would write..." }, { type: "done", text: "ok" }]);
    expect(m.correct).toBe(false);
  });
  it("error event → INCOMPLETE, not correct; tokS defaults 0", () => {
    const m = foldMetrics([{ type: "error", message: "HTTP 404" }]);
    expect(m.verdict).toBe("INCOMPLETE");
    expect(m.correct).toBe(false);
    expect(m.tokS).toBe(0);
  });
  it("garbage input → total (no throw)", () => {
    expect(() => foldMetrics(null as any)).not.toThrow();
    expect(foldMetrics([null, 42, "x"] as any).steps).toBe(0);
  });
  it("server tokS=0 + latency → wall-clock ESTIMATE, flagged tokSEstimated", () => {
    const events = [
      { type: "step", tool: "write_host_file", args: { path: "/x/factorial.py" }, ok: true },
      { type: "done", text: "VERDICT: DONE saw 120", tokensPerSec: 0 },
    ];
    // genChars = "write_host_file"(15) + JSON({path})(~22) + "VERDICT: DONE saw 120"(21) ≈ 58 → /4 ≈ 14.5 tok over 2s
    const m = foldMetrics(events, 2000);
    expect(m.tokSEstimated).toBe(true);
    expect(m.tokS).toBeGreaterThan(0);
  });
  it("server tokS present → ground-truth wins, NOT estimated", () => {
    const events = [
      { type: "step", tool: "macos_terminal", args: { cmd: "python3 f" }, ok: true },
      { type: "done", text: "VERDICT: DONE", tokensPerSec: 31.5 },
    ];
    const m = foldMetrics(events, 2000);
    expect(m.tokS).toBe(31.5);
    expect(m.tokSEstimated).toBe(false);
  });
  it("estimate is deterministic for fixed inputs", () => {
    const events = [{ type: "done", text: "VERDICT: DONE 120", tokensPerSec: 0 }];
    expect(foldMetrics(events, 1000).tokS).toBe(foldMetrics(events, 1000).tokS);
  });
});
