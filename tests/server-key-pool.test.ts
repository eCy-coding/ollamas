/**
 * Pure-core tests for the sustainable key-pool (P1): per-provider limits + per-key usage
 * windows. Zero IO, injected clock. SECURITY: keyId must never equal the raw key.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { limitFor, pctOfLimit, approaching } from "../server/key-limits";
import { keyId, recordKeyUse, keyWindows, resetKeyUsage, recordCallCost, costSummary } from "../server/key-usage";
import { ProviderRouter } from "../server/providers";
import { db } from "../server/db";

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

describe("key-usage — per-call cost telemetry (D1)", () => {
  beforeEach(() => resetKeyUsage());
  it("accumulates tokens + USD per provider and totals", () => {
    recordCallCost("gemini", 100, 50, 0.002);
    recordCallCost("gemini", 200, 80, 0.003);
    recordCallCost("llamacpp", 300, 120, 0); // local = $0
    const s = costSummary();
    expect(s.totalCalls).toBe(3);
    expect(s.totalTokensIn).toBe(600);
    expect(s.totalTokensOut).toBe(250);
    expect(s.totalUsd).toBeCloseTo(0.005);
    expect(s.perProvider.gemini).toEqual({ calls: 2, tokensIn: 300, tokensOut: 130, usd: 0.005 });
    expect(s.perProvider.llamacpp.usd).toBe(0);
  });
  it("ignores negative/NaN inputs (defensive)", () => {
    recordCallCost("x", -5, NaN, -1);
    expect(costSummary().perProvider.x).toEqual({ calls: 1, tokensIn: 0, tokensOut: 0, usd: 0 });
  });
  it("resetKeyUsage clears cost too", () => {
    recordCallCost("y", 10, 10, 0.1);
    resetKeyUsage();
    expect(costSummary().totalCalls).toBe(0);
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

describe("ProviderRouter P2 — least-loaded selection + saturation", () => {
  // Hermetic: keyPool merges the VAULT (db.data.keys/keyPool) with env keys, so isolate the gemini
  // pool to exactly the env kA/kB — clear any operator-pasted vault gemini keys + extra env slots.
  let savedKey: string | undefined; let savedPool: unknown;
  beforeEach(() => {
    resetKeyUsage();
    for (let i = 1; i <= 9; i++) delete process.env[`GEMINI_API_KEY_${i}`];
    delete process.env.GEMINI_API_KEYS;
    savedKey = db.data.keys["gemini"]; delete db.data.keys["gemini"];
    savedPool = (db.data as any).keyPool?.["gemini"]; if ((db.data as any).keyPool) delete (db.data as any).keyPool["gemini"];
    process.env.GEMINI_API_KEY = "kA"; process.env.GEMINI_API_KEY_2 = "kB";
  });
  afterEach(() => {
    delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY_2;
    if (savedKey !== undefined) db.data.keys["gemini"] = savedKey;
    if (savedPool !== undefined && (db.data as any).keyPool) (db.data as any).keyPool["gemini"] = savedPool;
  });

  it("getDecryptedKey picks the live key with the most headroom", () => {
    const now = Date.now();
    for (let i = 0; i < 18; i++) recordKeyUse("gemini", keyId("kA"), now); // kA at 18/20 = 90%
    expect(ProviderRouter.getDecryptedKey("gemini")).toBe("kB");           // kB has more headroom
  });

  it("poolSaturation.allApproaching when EVERY live key is near its limit", () => {
    const now = Date.now();
    for (let i = 0; i < 16; i++) { recordKeyUse("gemini", keyId("kA"), now); recordKeyUse("gemini", keyId("kB"), now); } // both 16/20 = 80%
    const sat = ProviderRouter.poolSaturation("gemini");
    expect(sat.liveCount).toBe(2);
    expect(sat.allApproaching).toBe(true);
    expect(sat.worstPct).toBeGreaterThanOrEqual(0.8);
  });

  it("not saturated while one key still has headroom", () => {
    const now = Date.now();
    for (let i = 0; i < 19; i++) recordKeyUse("gemini", keyId("kA"), now); // kA saturated, kB fresh
    expect(ProviderRouter.poolSaturation("gemini").allApproaching).toBe(false);
  });
});

describe("ProviderRouter — non-destructive /api/keys/test override", () => {
  beforeEach(() => { resetKeyUsage(); process.env.GEMINI_API_KEY = "kA"; process.env.GEMINI_API_KEY_2 = "kB"; });
  afterEach(() => { ProviderRouter.testKeyOverride = null; delete process.env.GEMINI_API_KEY; delete process.env.GEMINI_API_KEY_2; });

  it("override forces the EXACT candidate key, bypassing least-loaded pool selection", () => {
    const now = Date.now();
    for (let i = 0; i < 18; i++) recordKeyUse("gemini", keyId("kA"), now); // kA loaded → pool would pick kB
    ProviderRouter.testKeyOverride = { provider: "gemini", key: "candidate-XYZ" };
    expect(ProviderRouter.getDecryptedKey("gemini")).toBe("candidate-XYZ"); // tests the pasted key, not kB
  });

  it("override is scoped per provider and leaves others on normal pool selection", () => {
    ProviderRouter.testKeyOverride = { provider: "gemini", key: "candidate-XYZ" };
    expect(ProviderRouter.getDecryptedKey("openai")).not.toBe("candidate-XYZ");
  });

  it("clearing the override restores normal selection (no vault mutation persisted)", () => {
    ProviderRouter.testKeyOverride = { provider: "gemini", key: "candidate-XYZ" };
    ProviderRouter.testKeyOverride = null;
    expect(["kA", "kB"]).toContain(ProviderRouter.getDecryptedKey("gemini")); // back to the env pool
  });
});
