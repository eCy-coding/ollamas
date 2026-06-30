import { describe, it, expect, vi, afterEach } from "vitest";
import { ProviderRouter, latencyForFailure } from "../server/providers";

describe("latencyForFailure (vNext T2.2 — failed/hung provider sorts last)", () => {
  it("returns real elapsed when it exceeds the penalty (hang sorts by its true timeout)", () => {
    expect(latencyForFailure(120_000)).toBe(120_000);
  });
  it("floors a fast failure to the penalty (broken provider never sorts ahead of a healthy one)", () => {
    expect(latencyForFailure(50)).toBe(60_000); // default penalty
  });
  it("honors an explicit penalty override", () => {
    expect(latencyForFailure(50, 1_000)).toBe(1_000);
    expect(latencyForFailure(5_000, 1_000)).toBe(5_000);
  });
});

describe("recordLatency + getLatency round-trip", () => {
  afterEach(() => vi.useRealTimers());

  it("records then reads back the same latency", () => {
    ProviderRouter.recordLatency("openrouter", 137);
    expect(ProviderRouter.getLatency("openrouter")).toBe(137);
  });

  it("returns -1 once the entry is older than the 300s freshness window", () => {
    vi.useFakeTimers();
    ProviderRouter.recordLatency("openai", 42);
    expect(ProviderRouter.getLatency("openai")).toBe(42);
    vi.advanceTimersByTime(300_001); // past TTL
    expect(ProviderRouter.getLatency("openai")).toBe(-1);
  });

  it("returns -1 for a provider with no recorded latency", () => {
    expect(ProviderRouter.getLatency("never-seen-provider")).toBe(-1);
  });
});

describe("T2.2 wiring — recorded latency actually reorders the cloud tier", () => {
  it("getFallbackChain prefers the fastest proven cloud provider, keeps gemini family adjacent", () => {
    // Seed the telemetry the way real generate() calls would (success = real ms).
    ProviderRouter.recordLatency("openai", 10);
    ProviderRouter.recordLatency("ollama-cloud", 50);
    ProviderRouter.recordLatency("gemini", 200);
    ProviderRouter.recordLatency("openrouter", 500);
    ProviderRouter.recordLatency("gemini-cli", 9_999); // slow → would separate from gemini without re-pin

    const chain = ProviderRouter.getFallbackChain("ollama-local");
    // front + $0 local first, demo last (invariants intact)
    expect(chain[0]).toBe("ollama-local");
    expect(chain[1]).toBe("fleet");
    expect(chain[chain.length - 1]).toBe("demo");

    const cloud = chain.filter((p) => !["ollama-local", "fleet", "demo"].includes(p));
    expect(cloud[0]).toBe("openai"); // fastest measured cloud now leads — T2.2 LIVE
    expect(cloud.indexOf("gemini-cli")).toBe(cloud.indexOf("gemini") + 1); // family re-pinned adjacent
  });
});
