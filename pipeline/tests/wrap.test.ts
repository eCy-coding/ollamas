// Runtime (I/O) tests for the measurement wrapper. These live in the pipeline lane but are
// NOT part of the pure-core coverage glob — they touch the clock, the process and the
// Prometheus registry on purpose, because that wiring is exactly what can silently break.
import { describe, it, expect } from "vitest";
import { sample, benchmarkStart, benchmarkStep, benchmarkEnd } from "../runtime/wrap";
import { metricsObserved, register } from "../runtime/metrics";

describe("sample", () => {
  it("returns a monotonic clock, cumulative cpu and current rss", () => {
    const a = sample();
    const b = sample();
    expect(b.t).toBeGreaterThanOrEqual(a.t);
    expect(b.cpuUs).toBeGreaterThanOrEqual(a.cpuUs);
    expect(a.rssBytes).toBeGreaterThan(0);
  });
});

describe("benchmarkStart", () => {
  it("captures the reproducibility metadata the prompt requires", () => {
    const { env, started } = benchmarkStart(["docker up"]);
    expect(env.run_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(env.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/); // ISO-8601 UTC
    expect(env.cpu_count).toBeGreaterThan(0);
    expect(env.mem_gb).toBeGreaterThan(0);
    expect(env.node).toBe(process.version);
    expect(env.notes).toEqual(["docker up"]);
    expect(started.t).toBeGreaterThan(0);
  });

  it("gives every run a distinct id", () => {
    expect(benchmarkStart().env.run_id).not.toBe(benchmarkStart().env.run_id);
  });

  // "unknown" is acceptable; a plausible-looking fake SHA is not — the field exists to be
  // an audit trail.
  it("records a real git SHA or the literal 'unknown'", () => {
    const sha = benchmarkStart().env.git_sha;
    expect(sha === "unknown" || /^[0-9a-f]{40}$/.test(sha)).toBe(true);
  });
});

describe("benchmarkStep", () => {
  it("records a successful step and returns its value", async () => {
    const { record, value } = await benchmarkStep({ id: "t1", action: "think", profile: "test" }, () => "answer");
    expect(value).toBe("answer");
    expect(record).toMatchObject({ id: "t1", action: "think", ok: true });
    expect(record.duration_ms).toBeGreaterThanOrEqual(0);
    expect(record.output_excerpt).toBe("answer");
  });

  // A thrown step must become a FAILED RECORD, not a crashed pipeline: otherwise error-rate
  // is unmeasurable (no report is produced at all) and every gate reports MISS for the wrong
  // reason.
  it("converts a thrown step into a failed record instead of propagating", async () => {
    const { record, value } = await benchmarkStep({ id: "t2", action: "sandbox_test", profile: "test" }, () => {
      throw new Error("boom");
    });
    expect(value).toBeNull();
    expect(record.ok).toBe(false);
    expect(record.error).toBe("Error: boom");
  });

  it("awaits async steps", async () => {
    const { value } = await benchmarkStep({ id: "t3", action: "search", profile: "test" }, async () => {
      await new Promise((r) => setTimeout(r, 5));
      return { hits: 3 };
    });
    expect(value).toEqual({ hits: 3 });
  });

  it("does not throw on an unserialisable result", async () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const { record } = await benchmarkStep({ id: "t4", action: "code", profile: "test" }, () => circular);
    expect(record.ok).toBe(true);
    expect(record.output_excerpt).toBe("[unserialisable]");
  });

  it("carries the cache-hit flag through to the record", async () => {
    const { record } = await benchmarkStep({ id: "t5", action: "search", profile: "test", cacheHit: true }, () => "x");
    expect(record.cache_hit).toBe(true);
  });
});

describe("metrics wiring", () => {
  it("registers on the EXISTING /metrics registry, not a second one", async () => {
    await benchmarkStep({ id: "m1", action: "think", profile: "test" }, () => "x");
    const text = await register.metrics();
    expect(text).toContain("workflow_step_duration_seconds");
    // proof it is the shared registry: the pre-existing http metric is on the same scrape
    expect(text).toContain("http_request_duration_ms");
  });

  it("reports metricsObserved once a step has run", async () => {
    await benchmarkStep({ id: "m2", action: "analyze", profile: "test" }, () => "x");
    expect(await metricsObserved()).toBe(true);
  });

  it("counts a failed step in workflow_step_errors_total", async () => {
    await benchmarkStep({ id: "m3", action: "test", profile: "test" }, () => {
      throw new Error("nope");
    });
    expect(await register.metrics()).toMatch(/workflow_step_errors_total\{[^}]*step="m3"[^}]*\} 1/);
  });
});

describe("benchmarkEnd", () => {
  it("returns a final sample and increments the run counter", async () => {
    const end = benchmarkEnd("test");
    expect(end.t).toBeGreaterThan(0);
    expect(await register.metrics()).toContain("workflow_runs_total");
  });
});
