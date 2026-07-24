import { describe, it, expect } from "vitest";
import {
  deltaMs, cpuMs, peakRss, toStepRecord, excerpt, durationsOf, totalMs, cpuBoundMs, observedConcurrency,
  type ResourceSample,
} from "../lib/timing";

const s = (t: number, cpuUs = 0, rssBytes = 0): ResourceSample => ({ t, cpuUs, rssBytes });

describe("deltaMs", () => {
  it("measures elapsed monotonic time", () => {
    expect(deltaMs(s(100), s(350))).toBe(250);
  });

  // One negative sample poisons every percentile downstream — it can make p50 < min and
  // turn an SLO breach into a pass.
  it("clamps a backwards clock to zero instead of emitting a negative duration", () => {
    expect(deltaMs(s(500), s(100))).toBe(0);
  });
});

describe("cpuMs", () => {
  it("converts process.cpuUsage microseconds to milliseconds", () => {
    expect(cpuMs(s(0, 1_000), s(0, 3_500))).toBe(2.5);
  });

  it("clamps a decreasing counter to zero", () => {
    expect(cpuMs(s(0, 5_000), s(0, 1_000))).toBe(0);
  });
});

describe("peakRss", () => {
  // Memory is a level, not a counter: a step that allocates 400 MB and frees it has a delta
  // near zero while having been the reason the machine swapped.
  it("reports the peak of both samples, not the difference", () => {
    expect(peakRss(s(0, 0, 400e6), s(0, 0, 50e6))).toBe(400e6);
    expect(peakRss(s(0, 0, 50e6), s(0, 0, 400e6))).toBe(400e6);
  });
});

describe("toStepRecord", () => {
  it("builds a complete record from two samples", () => {
    const r = toStepRecord(
      { id: "think", action: "think", ok: true, cacheHit: true, invocation: "POST /v1/chat" },
      s(10, 1_000, 100e6),
      s(210, 5_000, 180e6),
    );
    expect(r).toMatchObject({
      id: "think", action: "think", ok: true,
      duration_ms: 200, cpu_ms: 4, mem_bytes: 180e6, cache_hit: true, invocation: "POST /v1/chat",
    });
    expect(r.error).toBeUndefined();
  });

  it("omits optional fields rather than emitting undefined keys", () => {
    const r = toStepRecord({ id: "a", action: "a", ok: true }, s(0), s(1));
    expect("cache_hit" in r).toBe(false);
    expect("error" in r).toBe(false);
    expect("output_excerpt" in r).toBe(false);
  });

  it("carries the error text on failure", () => {
    const r = toStepRecord({ id: "a", action: "a", ok: false, error: "Error: boom" }, s(0), s(5));
    expect(r.ok).toBe(false);
    expect(r.error).toBe("Error: boom");
  });
});

describe("excerpt", () => {
  it("collapses whitespace and keeps short output whole", () => {
    expect(excerpt("  a\n\n  b  ")).toBe("a b");
  });

  it("truncates long output and says how much was dropped", () => {
    const e = excerpt("x".repeat(1000), 100);
    expect(e).toHaveLength(100 + "…(+900B)".length);
    expect(e).toMatch(/…\(\+900B\)$/);
  });

  it("handles nullish input", () => {
    expect(excerpt(undefined as never)).toBe("");
  });
});

describe("aggregates", () => {
  const steps = [
    { id: "a", action: "a", ok: true, duration_ms: 100 },
    { id: "b", action: "b", ok: true, duration_ms: 300 },
  ];

  it("maps step id to duration", () => {
    expect(durationsOf(steps)).toEqual({ a: 100, b: 300 });
  });

  it("sums step durations", () => {
    expect(cpuBoundMs(steps)).toBe(400);
  });

  // Wall-clock must NOT be the sum: concurrent steps would be counted once each, making a
  // parallel pipeline look slower than a serial one.
  it("totalMs is wall-clock, independent of the step sum", () => {
    expect(totalMs(s(1000), s(1250))).toBe(250);
    expect(totalMs(s(1000), s(1250))).not.toBe(cpuBoundMs(steps));
  });

  it("observedConcurrency exposes plan-vs-reality", () => {
    expect(observedConcurrency(steps, 400)).toBe(1);   // fully serial
    expect(observedConcurrency(steps, 200)).toBe(2);   // two steps overlapped
  });

  it("observedConcurrency degrades safely on a zero wall clock", () => {
    expect(observedConcurrency(steps, 0)).toBe(1);
  });
});
