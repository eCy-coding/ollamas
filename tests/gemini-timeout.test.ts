/**
 * Gemini SDK call must be bounded by the same composed timeout/abort (buildSignal) every fetch
 * provider uses — otherwise a gemini network stall hangs the chain. We mock @google/genai and
 * assert the abortSignal reaches the SDK config (streaming + non-streaming) and that a pre-aborted
 * caller propagates through.
 */
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";

const h = vi.hoisted(() => ({ cfg: { value: undefined as any } }));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = {
      generateContent: async (req: any) => {
        h.cfg.value = req.config;
        return { text: "ok", functionCalls: [], usageMetadata: {} };
      },
      generateContentStream: async (req: any) => {
        h.cfg.value = req.config;
        return (async function* () { yield { text: "chunk1" }; })();
      },
    };
    constructor(_opts: any) {}
  },
}));

import { ProviderRouter, type GenerateConfig } from "../server/providers";

const CONFIG: GenerateConfig = { provider: "gemini", model: "gemini-test", messages: [{ role: "user", content: "hi" }] };

describe("gemini SDK call is bounded by buildSignal()", () => {
  let savedKey: string | undefined;
  beforeEach(() => {
    savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = "test-key";
    vi.spyOn(ProviderRouter, "getFallbackChain").mockReturnValue(["gemini"]);
    h.cfg.value = undefined;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
    vi.restoreAllMocks();
  });

  test("non-streaming: config.abortSignal is a live AbortSignal", async () => {
    const c = new AbortController();
    await ProviderRouter.generate(CONFIG, undefined, undefined, c.signal);
    expect(h.cfg.value?.abortSignal).toBeInstanceOf(AbortSignal);
    expect(h.cfg.value.abortSignal.aborted).toBe(false);
  });

  test("streaming: config.abortSignal is an AbortSignal", async () => {
    const c = new AbortController();
    await ProviderRouter.generate(CONFIG, () => {}, undefined, c.signal);
    expect(h.cfg.value?.abortSignal).toBeInstanceOf(AbortSignal);
  });

  test("a pre-aborted caller propagates into the SDK config (aborted=true)", async () => {
    await ProviderRouter.generate(CONFIG, undefined, undefined, AbortSignal.abort()).catch(() => {});
    expect(h.cfg.value?.abortSignal?.aborted).toBe(true);
  });
});
