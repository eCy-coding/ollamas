import { describe, it, expect } from "vitest";
import { median, mean, aggregate, pickBest, type ModelResult } from "../cli/lib/bench";

describe("median / mean", () => {
  it("median of odd and even lengths", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
  it("mean ignores NaN/empty", () => {
    expect(mean([2, 4])).toBe(3);
    expect(mean([])).toBe(0);
  });
});

describe("aggregate", () => {
  it("medians latency, means throughput, ratios correctness", () => {
    const r = aggregate("mac", "qwen3:8b", [
      { ttfbMs: 100, totalMs: 1000, tokPerSec: 30, correct: true },
      { ttfbMs: 200, totalMs: 1200, tokPerSec: 40, correct: true },
      { ttfbMs: 300, totalMs: 5000, tokPerSec: 0, correct: false }, // cold outlier
    ]);
    expect(r.ttfbMs).toBe(200); // median
    expect(r.totalMs).toBe(1200); // median (robust to the 5000 outlier)
    expect(r.tokPerSec).toBe(35); // mean of 30,40 (0 dropped)
    expect(r.correctRatio).toBeCloseTo(2 / 3);
    expect(r.runs).toBe(3);
  });
  it("falls back to totalMs when ttfb missing", () => {
    const r = aggregate("mac", "m", [{ totalMs: 500, correct: true }]);
    expect(r.ttfbMs).toBe(500);
  });
});

describe("pickBest", () => {
  const mk = (model: string, tok: number, ratio: number): ModelResult => ({
    target: "mac", model, runs: 3, ttfbMs: 100, totalMs: 1000, tokPerSec: tok, correctRatio: ratio,
  });
  it("picks the highest throughput among correct models", () => {
    const best = pickBest([mk("a", 20, 1), mk("b", 50, 1), mk("c", 80, 0)]); // c fast but wrong
    expect(best?.model).toBe("b");
  });
  it("returns null when nothing is correct", () => {
    expect(pickBest([mk("a", 99, 0), mk("b", 50, 0.2)])).toBeNull();
  });
});
