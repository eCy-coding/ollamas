import { describe, it, expect } from "vitest";
import { ProviderRouter } from "../server/providers";

describe("local OpenAI-compat backends — vLLM / llama.cpp (#3)", () => {
  it("localCompatBaseUrl: env-overridable defaults (:8000 / :8080)", () => {
    expect(ProviderRouter.localCompatBaseUrl("vllm", {} as any)).toBe("http://localhost:8000/v1");
    expect(ProviderRouter.localCompatBaseUrl("llamacpp", {} as any)).toBe("http://localhost:8080/v1");
    expect(ProviderRouter.localCompatBaseUrl("vllm", { VLLM_BASE_URL: "http://gpu:9000/v1" } as any)).toBe("http://gpu:9000/v1");
    expect(ProviderRouter.localCompatBaseUrl("openai", {} as any)).toBe("");
  });

  it("are explicitly selectable (chain starts with the provider) but NOT in the auto-fallback defaults", () => {
    expect(ProviderRouter.getFallbackChain("vllm")[0]).toBe("vllm");
    expect(ProviderRouter.getFallbackChain("llamacpp")[0]).toBe("llamacpp");
    // not auto-probed in another provider's chain (a down local backend must not hang failover)
    expect(ProviderRouter.getFallbackChain("openai")).not.toContain("vllm");
    expect(ProviderRouter.getFallbackChain("gemini")).not.toContain("llamacpp");
  });
});
