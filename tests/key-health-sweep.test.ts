// T9-F2 — expiry-aware heal scheduling + all-cloud-cooled escalation. Pure functions, no IO.
import { describe, it, expect } from "vitest";
import { nextTickDelay, cheapHealthFromPool } from "../server/key-health";

describe("nextTickDelay — expiry-aware sweep (T9-F2)", () => {
  const base = 900_000; // 15 min steady state
  const now = 1_000_000;

  it("uses the steady-state base when nothing is cooled", () => {
    expect(nextTickDelay(null, base, now)).toBe(base);
  });

  it("schedules right after a cooldown that expires before the base window", () => {
    const expiry = now + 30_000; // recovers in 30s
    const delay = nextTickDelay(expiry, base, now);
    expect(delay).toBeGreaterThan(30_000);
    expect(delay).toBeLessThan(31_000); // ~30s + small ε, not the full 15 min
  });

  it("keeps the base when the nearest expiry is beyond the base window", () => {
    expect(nextTickDelay(now + base + 60_000, base, now)).toBe(base);
  });

  it("never schedules below the min-floor (no hot loop on an already-lapsed cooldown)", () => {
    expect(nextTickDelay(now - 5_000, base, now, 1_000)).toBe(1_000);
  });
});

describe("cheapHealthFromPool — allCloudCooled escalation (T9-F2)", () => {
  const signup = () => "https://example.com/key";

  it("flags allCloudCooled when every keyed provider is cooled/absent", () => {
    const snap = cheapHealthFromPool(
      ["groq", "cerebras"],
      (p) => (p === "groq" ? { total: 2, live: 0 } : { total: 1, live: 0 }), // all cooled
      () => false, // keyed
      signup,
      1,
    );
    expect(snap.allCloudCooled).toBe(true);
    expect(snap.live).toBe(0);
  });

  it("does NOT flag when at least one keyed provider is live", () => {
    const snap = cheapHealthFromPool(
      ["groq", "cerebras"],
      (p) => (p === "groq" ? { total: 2, live: 1 } : { total: 1, live: 0 }),
      () => false,
      signup,
      1,
    );
    expect(snap.allCloudCooled).toBe(false);
  });

  it("does NOT flag when a keyless provider carries the load", () => {
    const snap = cheapHealthFromPool(
      ["github-models"],
      () => ({ total: 0, live: 0 }),
      () => true, // keyless → live regardless of pool
      signup,
      1,
    );
    expect(snap.allCloudCooled).toBe(false); // no keyed providers → not an escalation
  });
});

describe("cheapHealthFromPool — cooldown-recovery visibility (T10-F1)", () => {
  const signup = () => "https://example.com/key";
  it("stamps cooledUntilMs on a cooled provider from the injected expiry", () => {
    const snap = cheapHealthFromPool(
      ["groq"],
      () => ({ total: 1, live: 0 }), // cooled
      () => false,
      signup,
      1000,
      (p) => (p === "groq" ? 999_000 : null),
    );
    const row = snap.providers.find((r) => r.provider === "groq")!;
    expect(row.status).toBe("cooled");
    expect(row.cooledUntilMs).toBe(999_000);
  });
  it("leaves cooledUntilMs undefined for a live provider", () => {
    const snap = cheapHealthFromPool(
      ["groq"],
      () => ({ total: 1, live: 1 }), // live
      () => false,
      signup,
      1000,
      () => 999_000,
    );
    expect(snap.providers[0]!.cooledUntilMs).toBeUndefined();
  });
});
