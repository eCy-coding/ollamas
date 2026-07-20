// T9-F4 — Scaleway (keyed, 1M tok, no-train, EU) + Pollinations (keyless, per-IP → true 0-manual)
// join the free-tier catalog. Data-only additions the OpenAI-compat router drives automatically.
import { describe, it, expect } from "vitest";
import { PROVIDER_CATALOG, catalogEntry, capabilitiesFor, keyedCloudProviders } from "../server/provider-catalog";
import { ProviderRouter } from "../server/providers";

describe("catalog: new free providers (T9-F4)", () => {
  it("scaleway is a keyed OpenAI-compat entry with a real free quota", () => {
    const e = catalogEntry("scaleway")!;
    expect(e.baseUrl).toBe("https://api.scaleway.ai/v1");
    expect(e.envKey).toBe("SCALEWAY_API_KEY");
    expect(e.trainsOnData).toBe(false);
    expect(e.limits.tokensPerDay).toBeGreaterThan(0);
    expect(e.keyless).toBeFalsy();
  });

  it("pollinations is keyless (reachable with no key → 0-manual)", () => {
    const e = catalogEntry("pollinations")!;
    // text host = the anonymous-capable endpoint (gen.pollinations.ai 401s keyless traffic).
    expect(e.baseUrl).toBe("https://text.pollinations.ai/v1");
    expect(e.keyless).toBe(true);
  });

  it("every catalog entry keeps a unique envKey", () => {
    const envKeys = Object.values(PROVIDER_CATALOG).map((e) => e.envKey);
    expect(new Set(envKeys).size).toBe(envKeys.length);
  });

  it("new providers carry orchestra capabilities", () => {
    expect(capabilitiesFor("scaleway").length).toBeGreaterThan(0);
    expect(capabilitiesFor("pollinations").length).toBeGreaterThan(0);
  });

  it("both join the fallback chain (catalog-driven, no hardcoding)", () => {
    expect(keyedCloudProviders()).toContain("scaleway");
    const chain = ProviderRouter.getFallbackChain("groq");
    expect(chain).toContain("pollinations");
    expect(chain).toContain("scaleway");
    // the keyless local terminal is still the floor
    expect(chain).toContain("ollama-local");
  });
});

describe("catalog: perplexity — live web-search-grounded chat, no bespoke code needed", () => {
  it("is a keyed OpenAI-compat entry pointed at the real Perplexity API root", () => {
    const e = catalogEntry("perplexity")!;
    expect(e.baseUrl).toBe("https://api.perplexity.ai");
    expect(e.envKey).toBe("PERPLEXITY_API_KEY");
    expect(e.defaultModel).toBe("sonar");
    expect(e.trainsOnData).toBe(false);
    expect(e.keyless).toBeFalsy();
  });

  it("carries orchestra capabilities and a unique envKey", () => {
    expect(capabilitiesFor("perplexity").length).toBeGreaterThan(0);
    const envKeys = Object.values(PROVIDER_CATALOG).map((e) => e.envKey);
    expect(envKeys.filter((k) => k === "PERPLEXITY_API_KEY").length).toBe(1);
  });

  it("joins the generic catalog fallback chain (main ollamas chat path)", () => {
    expect(keyedCloudProviders()).toContain("perplexity");
    expect(ProviderRouter.getFallbackChain("groq")).toContain("perplexity");
  });
});
