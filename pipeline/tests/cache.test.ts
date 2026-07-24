import { describe, it, expect } from "vitest";
import { foldCase, normalize, cacheKey, isFresh, makeEntry, evictExpired, hitRatio, DEFAULT_TTL_SECONDS } from "../lib/cache";

describe("foldCase", () => {
  // The bug this exists to prevent: "İ".toLowerCase() === "i̇" (i + U+0307), so a Turkish
  // query with a capital İ hashes differently from its lowercase twin and misses its own
  // cache entry forever. Measured twice in this repo (orchestra L52, cckb router).
  it("folds Turkish İ/I without the combining dot", () => {
    expect(foldCase("İzin")).toBe("izin");
    expect(foldCase("İzin")).not.toContain("̇");
    expect(foldCase("IŞIK")).toBe("ışık");
    expect(foldCase("ÇĞÜÖŞ")).toBe("çğüöş");
  });

  it("handles nullish input", () => {
    expect(foldCase(undefined as never)).toBe("");
  });
});

describe("normalize", () => {
  it("collapses case and whitespace but nothing else", () => {
    expect(normalize("  Hooks   nasıl  YAZILIR ")).toBe("hooks nasıl yazılır");
  });

  it("keeps distinct questions distinct", () => {
    expect(normalize("mcp ekleme")).not.toBe(normalize("mcp silme"));
  });
});

describe("cacheKey", () => {
  it("is stable across key insertion order", () => {
    expect(cacheKey("think", { a: 1, b: 2 })).toBe(cacheKey("think", { b: 2, a: 1 }));
  });

  it("is stable across insignificant whitespace/case", () => {
    expect(cacheKey("search", { q: "Hooks  Guide" })).toBe(cacheKey("search", { q: "hooks guide" }));
  });

  it("separates actions so think() never collides with analyze()", () => {
    expect(cacheKey("think", { q: "x" })).not.toBe(cacheKey("analyze", { q: "x" }));
    expect(cacheKey("think", { q: "x" }).startsWith("think:")).toBe(true);
  });

  it("separates different payloads", () => {
    expect(cacheKey("search", { q: "a" })).not.toBe(cacheKey("search", { q: "b" }));
  });

  it("handles nested objects and undefined payloads", () => {
    expect(cacheKey("x", { o: { z: 1, a: 2 } })).toBe(cacheKey("x", { o: { a: 2, z: 1 } }));
    expect(cacheKey("x", undefined)).toMatch(/^x:[0-9a-f]{32}$/);
  });
});

describe("isFresh", () => {
  const now = 1_000_000;

  it("is fresh inside the TTL and stale past it", () => {
    const e = makeEntry("k", 1, now, 60);
    expect(isFresh(e, now + 59_000)).toBe(true);
    expect(isFresh(e, now + 60_000)).toBe(false);
  });

  it("treats a zero/negative TTL as never-cache", () => {
    expect(isFresh(makeEntry("k", 1, now, 0), now)).toBe(false);
    expect(isFresh(makeEntry("k", 1, now, -5), now)).toBe(false);
  });

  it("rejects a malformed entry rather than trusting it", () => {
    expect(isFresh(undefined as never, now)).toBe(false);
    expect(isFresh({ key: "k", value: 1, storedAt: NaN, ttlSeconds: 60 }, now)).toBe(false);
  });

  it("defaults to the prompt's 24 h TTL", () => {
    expect(makeEntry("k", 1, now).ttlSeconds).toBe(DEFAULT_TTL_SECONDS);
    expect(DEFAULT_TTL_SECONDS).toBe(86_400);
  });
});

describe("evictExpired", () => {
  it("keeps fresh entries and drops stale ones without mutating the input", () => {
    const now = 1_000_000;
    const store = new Map([
      ["a", makeEntry("a", 1, now, 60)],
      ["b", makeEntry("b", 2, now - 120_000, 60)],
    ]);
    const out = evictExpired(store, now);
    expect([...out.keys()]).toEqual(["a"]);
    expect(store.size).toBe(2);
  });
});

describe("hitRatio", () => {
  it("is 0 with no traffic and exact otherwise", () => {
    expect(hitRatio({ hits: 0, misses: 0 })).toBe(0);
    expect(hitRatio({ hits: 3, misses: 1 })).toBe(0.75);
  });
});
