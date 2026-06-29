import { describe, it, expect, afterEach } from "vitest";
import { ProviderRouter } from "../server/providers";

// CRITICAL-2: demo honesty. The demo provider may serve an EXPLICIT request, but must
// NOT be returned silently as a CHAIN FALLBACK in live mode (would feed fabricated text
// to the live agent as if real). The guard is `shouldSkipDemoFallback`; server.ts sets
// `demoFallbackAllowed = (CURRENT_MODE === "demo")` at boot.
describe("demo-fallback honesty guard", () => {
  const orig = ProviderRouter.demoFallbackAllowed;
  afterEach(() => { ProviderRouter.demoFallbackAllowed = orig; });

  it("live mode (allowed=false): demo reached as fallback is SKIPPED", () => {
    ProviderRouter.demoFallbackAllowed = false;
    expect(ProviderRouter.shouldSkipDemoFallback("demo", "gemini")).toBe(true);
    expect(ProviderRouter.shouldSkipDemoFallback("demo", undefined as any)).toBe(true);
  });

  it("explicit provider:'demo' is NEVER skipped (even in live mode)", () => {
    ProviderRouter.demoFallbackAllowed = false;
    expect(ProviderRouter.shouldSkipDemoFallback("demo", "demo")).toBe(false);
  });

  it("demo mode (allowed=true): demo fallback permitted", () => {
    ProviderRouter.demoFallbackAllowed = true;
    expect(ProviderRouter.shouldSkipDemoFallback("demo", "gemini")).toBe(false);
  });

  it("real providers are never skipped by this guard", () => {
    ProviderRouter.demoFallbackAllowed = false;
    for (const p of ["ollama-local", "gemini", "openai", "openrouter", "ollama-cloud"]) {
      expect(ProviderRouter.shouldSkipDemoFallback(p, "gemini")).toBe(false);
    }
  });

  it("explicit provider:'demo' still returns demo output (guard does not break it)", async () => {
    ProviderRouter.demoFallbackAllowed = false; // even with fallback disabled
    const r = await ProviderRouter.generate({ provider: "demo", model: "m", messages: [] } as any);
    expect(r.source).toBe("demo");
    expect(typeof r.text).toBe("string");
    expect(r.text.length).toBeGreaterThan(0);
  });
});

// Sustainable gemini: when the gemini API-key pool exhausts, the chain must self-sustain on the
// keyless gemini-cli OAuth binary (same Gemini family) BEFORE dropping to local/other (vK-LIVE-4).
describe("gemini self-sustains via the keyless gemini-cli fallback", () => {
  it("the gemini chain tries gemini-cli right after gemini, before local/other/demo", () => {
    const chain = ProviderRouter.getFallbackChain("gemini");
    expect(chain[0]).toBe("gemini");
    expect(chain[1]).toBe("gemini-cli");
    // and it precedes the local/other fallbacks
    expect(chain.indexOf("gemini-cli")).toBeLessThan(chain.indexOf("ollama-local"));
    expect(chain.indexOf("gemini-cli")).toBeLessThan(chain.indexOf("demo"));
  });

  it("gemini-cli is present in every provider's chain (keyless universal fallback)", () => {
    for (const p of ["openai", "openrouter", "ollama-local"]) {
      expect(ProviderRouter.getFallbackChain(p)).toContain("gemini-cli");
    }
  });
});
