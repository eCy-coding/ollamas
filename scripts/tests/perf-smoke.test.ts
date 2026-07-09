// v1.29.2 µ1 — pure-logic coverage for the perf-smoke p95 computation. Importing the
// module MUST NOT boot the server (invokedDirectly guard); only the pure fns are exercised.
import { describe, test, expect } from "vitest";
import { percentile, summarize } from "../perf-smoke";

describe("percentile (nearest-rank)", () => {
  test("empty input → NaN", () => {
    expect(percentile([], 95)).toBeNaN();
  });

  test("single sample → that sample for any p", () => {
    expect(percentile([7], 50)).toBe(7);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([7], 99)).toBe(7);
  });

  test("p100 → max, low p → min", () => {
    const xs = [10, 20, 30, 40, 50];
    expect(percentile(xs, 100)).toBe(50);
    expect(percentile(xs, 1)).toBe(10);
  });

  test("nearest-rank p95 of 1..100 → 95", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 50)).toBe(50);
  });

  test("unsorted input is handled (non-mutating)", () => {
    const xs = [30, 10, 50, 20, 40];
    expect(percentile(xs, 95)).toBe(50);
    expect(xs).toEqual([30, 10, 50, 20, 40]); // caller's array untouched
  });
});

describe("summarize", () => {
  test("derives ordered stats from a sample set", () => {
    const s = summarize([5, 1, 4, 2, 3]);
    expect(s.n).toBe(5);
    expect(s.min).toBe(1);
    expect(s.max).toBe(5);
    expect(s.p50).toBe(3);
    expect(s.min).toBeLessThanOrEqual(s.p50);
    expect(s.p50).toBeLessThanOrEqual(s.p95);
    expect(s.p95).toBeLessThanOrEqual(s.p99);
    expect(s.p99).toBeLessThanOrEqual(s.max);
  });
});
