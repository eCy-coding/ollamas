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
