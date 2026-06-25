import { describe, test, expect, afterEach, vi } from "vitest";

// H8: the gemini provider was the only adapter that never wired buildSignal(signal),
// so a gemini call could not be cancelled or time out (hung the ReAct loop). The fix
// adds abortSignal to the gemini request config. We capture the config the SDK receives.
const { cap } = vi.hoisted(() => ({ cap: { config: undefined as any } }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (p: any) => { cap.config = p.config; return { text: "ok", functionCalls: [] }; },
      generateContentStream: async (p: any) => { cap.config = p.config; return (async function* () { yield { text: "ok" }; })(); },
    };
  },
}));

import { ProviderRouter } from "../server/providers";

afterEach(() => { delete process.env.GEMINI_API_KEY; cap.config = undefined; });

describe("gemini abort/timeout signal wiring (H8)", () => {
  test("a non-stream gemini call passes an AbortSignal in its config", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    await ProviderRouter.generate({ provider: "gemini", model: "gemini-x", messages: [{ role: "user", content: "hi" }] });
    expect(cap.config?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(cap.config?.abortSignal?.aborted).toBe(false); // 300s timeout not yet fired
  });

  test("a pre-aborted caller signal reaches the gemini config (composed → aborted)", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    await ProviderRouter.generate(
      { provider: "gemini", model: "gemini-x", messages: [{ role: "user", content: "hi" }] },
      undefined, undefined, AbortSignal.abort(),
    ).catch(() => {});
    expect(cap.config?.abortSignal?.aborted).toBe(true);
  });
});
