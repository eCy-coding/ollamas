// vC1 P1 — Gemini-capable façade engine selection. Hermetic: spy on
// ProviderRouter (no real network) + mock global.fetch for /api/tags.

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import * as ai from "../server/ai";
import { ProviderRouter } from "../server/providers";

function tagsResponse(names: string[]) {
  return new Response(JSON.stringify({ models: names.map((n) => ({ name: n })) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

const OK = { text: "ok", source: "x", modelUsed: "m", latencyMs: 1 };

beforeEach(() => ai._resetDefaultModelCache());
afterEach(() => vi.restoreAllMocks());

describe("façade — provider/engine selection", () => {
  test("provider 'gemini' routes to gemini with the default gemini model", async () => {
    const spy = vi.spyOn(ProviderRouter, "generate").mockResolvedValue(OK as any);
    await ai.generate("analyze this", { provider: "gemini" });
    const cfg = spy.mock.calls[0][0];
    expect(cfg.provider).toBe("gemini");
    expect(cfg.model).toBe("gemini-3.5-flash");
  });

  test("explicit model overrides the provider default", async () => {
    const spy = vi.spyOn(ProviderRouter, "generate").mockResolvedValue(OK as any);
    await ai.generate("x", { provider: "gemini", model: "gemini-2.5-pro" });
    expect(spy.mock.calls[0][0].model).toBe("gemini-2.5-pro");
  });

  test("system instruction is prepended as a system message", async () => {
    const spy = vi.spyOn(ProviderRouter, "generate").mockResolvedValue(OK as any);
    await ai.generate("user prompt", { provider: "gemini", system: "You are a bug triager." });
    const msgs = spy.mock.calls[0][0].messages;
    expect(msgs[0]).toEqual({ role: "system", content: "You are a bug triager." });
    expect(msgs[1]).toEqual({ role: "user", content: "user prompt" });
  });

  test("default (no provider) stays ollama-local — backward compatible", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(tagsResponse(["qwen3:8b"]));
    const spy = vi.spyOn(ProviderRouter, "generate").mockResolvedValue(OK as any);
    await ai.generate("hi");
    expect(spy.mock.calls[0][0].provider).toBe("ollama-local");
    expect(spy.mock.calls[0][0].model).toBe("qwen3:8b");
  });
});

describe("façade — pickEngine", () => {
  test("code task with a Gemini key picks gemini", async () => {
    vi.spyOn(ProviderRouter, "getDecryptedKey").mockReturnValue("fake-key");
    expect(await ai.pickEngine("code")).toEqual({ provider: "gemini", model: "gemini-3.5-flash" });
  });

  test("code task without a Gemini key falls back to a local coder model", async () => {
    vi.spyOn(ProviderRouter, "getDecryptedKey").mockReturnValue("");
    vi.spyOn(global, "fetch").mockResolvedValue(tagsResponse(["qwen3:8b", "qwen3-coder:30b"]));
    expect(await ai.pickEngine("code")).toEqual({ provider: "ollama-local", model: "qwen3-coder:30b" });
  });
});
