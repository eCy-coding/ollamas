import { describe, it, expect } from "vitest";
import { parseModelCache, selectModels, mergeModelCache, type ModelCache } from "../cli/lib/modelcache";

describe("parseModelCache", () => {
  it("accepts a well-formed cache", () => {
    expect(parseModelCache('{"ts":123,"byProvider":{"ollama-local":["qwen3:8b"]}}')).toEqual({
      ts: 123,
      byProvider: { "ollama-local": ["qwen3:8b"] },
    });
  });
  it("rejects corrupt JSON → null", () => {
    expect(parseModelCache("{not json")).toBeNull();
  });
  it("rejects missing fields → null", () => {
    expect(parseModelCache('{"ts":1}')).toBeNull();
    expect(parseModelCache('{"byProvider":{}}')).toBeNull();
  });
});

describe("selectModels (TTL)", () => {
  const cache: ModelCache = { ts: 1000, byProvider: { "ollama-local": ["a", "b"], openai: ["gpt"] } };
  it("returns the provider list when fresh", () => {
    expect(selectModels(cache, "ollama-local", 1500, 1000)).toEqual(["a", "b"]);
  });
  it("returns [] when expired", () => {
    expect(selectModels(cache, "ollama-local", 5000, 1000)).toEqual([]); // 4000 > 1000 maxAge
  });
  it("returns [] for an unknown provider", () => {
    expect(selectModels(cache, "gemini", 1500, 1000)).toEqual([]);
  });
  it("returns [] for a null cache", () => {
    expect(selectModels(null, "ollama-local", 1500, 1000)).toEqual([]);
  });
});

describe("mergeModelCache", () => {
  it("adds a provider, restamps ts, preserves others", () => {
    const cur: ModelCache = { ts: 1, byProvider: { openai: ["gpt"] } };
    const next = mergeModelCache(cur, "ollama-local", ["qwen3:8b"], 99);
    expect(next).toEqual({ ts: 99, byProvider: { openai: ["gpt"], "ollama-local": ["qwen3:8b"] } });
  });
  it("seeds from null", () => {
    expect(mergeModelCache(null, "ollama-local", ["x"], 5)).toEqual({ ts: 5, byProvider: { "ollama-local": ["x"] } });
  });
  it("overwrites the same provider", () => {
    const cur: ModelCache = { ts: 1, byProvider: { "ollama-local": ["old"] } };
    expect(mergeModelCache(cur, "ollama-local", ["new"], 2).byProvider["ollama-local"]).toEqual(["new"]);
  });
});
