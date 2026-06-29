/**
 * Pure-core tests for the sustainable key-pool (P1): per-provider limits + per-key usage
 * windows. Zero IO, injected clock. SECURITY: keyId must never equal the raw key.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { limitFor, pctOfLimit, approaching } from "../server/key-limits";
import { keyId, recordKeyUse, keyWindows, resetKeyUsage } from "../server/key-usage";

describe("key-limits", () => {
  it("known defaults; env override; unknown → unlimited", () => {
    expect(limitFor("gemini", {} as any)).toEqual({ perMin: 20, perDay: 1000 });
    expect(limitFor("gemini", { KEY_LIMIT_GEMINI_PERMIN: "5" } as any).perMin).toBe(5);
    expect(limitFor("mystery", {} as any)).toEqual({ perMin: 0, perDay: 0 });
  });
  it("pctOfLimit = tightest active fraction; unlimited → 0", () => {
    expect(pctOfLimit({ perMin: 10, perDay: 100 }, { perMin: 20, perDay: 1000 })).toBeCloseTo(0.5); // 10/20 > 100/1000
    expect(pctOfLimit({ perMin: 5, perDay: 900 }, { perMin: 20, perDay: 1000 })).toBeCloseTo(0.9);  // 900/1000
    expect(pctOfLimit({ perMin: 999, perDay: 999 }, { perMin: 0, perDay: 0 })).toBe(0);             // unlimited
  });
  it("approaching at the threshold", () => {
    expect(approaching(0.8)).toBe(true);
    expect(approaching(0.79)).toBe(false);
    expect(approaching(0.5, 0.5)).toBe(true);
  });
});

describe("key-usage", () => {
  beforeEach(() => resetKeyUsage());
  it("keyId is a stable non-reversible prefix (never the raw key)", () => {
    const id = keyId("sk-secret-abc");
    expect(id).toHaveLength(12);
    expect(id).not.toContain("secret");
    expect(keyId("sk-secret-abc")).toBe(id);           // stable
    expect(keyId("other")).not.toBe(id);                // distinct
  });
  it("counts increment per use", () => {
    const id = keyId("k");
    recordKeyUse("gemini", id, 1000);
    recordKeyUse("gemini", id, 1500);
    expect(keyWindows("gemini", id, 1600)).toEqual({ perMin: 2, perDay: 2 });
  });
  it("per-minute window rolls over; per-day persists", () => {
    const id = keyId("k");
    recordKeyUse("gemini", id, 0);
    recordKeyUse("gemini", id, 1000);
    // 61s later: a new use rolls the minute bucket (count=1) but the day keeps accumulating.
    recordKeyUse("gemini", id, 61_000);
    const w = keyWindows("gemini", id, 61_500);
    expect(w.perMin).toBe(1);
    expect(w.perDay).toBe(3);
  });
  it("unknown key → zero, never throws", () => {
    expect(keyWindows("gemini", "nope")).toEqual({ perMin: 0, perDay: 0 });
  });
});
