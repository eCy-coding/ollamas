// Faz 4 — persistent quota windows: serialize/restore key-usage buckets (keyId only, never
// raw keys) + provider-specific daily reset boundaries (rolling / utc-midnight / pt-midnight).
import { describe, it, expect, beforeEach } from "vitest";
import {
  bucketsToPersist,
  bucketsFromPersist,
  boundaryFor,
  boundaryStartMs,
} from "../server/quota-persist";
import {
  recordKeyUse,
  keyWindows,
  hydrateKeyUsage,
  keyUsageSnapshot,
  resetKeyUsage,
} from "../server/key-usage";

const DAY = 86_400_000;
const NOW = 1_700_000_000_000;

const bucket = (over: Partial<{ minTs: number; minCount: number; dayTs: number; dayCount: number }> = {}) =>
  ({ minTs: NOW, minCount: 1, dayTs: NOW, dayCount: 5, ...over });

describe("bucketsToPersist / bucketsFromPersist (pure)", () => {
  it("round-trips live buckets and drops day-expired ones on write", () => {
    const entries: Array<[string, any]> = [
      ["groq::abc123", bucket()],
      ["gemini::dead99", bucket({ dayTs: NOW - DAY - 1 })], // expired → dropped
    ];
    const persisted = bucketsToPersist(entries, NOW);
    expect(Object.keys(persisted)).toEqual(["groq::abc123"]);
    const restored = bucketsFromPersist(persisted, NOW);
    expect(restored).toEqual([["groq::abc123", bucket()]]);
  });

  it("fromPersist ignores corrupt/foreign shapes instead of crashing", () => {
    expect(bucketsFromPersist(null, NOW)).toEqual([]);
    expect(bucketsFromPersist("junk", NOW)).toEqual([]);
    expect(bucketsFromPersist({ k: { minTs: "x" } }, NOW)).toEqual([]);
    expect(bucketsFromPersist({ k: 42 }, NOW)).toEqual([]);
  });
});

describe("reset boundaries", () => {
  it("boundaryFor: catalog entries carry their boundary; gemini free tier is pt-midnight; unknown rolls", () => {
    expect(boundaryFor("github-models")).toBe("utc-midnight");
    expect(boundaryFor("groq")).toBe("rolling");
    expect(boundaryFor("gemini")).toBe("pt-midnight");
    expect(boundaryFor("gemini-cli")).toBe("pt-midnight");
    expect(boundaryFor("openai")).toBe("rolling");
  });

  it("boundaryStartMs utc-midnight: start of the UTC day", () => {
    const start = boundaryStartMs("utc-midnight", NOW);
    expect(start).toBe(NOW - (NOW % DAY));
    expect(start).toBeLessThanOrEqual(NOW);
  });

  it("boundaryStartMs pt-midnight: within the last 25h and lands on 00:xx in Los Angeles", () => {
    const start = boundaryStartMs("pt-midnight", NOW);
    expect(start).toBeLessThanOrEqual(NOW);
    expect(NOW - start).toBeLessThan(25 * 3600_000);
    const laHour = new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", hour: "2-digit", hour12: false }).format(new Date(start));
    expect(Number(laHour) % 24).toBe(0);
  });

  it("boundaryStartMs rolling: no boundary (0 → callers use the rolling window)", () => {
    expect(boundaryStartMs("rolling", NOW)).toBe(0);
  });
});

describe("key-usage — boundary-aware windows + hydrate/snapshot", () => {
  beforeEach(() => resetKeyUsage());

  it("utc-midnight provider: counts vanish once the UTC day boundary passes (not 24h later)", () => {
    const beforeMidnight = NOW - (NOW % DAY) + DAY - 60_000; // 23:59 UTC
    recordKeyUse("github-models", "id1", beforeMidnight);
    expect(keyWindows("github-models", "id1", beforeMidnight).perDay).toBe(1);
    const afterMidnight = beforeMidnight + 120_000; // 00:01 UTC next day — only 2 min later
    expect(keyWindows("github-models", "id1", afterMidnight).perDay).toBe(0);
  });

  it("rolling provider keeps counting across a UTC midnight within 24h", () => {
    const beforeMidnight = NOW - (NOW % DAY) + DAY - 60_000;
    recordKeyUse("groq", "id2", beforeMidnight);
    expect(keyWindows("groq", "id2", beforeMidnight + 120_000).perDay).toBe(1);
  });

  it("snapshot → hydrate survives a restart (counts restored, expired dropped)", () => {
    recordKeyUse("groq", "idA", NOW);
    recordKeyUse("groq", "idA", NOW + 1);
    const snap = keyUsageSnapshot(NOW + 2);
    resetKeyUsage(); // "restart"
    expect(keyWindows("groq", "idA", NOW + 3).perDay).toBe(0);
    hydrateKeyUsage(snap, NOW + 3);
    expect(keyWindows("groq", "idA", NOW + 3).perDay).toBe(2);
    // hydrating garbage is a no-op, never a crash
    hydrateKeyUsage("garbage", NOW + 3);
    expect(keyWindows("groq", "idA", NOW + 3).perDay).toBe(2);
  });
});
