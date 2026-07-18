import { describe, it, expect } from "vitest";
import { ProviderRouter } from "../server/providers";

const order = (ProviderRouter as any).orderRestByLatency.bind(ProviderRouter);
const REST = ["fleet", "ollama-local", "openrouter", "gemini", "gemini-cli", "openai", "ollama-cloud", "demo"];

describe("orderRestByLatency (vNext T2.2 — constraint-safe cloud-tier ordering)", () => {
  it("no fresh latency (-1) → original order preserved (zero cold-start change)", () => {
    expect(order(REST, () => -1)).toEqual(REST);
  });

  it("$0 local stays first, demo last, regardless of cloud latencies", () => {
    const out = order(REST, (p: string) => ({ openai: 100, gemini: 50, openrouter: 200, "ollama-cloud": 10 }[p] ?? -1));
    expect(out[0]).toBe("fleet");
    expect(out[1]).toBe("ollama-local");
    expect(out[out.length - 1]).toBe("demo");
  });

  it("cloud tier sorts fastest-first", () => {
    const lat = (p: string) => ({ "ollama-cloud": 10, gemini: 50, openai: 100, openrouter: 200 }[p] ?? -1);
    const out = order(REST, lat).filter((p: string) => !["fleet", "ollama-local", "demo"].includes(p));
    // ollama-cloud(10) < gemini(50) < ... ; gemini-cli (unmeasured) pinned after gemini
    expect(out[0]).toBe("ollama-cloud");
    expect(out.indexOf("gemini-cli")).toBe(out.indexOf("gemini") + 1); // family adjacent
  });

  it("gemini family stays adjacent even when latencies would separate them", () => {
    // gemini fast (5ms), gemini-cli slow (900ms) → naive sort separates; must re-pin adjacent
    const out = order(REST, (p: string) => ({ gemini: 5, "gemini-cli": 900, openai: 50 }[p] ?? -1));
    expect(out.indexOf("gemini-cli")).toBe(out.indexOf("gemini") + 1);
  });
});

describe("orderRestByLatency — v15 buddy health penalty (proactive demotion)", () => {
  const R = ["fleet", "ollama-local", "openrouter", "gemini", "openai", "demo"];
  it("a saturated buddy sinks BELOW a healthy one even if faster", () => {
    // openai fast(10) but saturated(1); openrouter slow(500) but healthy(0) → healthy wins
    const lat = (p: string) => ({ openai: 10, openrouter: 500, gemini: 100 }[p] ?? -1);
    const pen = (p: string) => (p === "openai" ? 1 : 0);
    const out = order(R, lat, pen).filter((p: string) => !["fleet", "ollama-local", "demo"].includes(p));
    expect(out.indexOf("openrouter")).toBeLessThan(out.indexOf("openai"));
  });
  it("a fully-cooled buddy (penalty 2) sinks to the bottom of the cloud tier", () => {
    const lat = () => 50;
    const pen = (p: string) => (p === "gemini" ? 2 : p === "openai" ? 1 : 0);
    const cloud = order(R, lat, pen).filter((p: string) => !["fleet", "ollama-local", "demo"].includes(p));
    expect(cloud[cloud.length - 1]).toBe("gemini");   // cooled last
    expect(cloud.indexOf("openai")).toBeGreaterThan(cloud.indexOf("openrouter")); // saturated below healthy
  });
  it("invariants hold under penalties: $0 local first, demo last", () => {
    const out = order(R, () => 50, (p: string) => (p === "openai" ? 2 : 0));
    expect(out[0]).toBe("fleet");
    expect(out[1]).toBe("ollama-local");
    expect(out[out.length - 1]).toBe("demo");
  });
});
