import { describe, it, expect } from "vitest";
import {
  PROVIDER_CATALOG,
  catalogEntry,
  catalogBaseUrl,
  keyedCloudProviders,
  trainsOnData,
  type CatalogEntry,
} from "../server/provider-catalog";
import { limitFor } from "../server/key-limits";

const IDS = ["groq", "cerebras", "zai", "sambanova", "nvidia-nim", "github-models", "cloudflare"];

describe("PROVIDER_CATALOG — free-tier cloud providers (zero-dep, OpenAI-compat)", () => {
  it("contains exactly the 7 planned providers, each internally consistent", () => {
    expect(Object.keys(PROVIDER_CATALOG).sort()).toEqual([...IDS].sort());
    for (const id of IDS) {
      const e = PROVIDER_CATALOG[id] as CatalogEntry;
      expect(e.id).toBe(id);
      expect(e.baseUrl).toMatch(/^https:\/\//);
      expect(e.envKey).toMatch(/^[A-Z0-9_]+$/);
      expect(e.defaultModel.length).toBeGreaterThan(0);
      expect(e.maxContext).toBeGreaterThan(0);
      expect(["native", "probe", "none"]).toContain(e.toolCalling);
      expect(typeof e.trainsOnData).toBe("boolean");
    }
  });

  it("envKey names are unique (no two providers share a key slot)", () => {
    const keys = IDS.map((id) => PROVIDER_CATALOG[id].envKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("P0 providers carry real limits (perMin > 0)", () => {
    for (const id of ["groq", "cerebras", "zai"]) {
      expect(PROVIDER_CATALOG[id].limits.perMin).toBeGreaterThan(0);
    }
  });

  it("cerebras free tier is context-capped at 8K (router must respect it)", () => {
    expect(PROVIDER_CATALOG.cerebras.maxContext).toBe(8192);
  });

  it("catalogEntry: known id → entry, unknown/legacy id → undefined", () => {
    expect(catalogEntry("groq")?.envKey).toBe("GROQ_API_KEY");
    expect(catalogEntry("gemini")).toBeUndefined();
    expect(catalogEntry("nope")).toBeUndefined();
  });

  it("catalogBaseUrl: plain providers return their baseUrl verbatim", () => {
    expect(catalogBaseUrl("groq", {} as any)).toBe("https://api.groq.com/openai/v1");
    expect(catalogBaseUrl("zai", {} as any)).toBe("https://api.z.ai/api/paas/v4");
  });

  it("catalogBaseUrl: cloudflare composes the account id from env; missing id → empty (caller errors honestly)", () => {
    expect(catalogBaseUrl("cloudflare", { CLOUDFLARE_ACCOUNT_ID: "abc123" } as any))
      .toBe("https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1");
    expect(catalogBaseUrl("cloudflare", {} as any)).toBe("");
  });

  it("keyedCloudProviders: legacy five first, then every catalog id (order stable, no dupes)", () => {
    const list = keyedCloudProviders();
    expect(list.slice(0, 5)).toEqual(["gemini", "anthropic", "openai", "openrouter", "ollama-cloud"]);
    for (const id of IDS) expect(list).toContain(id);
    expect(new Set(list).size).toBe(list.length);
  });

  it("trainsOnData: gemini free tier flagged true (legacy override); groq/cerebras false; unknown false", () => {
    expect(trainsOnData("gemini")).toBe(true);
    expect(trainsOnData("groq")).toBe(false);
    expect(trainsOnData("cerebras")).toBe(false);
    expect(trainsOnData("unknown-prov")).toBe(false);
  });

  it("key-limits: catalog limits are merged into limitFor defaults (env still overrides)", () => {
    expect(limitFor("groq", {} as any)).toEqual({ perMin: 30, perDay: 1000 });
    expect(limitFor("github-models", {} as any)).toEqual({ perMin: 10, perDay: 50 });
    // env override still wins over the merged catalog default
    expect(limitFor("groq", { KEY_LIMIT_GROQ_PERMIN: "5" } as any).perMin).toBe(5);
    // legacy defaults untouched
    expect(limitFor("gemini", {} as any)).toEqual({ perMin: 20, perDay: 1000 });
  });
});
