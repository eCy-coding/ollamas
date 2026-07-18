// FIX A1 — bound the unbounded ollama probes (server/ai.ts listModels/loadedModelNames).
// Both /api/tags and /api/ps probes now pass an AbortSignal.timeout(...) so a
// resolvable-but-blackholed OLLAMA_HOST (e.g. host.docker.internal outside docker)
// fails fast instead of hanging the request indefinitely. Hermetic: global.fetch is
// mocked, no real network (same approach as tests/ai.test.ts / tests/provider-abort.test.ts).

import { describe, test, expect, vi, afterEach } from "vitest";
import * as ai from "../server/ai";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ai probes — AbortSignal timeout (FIX A1)", () => {
  test("listModels: every fetch call receives an AbortSignal", async () => {
    const seenSignals: unknown[] = [];
    vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      seenSignals.push(init?.signal);
      return new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await ai.listModels();

    expect(seenSignals.length).toBeGreaterThan(0);
    for (const s of seenSignals) {
      expect(s).toBeInstanceOf(AbortSignal);
    }
  });

  test("loadedModelNames: every fetch call receives an AbortSignal", async () => {
    const seenSignals: unknown[] = [];
    vi.spyOn(global, "fetch").mockImplementation(async (_url, init) => {
      seenSignals.push(init?.signal);
      return new Response(JSON.stringify({ models: [{ name: "qwen3:8b" }] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    });

    await ai.loadedModelNames();

    expect(seenSignals.length).toBeGreaterThan(0);
    for (const s of seenSignals) {
      expect(s).toBeInstanceOf(AbortSignal);
    }
  });

  test("listModels resolves to [] (no throw) when every base rejects with an abort/timeout error", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      throw new DOMException("The operation timed out.", "TimeoutError");
    });

    await expect(ai.listModels()).resolves.toEqual([]);
  });

  test("loadedModelNames resolves to [] (no throw) when every base rejects with an abort/timeout error", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    });

    await expect(ai.loadedModelNames()).resolves.toEqual([]);
  });
});
