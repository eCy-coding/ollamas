import { describe, it, expect } from "vitest";
import { preflight, isRunConverged, shouldContinueRun, renderRunReport, type RunRound, type StreamState } from "../bin/lib/fleet-run";

describe("preflight", () => {
  it("ready only when bridge + server are up (workspace is auto-fixable)", () => {
    expect(preflight({ bridgeOk: true, serverOk: true, workspaceOk: true }).ready).toBe(true);
    expect(preflight({ bridgeOk: true, serverOk: true, workspaceOk: false }).ready).toBe(true);
    expect(preflight({ bridgeOk: false, serverOk: true, workspaceOk: true }).ready).toBe(false);
    expect(preflight({ bridgeOk: true, serverOk: false, workspaceOk: true }).ready).toBe(false);
  });
  it("lists the missing preconditions", () => {
    const p = preflight({ bridgeOk: false, serverOk: false, workspaceOk: false });
    expect(p.issues.some((i) => i.includes("bridge"))).toBe(true);
    expect(p.issues.some((i) => i.includes("server"))).toBe(true);
    expect(p.issues.some((i) => i.includes("workspace"))).toBe(true);
  });
});

describe("isRunConverged", () => {
  it("true only when all streams gated", () => {
    expect(isRunConverged(6, 6)).toBe(true);
    expect(isRunConverged(5, 6)).toBe(false);
    expect(isRunConverged(0, 0)).toBe(false);
  });
});

describe("shouldContinueRun — bounded", () => {
  it("stops on convergence", () => { expect(shouldContinueRun(1, 3, true)).toBe(false); });
  it("continues while not converged under the cap", () => { expect(shouldContinueRun(1, 3, false)).toBe(true); });
  it("stops at the round cap (no infinite loop)", () => { expect(shouldContinueRun(3, 3, false)).toBe(false); });
});

describe("renderRunReport", () => {
  const rounds: RunRound[] = [
    { round: 1, done: 5, total: 6, redispatched: 1, converged: false },
    { round: 2, done: 6, total: 6, redispatched: 0, converged: true },
  ];
  const streams: StreamState[] = [
    { stream: "shell-harden", done: true }, { stream: "mjs-migration", done: true },
    { stream: "typescript-core", done: true }, { stream: "errors-resilience", done: true },
    { stream: "concurrency-safety", done: true }, { stream: "test-coverage", done: true },
  ];

  it("reports CONVERGED with per-round progress and stream states", () => {
    const md = renderRunReport(rounds, streams, 3, "2026-07-02T00:00:00Z");
    expect(md).toContain("# FLEET_RUN.md");
    expect(md).toContain("✅ CONVERGED");
    expect(md).toContain("6/6 streams gated");
    expect(md).toContain("round 1: 5/6 gated · re-dispatched 1");
    expect(md).not.toContain("Remaining (honest");
  });

  it("reports honest remaining when a stream never gates", () => {
    const notDone = streams.map((s, i) => (i === 0 ? { ...s, done: false } : s));
    const md = renderRunReport([{ round: 3, done: 5, total: 6, redispatched: 2, converged: false }], notDone, 3, "t");
    expect(md).toContain("NOT CONVERGED");
    expect(md).toContain("Remaining (honest");
    expect(md).toContain("⏳ shell-harden");
  });
});
