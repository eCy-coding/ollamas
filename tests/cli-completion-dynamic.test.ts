import { describe, it, expect } from "vitest";
import { complete } from "../cli/lib/completion";
import { PROVIDERS } from "../cli/lib/providers";

// v13 dynamic VALUE completion — complete(words, dyn) stays PURE (data injected).
// The __complete handler gathers dyn from LOCAL disk only (no network on TAB, N-019).
const dyn = { profiles: ["default", "work", "prod"], models: ["qwen3:8b", "qwen3:4b"], providers: [...PROVIDERS] };

describe("complete() dynamic injection", () => {
  it("config use <TAB> → profile names", () => {
    expect(complete(["config", "use"], dyn)).toEqual(["default", "work", "prod"]);
  });
  it("-m / --model <TAB> → models (any command)", () => {
    expect(complete(["chat", "-m"], dyn)).toEqual(["qwen3:8b", "qwen3:4b"]);
    expect(complete(["agent", "--model"], dyn)).toEqual(["qwen3:8b", "qwen3:4b"]);
  });
  it("-p / --provider <TAB> → providers", () => {
    expect(complete(["bench", "-p"], dyn)).toContain("ollama-local");
    expect(complete(["chat", "--provider"], dyn)).toContain("openrouter");
  });
  it("after the value, no further completion", () => {
    expect(complete(["config", "use", "work"], dyn)).toEqual([]);
    expect(complete(["chat", "-m", "qwen3:8b"], dyn)).toEqual([]);
  });
});

describe("complete() back-compat (no dyn → static behavior unchanged)", () => {
  it("config <TAB> still lists sub-actions (not profiles)", () => {
    const r = complete(["config"]);
    expect(r).toContain("use");
    expect(r).toContain("keystore");
  });
  it("config use with no dyn → empty (no injection)", () => {
    expect(complete(["config", "use"])).toEqual([]);
  });
  it("-m with no dyn → empty", () => {
    expect(complete(["chat", "-m"])).toEqual([]);
  });
  it("top-level + flags unchanged", () => {
    expect(complete([])).toContain("chat");
    expect(complete([])).toContain("--gateway");
  });
});
