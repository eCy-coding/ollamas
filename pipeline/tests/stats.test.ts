import { describe, it, expect } from "vitest";
import { percentile, stddev, cv, ci95, summarize, runSetQuality, summarizeSteps, median, mean, sufficientN } from "../lib/stats";

describe("percentile", () => {
  it("returns an OBSERVED sample, never an interpolated one", () => {
    const xs = [10, 20, 30, 40, 100];
    // p95 of 5 samples must be one of the 5 measured values — a latency budget is judged
    // against numbers the system actually produced.
    expect(xs).toContain(percentile(xs, 95));
    expect(percentile(xs, 95)).toBe(100);
    expect(percentile(xs, 50)).toBe(30);
  });

  it("clamps out-of-range percentiles to min/max", () => {
    expect(percentile([5, 1, 9], 0)).toBe(1);
    expect(percentile([5, 1, 9], -10)).toBe(1);
    expect(percentile([5, 1, 9], 100)).toBe(9);
    expect(percentile([5, 1, 9], 500)).toBe(9);
  });

  it("is 0 for empty input and ignores NaN/Infinity", () => {
    expect(percentile([], 95)).toBe(0);
    expect(percentile([NaN, Infinity, 7], 50)).toBe(7);
  });

  it("does not mutate the caller's array", () => {
    const xs = [3, 1, 2];
    percentile(xs, 50);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("stddev / cv", () => {
  it("uses the sample (n−1) denominator", () => {
    // mean 4, deviations ±2 → sample sd = sqrt((4+4)/1) = 2.828…
    expect(stddev([2, 6])).toBeCloseTo(2.828, 3);
  });

  it("is 0 for fewer than two samples", () => {
    expect(stddev([])).toBe(0);
    expect(stddev([42])).toBe(0);
  });

  it("cv is 0 when the mean is 0", () => {
    expect(cv([0, 0])).toBe(0);
    expect(cv([10, 10])).toBe(0);
  });
});

describe("ci95", () => {
  it("is degenerate for n < 2", () => {
    expect(ci95([5])).toEqual({ lo: 5, hi: 5, margin: 0 });
    expect(ci95([])).toEqual({ lo: 0, hi: 0, margin: 0 });
  });

  it("brackets the mean and widens with spread", () => {
    const tight = ci95([100, 101, 99, 100, 100]);
    const loose = ci95([100, 200, 50, 150, 10]);
    expect(tight.lo).toBeLessThan(100.5);
    expect(tight.hi).toBeGreaterThan(99.5);
    expect(loose.margin).toBeGreaterThan(tight.margin);
  });

  it("falls back to the z-approximation beyond the t-table", () => {
    const many = Array.from({ length: 30 }, (_, i) => 100 + (i % 3));
    expect(ci95(many).margin).toBeGreaterThan(0);
  });
});

describe("summarize", () => {
  it("reports the full distribution", () => {
    const s = summarize([100, 110, 120, 130, 500]);
    expect(s.n).toBe(5);
    expect(s.min).toBe(100);
    expect(s.max).toBe(500);
    expect(s.p50).toBe(120);
    expect(s.p999).toBe(500);
    expect(s.stddev).toBeGreaterThan(0);
  });

  it("is all-zero for no samples", () => {
    const s = summarize([]);
    expect(s).toMatchObject({ n: 0, min: 0, max: 0, p50: 0, p95: 0, mean: 0, stddev: 0 });
  });

  it("marks tail percentiles UNreliable for tiny N (the honest N-guard)", () => {
    const s = summarize([100, 110, 120, 130, 500]); // n=5
    expect(s.p99Reliable).toBe(false);  // p99 needs n≥100
    expect(s.p999Reliable).toBe(false); // p999 needs n≥1000
  });
});

describe("sufficientN — tail-percentile honesty", () => {
  it("requires ⌈1/(1−p/100)⌉ samples", () => {
    expect(sufficientN(1, 99.9)).toBe(false);
    expect(sufficientN(999, 99.9)).toBe(false);
    expect(sufficientN(1000, 99.9)).toBe(true);
    expect(sufficientN(100, 99)).toBe(true);
    expect(sufficientN(99, 99)).toBe(false);
    expect(sufficientN(20, 95)).toBe(true);
    expect(sufficientN(2, 50)).toBe(true);
    expect(sufficientN(1, 50)).toBe(false); // median needs ≥2 samples
    expect(sufficientN(1, 100)).toBe(true); // p100 edge: any sample
  });
});

describe("runSetQuality", () => {
  it("rejects too few runs", () => {
    const q = runSetQuality([100, 100]);
    expect(q.enough).toBe(false);
    expect(q.reason).toMatch(/need ≥3/);
  });

  it("rejects a noisy set even when there are enough runs", () => {
    const q = runSetQuality([10, 500, 30, 900]);
    expect(q.enough).toBe(true);
    expect(q.stable).toBe(false);
    expect(q.reason).toMatch(/noisy/);
  });

  it("accepts enough stable runs", () => {
    expect(runSetQuality([100, 102, 98, 101])).toMatchObject({ enough: true, stable: true, reason: "ok" });
  });
});

describe("summarizeSteps", () => {
  it("groups per-step durations across runs", () => {
    const out = summarizeSteps([
      { search: 10, think: 300 },
      { search: 12, think: 320 },
      { search: 11, think: 900 },
    ]);
    expect(out.search.n).toBe(3);
    expect(out.think.p95).toBe(900);
  });

  it("tolerates a missing/empty run record", () => {
    const out = summarizeSteps([{ a: 1 }, undefined as never]);
    expect(out.a.n).toBe(1);
  });
});

describe("re-exports", () => {
  it("reuses cli/lib/bench median+mean rather than reimplementing them", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(mean([2, 4])).toBe(3);
  });
});
