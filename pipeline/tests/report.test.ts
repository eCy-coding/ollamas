import { describe, it, expect } from "vitest";
import { buildReport, errorRatePct, contentHash, artifactName, renderSummary, type BuildInput, type EnvMeta } from "../lib/report";
import { summarize } from "../lib/stats";
import { decide } from "../lib/gates";

const env: EnvMeta = {
  timestamp: "2026-07-24T13:05:00Z",
  run_id: "11111111-2222-3333-4444-555555555555",
  git_sha: "abcdef1234567890",
  os: "darwin 24.6.0",
  arch: "arm64",
  cpu_count: 10,
  mem_gb: 16,
  node: "v24.16.0",
};

const okSteps = [
  { id: "search", action: "search", ok: true, duration_ms: 30 },
  { id: "think", action: "think", ok: true, duration_ms: 200 },
];

const input = (over: Partial<BuildInput> = {}): BuildInput => ({
  workflow_version: "3.0",
  env,
  profile: "simple",
  steps: okSteps,
  step_summaries: { search: summarize([30]), think: summarize([200]) },
  total: summarize([1000, 1100, 1200]),
  cache: { hits: 3, misses: 1 },
  parallelism: 1.5,
  decision: decide({
    steps: { think: summarize([200]), sandbox_test: summarize([300]) },
    total: summarize([1000, 1100, 1200]),
    errorRatePct: 0,
    coveragePct: 95,
    security: { high: 0 },
    chaosSuccess: 0.99,
    totals: [1000, 1100, 1200],
  }),
  audit: { complete: true, missing: [] },
  ...over,
});

describe("errorRatePct", () => {
  it("divides by steps ATTEMPTED so an early abort does not shrink the rate", () => {
    expect(errorRatePct([{ id: "a", action: "a", ok: false, duration_ms: 1 }])).toBe(100);
    expect(errorRatePct(okSteps)).toBe(0);
  });

  it("is 0 with no steps", () => {
    expect(errorRatePct([])).toBe(0);
  });
});

describe("buildReport", () => {
  it("computes cache ratio and carries the decision", () => {
    const r = buildReport(input());
    expect(r.cache.ratio).toBe(0.75);
    expect(r.error_rate_pct).toBe(0);
    expect(r.decision.go_ahead).toBe(true);
    expect(r.status).toBe("complete");
  });

  it("is 0-ratio when the cache was never consulted", () => {
    expect(buildReport(input({ cache: { hits: 0, misses: 0 } })).cache.ratio).toBe(0);
  });

  // The prompt's self-audit rule: holes in the harness downgrade the run even when the SLOs
  // passed. Green gates on an incomplete harness is precisely the blind spot to prevent.
  it("marks the run incomplete when the audit has holes, despite passing gates", () => {
    const r = buildReport(input({ audit: { complete: false, missing: ["chaos"] } }));
    expect(r.decision.go_ahead).toBe(true);
    expect(r.status).toBe("incomplete");
  });

  it("marks the run incomplete when a gate failed", () => {
    const failing = decide({ coveragePct: 1, totals: [1, 2, 3] });
    expect(buildReport(input({ decision: failing })).status).toBe("incomplete");
  });
});

describe("contentHash", () => {
  it("ignores env so two identical runs hash identically", () => {
    const a = buildReport(input());
    const b = buildReport(input({ env: { ...env, run_id: "different", timestamp: "2027-01-01T00:00:00Z" } }));
    expect(contentHash(a)).toBe(contentHash(b));
  });

  it("changes when the measurements change", () => {
    const a = buildReport(input());
    const b = buildReport(input({ parallelism: 9 }));
    expect(contentHash(a)).not.toBe(contentHash(b));
  });
});

describe("artifactName", () => {
  it("sorts by time and dedups by content", () => {
    const n = artifactName(buildReport(input()));
    expect(n).toMatch(/^simple-20260724-130500-11111111-[0-9a-f]{12}\.json$/);
  });
});

describe("renderSummary", () => {
  it("reports numbers, run id and status", () => {
    const lines = renderSummary(buildReport(input()));
    expect(lines[0]).toContain("run_id=11111111");
    expect(lines.some((l) => l.includes("p95=") && l.includes("p999="))).toBe(true);
    expect(lines.some((l) => l.includes("status=complete"))).toBe(true);
  });

  it("surfaces weak evidence and missing audit items", () => {
    const weak = decide({
      steps: { think: summarize([200]), sandbox_test: summarize([300]) },
      total: summarize([1000]), errorRatePct: 0, coveragePct: 95,
      security: { high: 0 }, chaosSuccess: 0.99, totals: [1000],
    });
    const lines = renderSummary(buildReport(input({ decision: weak, audit: { complete: false, missing: ["chaos"] } })));
    expect(lines.some((l) => l.includes("weak evidence"))).toBe(true);
    expect(lines.some((l) => l.includes("missing: chaos"))).toBe(true);
  });
});
