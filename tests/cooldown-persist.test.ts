/**
 * API-key cooldown PERSISTENCE (sustainable pool): cooldown timers survive a restart so an invalid
 * key stays benched 24h / a quota-exhausted key stays benched 6h across deploys/crashes/reboots.
 * SECURITY: persisted keys are keyId() hashes, never raw key values.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { ProviderRouter, cooldownToPersist, cooldownFromPersist } from "../server/providers";
import { keyId } from "../server/key-usage";
import { db } from "../server/db";

describe("cooldownToPersist (pure)", () => {
  it("drops expired, keeps future", () => {
    const now = 1_000_000;
    expect(cooldownToPersist([["a", now + 5000], ["b", now - 1], ["c", now]], now)).toEqual({ a: now + 5000 });
  });
  it("empty in → empty out", () => {
    expect(cooldownToPersist([], 1)).toEqual({});
  });
});

describe("cooldownFromPersist (pure)", () => {
  it("keeps numeric future expiries, ignores past / non-number / malformed", () => {
    const now = 1_000_000;
    const got = cooldownFromPersist({ a: now + 9, b: now - 9, c: "soon", d: null, e: NaN, f: Infinity }, now);
    expect(got).toEqual([["a", now + 9]]);
  });
  it("non-object → []", () => {
    expect(cooldownFromPersist(null, 1)).toEqual([]);
    expect(cooldownFromPersist("x", 1)).toEqual([]);
  });
});

describe("ProviderRouter cooldown persistence (round-trip = survives restart)", () => {
  let savedCooldowns: unknown;
  beforeEach(() => {
    vi.spyOn(db, "save").mockImplementation(() => {}); // no real disk write in tests
    savedCooldowns = (db.data as any).keyCooldowns;
    (db.data as any).keyCooldowns = {};
  });
  afterEach(() => {
    vi.restoreAllMocks();
    (db.data as any).keyCooldowns = savedCooldowns;
  });

  it("SECURITY: persisted cooldown key is the keyId hash, never the raw key", () => {
    ProviderRouter.markKeyCooldown("gemini", "sk-secret-RAW", 6 * 3600_000);
    const persisted = (db.data as any).keyCooldowns as Record<string, number>;
    const serialized = JSON.stringify(persisted);
    expect(serialized).not.toContain("sk-secret-RAW");
    expect(serialized).not.toContain("secret");
    expect(Object.keys(persisted)).toContain(`gemini::${keyId("sk-secret-RAW")}`);
  });

  it("markKeyCooldown persists a future expiry that a fresh boot would restore", () => {
    const before = Date.now();
    ProviderRouter.markKeyCooldown("openai", "kZ", 24 * 3600_000);
    const persisted = (db.data as any).keyCooldowns as Record<string, number>;
    const cooldownKey = `openai::${keyId("kZ")}`;
    expect(persisted[cooldownKey]).toBeGreaterThan(before + 23 * 3600_000);

    // Simulate a fresh boot: the hydrate path reads exactly this object back.
    const restored = cooldownFromPersist(persisted, Date.now());
    expect(restored.find(([k]) => k === cooldownKey)?.[1]).toBe(persisted[cooldownKey]);
  });
});
