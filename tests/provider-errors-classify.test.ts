import { describe, it, expect } from "vitest";
import { classifyKeyError, quotaCooldownTtl, FAILURE_COOLDOWN_MS, ProviderHttpError } from "../server/provider-errors";

// MATH §7 — key-autonomy cooldown classification. The whole point is that a TYPED status wins over message
// substrings, so a healthy key is never parked 6h because a 5xx body happened to contain "exceeded".
describe("classifyKeyError — typed status precedence over message substrings", () => {
  it("typed 429 → quota, 401/403 → auth", () => {
    expect(classifyKeyError(new ProviderHttpError("x", 429))).toBe("quota");
    expect(classifyKeyError(new ProviderHttpError("x", 401))).toBe("auth");
    expect(classifyKeyError(new ProviderHttpError("x", 403))).toBe("auth");
  });

  it("typed 5xx/400 → generic EVEN IF the message contains quota-ish words (no 6h mis-park)", () => {
    expect(classifyKeyError(new ProviderHttpError("context length exceeded", 500))).toBe("generic");
    expect(classifyKeyError(new ProviderHttpError("rate limit note", 503))).toBe("generic");
    expect(classifyKeyError(new ProviderHttpError("bad request", 400))).toBe("generic");
  });

  it("untyped (network) errors fall back to message heuristics", () => {
    expect(classifyKeyError(new Error("HTTP 429 Too Many Requests"))).toBe("quota");
    expect(classifyKeyError(new Error("quota exceeded"))).toBe("quota");
    expect(classifyKeyError(new Error("401 unauthorized"))).toBe("auth");
    expect(classifyKeyError(new Error("ECONNRESET socket hang up"))).toBe("generic");
    expect(classifyKeyError(undefined)).toBe("generic");
  });
});

describe("quotaCooldownTtl — monotone + bounded (30s ≤ TTL ≤ 24h)", () => {
  it("generic (non-quota) via auth path benches 24h; quota honors Retry-After else 6h", () => {
    expect(quotaCooldownTtl(false)).toBe(24 * 3600_000);              // auth
    expect(quotaCooldownTtl(true)).toBe(6 * 3600_000);               // quota, no Retry-After
    expect(quotaCooldownTtl(true, 90_000)).toBe(90_000);            // quota honors Retry-After
    expect(quotaCooldownTtl(true, 0)).toBe(6 * 3600_000);          // Retry-After 0 → default (no instant re-hit)
  });
  it("a generic failure benches only 30s (short self-heal, not a quota park)", () => {
    expect(FAILURE_COOLDOWN_MS).toBe(30_000);
  });
});
