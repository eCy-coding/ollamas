import { describe, it, expect } from "vitest";
import { firstUsableModel, DEFAULT_LOCAL_PROVIDER } from "../../src/lib/localModel";

// MATH §8 — $0-local default. firstUsableModel picks the first REAL model, skipping the "no key" placeholder
// strings a cloud provider returns, so the agent panels are usable out-of-box on the local engine.
describe("firstUsableModel — skip keyless-cloud placeholders", () => {
  it("returns the first non-placeholder model", () => {
    expect(firstUsableModel(["qwen3:8b", "qwen3-coder:30b"])).toBe("qwen3:8b");
  });
  it("skips placeholder entries and picks the first real one", () => {
    expect(firstUsableModel(["gemini-3.5-flash (API key not set)", "qwen3:8b"])).toBe("qwen3:8b");
    expect(firstUsableModel(["model not installed", "phi4:latest"])).toBe("phi4:latest");
  });
  it("falls back to list[0] when EVERY entry is a placeholder (degraded, still non-empty)", () => {
    expect(firstUsableModel(["gemini (API key not set)"])).toBe("gemini (API key not set)");
  });
  it("empty / invalid list → empty string", () => {
    expect(firstUsableModel([])).toBe("");
    expect(firstUsableModel(undefined as unknown as string[])).toBe("");
  });
  it("the default provider is the $0 local engine", () => {
    expect(DEFAULT_LOCAL_PROVIDER).toBe("ollama-local");
  });
});
