// Faz 5 — privacy / context-cap / tool-capability chain filtering (pure) + the passive
// tool-support cache. ollama-local/fleet/demo are terminal tiers and never filtered out.
import { describe, it, expect, beforeEach } from "vitest";
import { filterChain } from "../server/chain-policy";
import {
  getToolSupport,
  setToolSupport,
  toolSupportSnapshot,
  hydrateToolSupport,
  resetToolSupport,
} from "../server/capability-cache";
import { ProviderRouter } from "../server/providers";

const CHAIN = ["gemini", "fleet", "ollama-local", "groq", "cerebras", "zai", "openai", "demo"];

describe("filterChain (pure)", () => {
  beforeEach(() => resetToolSupport());

  it("no constraints → chain unchanged", () => {
    expect(filterChain(CHAIN, {})).toEqual(CHAIN);
  });

  it("privateMode drops training providers (gemini free tier) but never local tiers", () => {
    const out = filterChain(CHAIN, { privateMode: true });
    expect(out).not.toContain("gemini");
    expect(out).toContain("groq"); // no-training
    expect(out).toContain("ollama-local");
    expect(out).toContain("demo");
  });

  it("context cap: a prompt beyond cerebras' 8K free cap drops cerebras, keeps big-context providers", () => {
    const out = filterChain(CHAIN, { estTokensIn: 20_000 });
    expect(out).not.toContain("cerebras"); // 8192 cap
    expect(out).toContain("zai"); // 200K
    expect(out).toContain("ollama-local"); // local exempt
    expect(out).toContain("openai"); // legacy (no catalog cap) kept
  });

  it("needTools: toolCalling 'none' or cached-false drops; 'probe' unknown stays (optimistic)", () => {
    setToolSupport("zai", "", false); // learned failure
    const out = filterChain(CHAIN, { needTools: true });
    expect(out).not.toContain("zai");
    expect(out).toContain("groq"); // native
    expect(out).toContain("cerebras"); // probe + unknown → optimistic keep
  });

  it("terminal tiers survive even when every filter fires", () => {
    const out = filterChain(CHAIN, { privateMode: true, needTools: true, estTokensIn: 500_000 });
    expect(out).toContain("fleet");
    expect(out).toContain("ollama-local");
    expect(out).toContain("demo");
  });
});

describe("capability-cache (passive tool-support learning)", () => {
  beforeEach(() => resetToolSupport());

  it("unknown → undefined; set → get; snapshot/hydrate round-trip", () => {
    expect(getToolSupport("groq", "m1")).toBeUndefined();
    setToolSupport("groq", "m1", true);
    setToolSupport("zai", "m2", false);
    expect(getToolSupport("groq", "m1")).toBe(true);
    const snap = toolSupportSnapshot();
    resetToolSupport();
    expect(getToolSupport("zai", "m2")).toBeUndefined();
    hydrateToolSupport(snap);
    expect(getToolSupport("zai", "m2")).toBe(false);
    hydrateToolSupport("garbage"); // never crashes
    expect(getToolSupport("groq", "m1")).toBe(true);
  });
});

describe("ProviderRouter.effectiveChain — generate()'s actual provider list", () => {
  it("privateMode request never reaches a training provider; singleAttempt bypasses filtering", () => {
    const chain = ProviderRouter.effectiveChain({
      provider: "gemini", model: "", privateMode: true,
      messages: [{ role: "user", content: "secret prompt" }],
    });
    expect(chain).not.toContain("gemini");
    expect(chain).not.toContain("gemini-cli");
    expect(chain[chain.length - 1]).toBe("demo");
    const single = ProviderRouter.effectiveChain({
      provider: "gemini", model: "", privateMode: true, singleAttempt: true,
      messages: [{ role: "user", content: "x" }],
    });
    expect(single).toEqual(["gemini"]); // key-test semantics: exactly what was asked
  });

  it("oversized prompt routes around the cerebras 8K cap", () => {
    const big = "x".repeat(40_000 * 4); // ~40K tokens at chars/4
    const chain = ProviderRouter.effectiveChain({
      provider: "cerebras", model: "", messages: [{ role: "user", content: big }],
    });
    expect(chain).not.toContain("cerebras");
    expect(chain).toContain("ollama-local");
  });
});
