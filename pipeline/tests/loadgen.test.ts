import { describe, it, expect } from "vitest";
import { schedule, plannedDurationMs, summarizeLoad, toK6Summary, LoadError, type Arrival } from "../lib/loadgen";

describe("schedule", () => {
  it("closed-loop paces by completion, so every item starts at 0", () => {
    const s = schedule({ model: "closed", maxConcurrency: 3, iterations: 5 });
    expect(s).toHaveLength(5);
    expect(s.every((i) => i.atMs === 0)).toBe(true);
  });

  // Computing offsets UP FRONT is the point: a slow system then falls behind its schedule
  // (visible as queueing) instead of silently slowing the arrival rate to match, which would
  // hide the saturation being measured.
  it("open-loop spaces arrivals by 1/rate", () => {
    const s = schedule({ model: "open", arrivalRateRps: 4, iterations: 3 });
    expect(s.map((i) => i.atMs)).toEqual([0, 250, 500]);
  });

  it("prepends warm-up iterations and flags them", () => {
    const s = schedule({ model: "open", arrivalRateRps: 10, iterations: 3, warmup: 2 });
    expect(s).toHaveLength(5);
    expect(s.filter((i) => i.warmup)).toHaveLength(2);
    expect(s[0].warmup).toBe(true);
    expect(s[2].warmup).toBe(false);
  });

  it("rejects invalid configurations rather than guessing", () => {
    expect(() => schedule({ model: "closed", iterations: 0 })).toThrow(LoadError);
    expect(() => schedule({ model: "closed", maxConcurrency: 0, iterations: 5 })).toThrow(/maxConcurrency/);
    expect(() => schedule({ model: "open", arrivalRateRps: 0, iterations: 5 })).toThrow(/arrivalRateRps/);
  });
});

describe("plannedDurationMs", () => {
  it("is the last arrival offset for open-loop and 0 for closed", () => {
    expect(plannedDurationMs({ model: "open", arrivalRateRps: 2, iterations: 5 })).toBe(2000);
    expect(plannedDurationMs({ model: "closed", maxConcurrency: 2, iterations: 5 })).toBe(0);
  });
});

describe("summarizeLoad", () => {
  const arrivals = (over: Partial<Arrival>[] = []): Arrival[] => [
    { index: 0, atMs: 0, startedMs: 0, durationMs: 100, ok: true, warmup: true },
    { index: 1, atMs: 100, startedMs: 100, durationMs: 120, ok: true, warmup: false },
    { index: 2, atMs: 200, startedMs: 205, durationMs: 130, ok: true, warmup: false },
    ...over.map((o, i) => ({ index: 3 + i, atMs: 0, startedMs: 0, durationMs: 0, ok: true, warmup: false, ...o })),
  ];

  it("discards warm-up from the measured set", () => {
    const s = summarizeLoad("open", arrivals(), 1000);
    expect(s.iterations).toBe(2);
    expect(s.warmupDiscarded).toBe(1);
    expect(s.durations).toEqual([120, 130]);
  });

  // If the generator itself fell behind, the reported latency measures the harness, not the
  // system — so lateness is surfaced rather than folded into the average.
  it("counts iterations that started late and reports the worst lag", () => {
    const s = summarizeLoad("open", arrivals([{ atMs: 300, startedMs: 900, durationMs: 50 }]), 1000);
    expect(s.behindSchedule).toBe(1);
    expect(s.maxLagMs).toBe(600);
  });

  it("tolerates small jitter without calling it late", () => {
    const s = summarizeLoad("open", arrivals(), 1000);
    expect(s.behindSchedule).toBe(0); // the 5 ms slip on index 2 is under the 50 ms tolerance
  });

  it("computes achieved rps and error rate over measured iterations only", () => {
    const s = summarizeLoad("closed", arrivals([{ ok: false, durationMs: 10 }]), 1000);
    expect(s.achievedRps).toBe(3);
    expect(s.errorRatePct).toBeCloseTo(33.33, 1);
  });

  it("is zero-safe with no wall clock and no measured items", () => {
    const s = summarizeLoad("closed", [], 0);
    expect(s.achievedRps).toBe(0);
    expect(s.errorRatePct).toBe(0);
    expect(s.maxLagMs).toBe(0);
  });
});

describe("toK6Summary", () => {
  it("emits a k6-shaped document so results can be diffed against a real k6 run", () => {
    const s = summarizeLoad("open", [
      { index: 0, atMs: 0, startedMs: 0, durationMs: 100, ok: true, warmup: false },
      { index: 1, atMs: 100, startedMs: 400, durationMs: 200, ok: false, warmup: false },
    ], 1000);
    const k6 = toK6Summary(s, { p50: 100, p95: 200, p99: 200 }) as Record<string, Record<string, Record<string, number>>>;
    expect(k6.metrics.iterations.count).toBe(2);
    expect(k6.metrics.iteration_duration["p(95)"]).toBe(200);
    expect(k6.metrics.dropped_iterations.count).toBe(1);
    expect(k6.metrics.checks.fails).toBe(1);
  });
});
