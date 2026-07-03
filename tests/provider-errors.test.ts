// Faz 3 — 429 Retry-After honoring + short failure cooldown (LiteLLM 30s pattern).
// Pure parts (parseRetryAfter, quotaCooldownTtl) tested directly; the router integration
// asserts a 429'd key actually lands in cooldown via the public pool-status surface.
import { describe, it, expect, vi, afterEach } from "vitest";
import { parseRetryAfter, quotaCooldownTtl, ProviderHttpError } from "../server/provider-errors";
import { ProviderRouter, type GenerateConfig } from "../server/providers";

const NOW = 1_700_000_000_000;

describe("parseRetryAfter (pure)", () => {
  it("delta-seconds form → ms", () => {
    expect(parseRetryAfter("120", NOW)).toBe(120_000);
    expect(parseRetryAfter("0", NOW)).toBe(0);
  });
  it("HTTP-date form → remaining ms (clamped at 0 for past dates)", () => {
    expect(parseRetryAfter(new Date(NOW + 30_000).toUTCString(), NOW)).toBeLessThanOrEqual(30_000);
    expect(parseRetryAfter(new Date(NOW + 30_000).toUTCString(), NOW)).toBeGreaterThan(28_000);
    expect(parseRetryAfter(new Date(NOW - 5_000).toUTCString(), NOW)).toBe(0);
  });
  it("absent/garbage → undefined", () => {
    expect(parseRetryAfter(null, NOW)).toBeUndefined();
    expect(parseRetryAfter("", NOW)).toBeUndefined();
    expect(parseRetryAfter("soonish", NOW)).toBeUndefined();
    expect(parseRetryAfter("-5", NOW)).toBeUndefined();
  });
});

describe("quotaCooldownTtl (pure)", () => {
  it("quota with Retry-After → server's number wins; without → 6h default", () => {
    expect(quotaCooldownTtl(true, 45_000)).toBe(45_000);
    expect(quotaCooldownTtl(true, undefined)).toBe(6 * 3600_000);
  });
  it("auth failure → 24h regardless of Retry-After", () => {
    expect(quotaCooldownTtl(false, 45_000)).toBe(24 * 3600_000);
    expect(quotaCooldownTtl(false, undefined)).toBe(24 * 3600_000);
  });
  it("zero Retry-After coalesces to the 6h default (0 would be an instant retry loop)", () => {
    expect(quotaCooldownTtl(true, 0)).toBe(6 * 3600_000);
  });
});

describe("ProviderHttpError", () => {
  it("keeps the status digits in the message (router string-match compatibility)", () => {
    const e = new ProviderHttpError("OpenAI-compatible host returned error 429", 429, 5_000);
    expect(e.message).toContain("429");
    expect(e.status).toBe(429);
    expect(e.retryAfterMs).toBe(5_000);
    expect(e).toBeInstanceOf(Error);
  });
});

describe("router integration — 429 with Retry-After cools the spent key", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("catalog provider 429 → the SPENT key leaves the live pool (singleAttempt surfaces the error)", async () => {
    vi.stubEnv("GROQ_API_KEY", "gsk_429_test");
    // Deterministic baseline: cooldowns persist across runs and the 7s Retry-After from a
    // PRIOR run can still be live — sweep everything as-if far in the future first, then
    // assert relatively (the operator's real vault may hold live groq keys; only the spent
    // stub must cool). Machine-state- and timing-independent.
    ProviderRouter.sweepCooldowns(Date.now() + 24 * 3600_000);
    const before = ProviderRouter.keyPoolStatus("groq").live;
    vi.stubGlobal("fetch", vi.fn(async () =>
      new Response("rate limited", { status: 429, headers: { "retry-after": "7" } })));
    const config: GenerateConfig = {
      provider: "groq", model: "", messages: [{ role: "user", content: "hi" }], singleAttempt: true,
    };
    await expect(ProviderRouter.generate(config)).rejects.toThrow(/429/);
    expect(ProviderRouter.keyPoolStatus("groq").live).toBe(before - 1); // cooled by Retry-After
  });
});

describe("key-test override — candidate key for a NEW provider (no stored key)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    ProviderRouter.testKeyOverride = null;
  });

  it("hasKey honors testKeyOverride: the candidate reaches the real endpoint and its 401 surfaces", async () => {
    // NO groq key anywhere (env/vault) — only the scoped override, as /api/keys/test sets it.
    ProviderRouter.testKeyOverride = { provider: "groq", key: "candidate-bogus" };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("unauthorized", { status: 401 })));
    const config: GenerateConfig = {
      provider: "groq", model: "", messages: [{ role: "user", content: "ping test" }], singleAttempt: true,
    };
    // Before the fix this rejected with "No usable provider found." (key gate skipped groq).
    await expect(ProviderRouter.generate(config)).rejects.toThrow(/401/);
  });
});
