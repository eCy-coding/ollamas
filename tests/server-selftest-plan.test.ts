import { describe, it, expect } from "vitest";
import { selftestProbePlan } from "../server/selftest-plan";

describe("selftestProbePlan — local gates run whenever ollama is reachable", () => {
  it("full live: probe + agent loop run against ollama-local", () => {
    expect(selftestProbePlan("live")).toEqual({
      probeOllama: true,
      runAgentLoop: true,
      pipelineProvider: "ollama-local",
      pipelineModel: "qwen3:8b",
      expectedSource: "ollama_local",
    });
  });

  it("degraded-live: SAME as live — gates must NOT dishonestly skip (the regression guard)", () => {
    const p = selftestProbePlan("degraded-live");
    expect(p.probeOllama).toBe(true);
    expect(p.runAgentLoop).toBe(true);            // was false (skipped as "demo") before the fix
    expect(p.pipelineProvider).toBe("ollama-local"); // was "demo" before the fix
    expect(p.expectedSource).toBe("ollama_local");
    // identical to full live
    expect(p).toEqual(selftestProbePlan("live"));
  });

  it("demo: a cloud sandbox skips the local probes (honest)", () => {
    expect(selftestProbePlan("demo")).toEqual({
      probeOllama: false,
      runAgentLoop: false,
      pipelineProvider: "demo",
      pipelineModel: "simulation",
      expectedSource: "demo",
    });
  });
});
