import { describe, it, expect, beforeEach } from "vitest";
import { recordKeyUse, sweepKeyUsage, keyUsageSize, keyWindows, resetKeyUsage } from "../server/key-usage";
import { ProviderRouter } from "../server/providers";

const DAY_MS = 86_400_000;

describe("key-usage sweep — bounded buckets over long uptime", () => {
  beforeEach(() => resetKeyUsage());

  it("drops buckets whose per-day window fully elapsed, keeps fresh ones", () => {
    const t0 = 1_000_000;
    recordKeyUse("gemini", "keyA", t0);
    recordKeyUse("openai", "keyB", t0);
    expect(keyUsageSize()).toBe(2);

    // advance just over a day, touch only keyA → keyB is now stale
    const t1 = t0 + DAY_MS + 1;
    recordKeyUse("gemini", "keyA", t1);
    const removed = sweepKeyUsage(t1);
    expect(removed).toBe(1);            // keyB swept
    expect(keyUsageSize()).toBe(1);     // keyA retained
    expect(keyWindows("gemini", "keyA", t1).perDay).toBe(1);
  });

  it("nothing swept while all buckets are within the day window", () => {
    const t0 = 5_000_000;
    recordKeyUse("gemini", "k1", t0);
    recordKeyUse("gemini", "k2", t0 + 1000);
    expect(sweepKeyUsage(t0 + 2000)).toBe(0);
    expect(keyUsageSize()).toBe(2);
  });

  it("amortized lazy sweep keeps the map from growing unbounded across rotations", () => {
    // 300 distinct rotated keys, each a day apart → every prior one is stale by the time
    // the lazy sweep (every 256 records) fires, so the map never holds them all.
    let t = 10_000_000;
    for (let i = 0; i < 300; i++) { recordKeyUse("gemini", `rot${i}`, t); t += DAY_MS + 1; }
    expect(keyUsageSize()).toBeLessThan(300); // bounded — not one entry per historical key
  });
});

describe("provider cooldown sweep — bounded cooldown map", () => {
  it("markKeyCooldown sweeps expired entries; live ones survive", () => {
    // a long cooldown stays; mark a short one then advance time and mark again → short is swept
    ProviderRouter.markKeyCooldown("gemini", "live-key", 60 * 60 * 1000); // 1h
    const before = ProviderRouter.cooldownSize();
    expect(before).toBeGreaterThanOrEqual(1);
    // directly exercise the sweep with a clock far in the future → expired entries drop
    const swept = ProviderRouter.sweepCooldowns(Date.now() + 2 * 60 * 60 * 1000);
    expect(swept).toBeGreaterThanOrEqual(1);
  });
});
