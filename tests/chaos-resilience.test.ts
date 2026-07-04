// T9-F3 — Chaos/QA resilience suite. Proves the autonomous zero-downtime invariants against the
// REAL router surfaces (cooldown map, fallback chain, health snapshot) — no network, deterministic:
//   1. a 429'd key is isolated INSTANTLY (no sleep) via cooldown,
//   2. the cooldown honors the server's Retry-After,
//   3. the key auto-recovers the moment its cooldown expires (sweep),
//   4. the heal loop re-sweeps right after the nearest expiry (expiry-aware),
//   5. the local-Ollama terminal tier is ALWAYS in the fallback chain (the zero-downtime floor),
//   6. all-cloud-cooled raises the escalation flag while the terminal tier still serves.
import { describe, it, expect, beforeEach } from "vitest";
import { ProviderRouter } from "../server/providers";
import { quotaCooldownTtl } from "../server/provider-errors";
import { nextTickDelay, cheapHealthFromPool } from "../server/key-health";

const P = "chaos-prov"; // synthetic provider — never collides with a real vault pool
const NOW = 1_700_000_000_000;

// The router lazily hydrates persisted cooldowns from the real vault on first access, so assertions
// are DELTA-based against a pre-hydrated baseline (never absolute counts / a global-empty map).
beforeEach(() => {
  ProviderRouter.nextCooldownExpiry(Date.now()); // forces lazy hydration from the vault
  ProviderRouter.sweepCooldowns(Date.now()); // drop expired so the baseline is stable
});

describe("chaos: a 429'd key is isolated instantly (no downtime)", () => {
  it("markKeyCooldown removes the key from the live set immediately + records the expiry", () => {
    const before = ProviderRouter.cooldownSize();
    ProviderRouter.markKeyCooldown(P, "key-a", 30_000); // 429 → cool for 30s
    expect(ProviderRouter.cooldownSize()).toBe(before + 1); // instant, synchronous
    const exp = ProviderRouter.nextCooldownExpiry();
    expect(exp).not.toBeNull();
    expect(exp!).toBeGreaterThan(Date.now()); // a concrete recovery time is known
  });
});

describe("chaos: cooldown honors the server Retry-After", () => {
  it("a 429 with Retry-After cools for exactly that long; without → 6h; auth → 24h", () => {
    expect(quotaCooldownTtl(true, 45_000)).toBe(45_000);
    expect(quotaCooldownTtl(true, undefined)).toBe(6 * 3600_000);
    expect(quotaCooldownTtl(false, 45_000)).toBe(24 * 3600_000); // auth failure ignores Retry-After
  });
});

describe("chaos: a recovered key rejoins the moment its cooldown expires", () => {
  it("sweepCooldowns removes nothing before expiry, evicts the key after", () => {
    ProviderRouter.markKeyCooldown(P, "key-b", 30_000); // recovers in 30s
    const sizeAfterMark = ProviderRouter.cooldownSize();
    // Before expiry: my key is still cooled (size unchanged by a sweep at write-time).
    ProviderRouter.sweepCooldowns(Date.now());
    expect(ProviderRouter.cooldownSize()).toBe(sizeAfterMark);
    // After my expiry: swept back into the live pool with zero operator action (delta ≥ 1).
    const removedLate = ProviderRouter.sweepCooldowns(Date.now() + 31_000);
    expect(removedLate).toBeGreaterThanOrEqual(1);
    expect(ProviderRouter.cooldownSize()).toBeLessThan(sizeAfterMark);
  });
});

describe("chaos: the heal loop re-sweeps right after the nearest expiry (F2 integration)", () => {
  it("nextTickDelay uses the real cooldown expiry instead of the 15-min steady state", () => {
    ProviderRouter.markKeyCooldown(P, "key-c", 20_000); // recovers in 20s
    const now = Date.now();
    const delay = nextTickDelay(ProviderRouter.nextCooldownExpiry(now), 900_000, now);
    expect(delay).toBeLessThan(21_000); // seconds, not 15 min
    expect(delay).toBeGreaterThan(15_000);
  });
});

describe("chaos: the local-Ollama terminal tier is the zero-downtime floor", () => {
  it("every fallback chain contains ollama-local (keyless, always-reachable)", () => {
    for (const start of ["groq", "cerebras", "cloudflare", "gemini", "openrouter"]) {
      expect(ProviderRouter.getFallbackChain(start)).toContain("ollama-local");
    }
  });
});

describe("chaos: all cloud keys cooled → escalation flag, terminal tier still serves", () => {
  it("cheapHealthFromPool flags allCloudCooled when every keyed provider is cooled", () => {
    const snap = cheapHealthFromPool(
      ["groq", "cerebras", "cloudflare"],
      () => ({ total: 1, live: 0 }), // every keyed provider fully cooled
      () => false,
      () => "https://example.com/key",
      NOW,
    );
    expect(snap.allCloudCooled).toBe(true);
    expect(snap.live).toBe(0);
    // The chain still routes to the keyless local terminal → the box never stops serving.
    expect(ProviderRouter.getFallbackChain("groq")).toContain("ollama-local");
  });
});
