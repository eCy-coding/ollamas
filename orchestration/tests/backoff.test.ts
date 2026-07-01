import { describe, it, expect } from "vitest";
import { fullJitterDelay, isTransient, shouldRetry } from "../bin/lib/backoff";

describe("fullJitterDelay — proven AWS full-jitter (deterministic via injected rand)", () => {
  it("exponential growth of the cap ceiling: base*2^attempt", () => {
    // rand=1 → delay == min(cap, base*2^a) (the exp ceiling); floor(rand*exp) but rand<1 so use ~0.999
    const r = () => 0.9999999;
    expect(fullJitterDelay(0, 100, 100000, r)).toBeLessThan(100);   // ~base
    expect(fullJitterDelay(1, 100, 100000, r)).toBeLessThan(200);   // ~2x
    expect(fullJitterDelay(2, 100, 100000, r)).toBeLessThan(400);   // ~4x
    expect(fullJitterDelay(3, 100, 100000, r)).toBeLessThan(800);   // ~8x
  });
  it("cap bounds the delay", () => {
    expect(fullJitterDelay(20, 100, 5000, () => 0.9999999)).toBeLessThanOrEqual(5000);
  });
  it("full jitter: rand=0 → 0 delay (uniform lower bound)", () => {
    expect(fullJitterDelay(5, 100, 5000, () => 0)).toBe(0);
  });
  it("jitter stays within [0, exp) — no thundering herd", () => {
    const exp = Math.min(5000, 100 * 2 ** 3); // 800
    for (const rv of [0, 0.25, 0.5, 0.75, 0.99]) {
      const d = fullJitterDelay(3, 100, 5000, () => rv);
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(exp);
    }
  });
});

describe("isTransient — retry only transient (network/throttle/5xx/timeout)", () => {
  it("transient signatures → true", () => {
    for (const m of ["HTTP 503", "socket hang up", "ETIMEDOUT", "fetch failed", "rate limit exceeded", "timed out", "502 Bad Gateway", "429"])
      expect(isTransient(m)).toBe(true);
  });
  it("non-transient → false (fail fast)", () => {
    for (const m of ["SyntaxError: bad JSON", "400 invalid model", "permission denied", "not found"])
      expect(isTransient(m)).toBe(false);
  });
  it("Error object + null handled", () => {
    expect(isTransient(new Error("connection ECONNRESET"))).toBe(true);
    expect(isTransient(null)).toBe(false);
  });
});

describe("shouldRetry — transient AND attempts remain", () => {
  it("retries transient under cap", () => expect(shouldRetry("503", 1, 3)).toBe(true));
  it("stops at max retries", () => expect(shouldRetry("503", 3, 3)).toBe(false));
  it("never retries non-transient", () => expect(shouldRetry("400 bad", 0, 3)).toBe(false));
});
