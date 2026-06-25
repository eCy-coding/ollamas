// v1.11 — Colab-style AI façade (server/ai.ts) tests. Hermetic: global.fetch is
// mocked (same approach as provider-abort.test.ts). Routes by URL so a single
// mock serves both /api/tags (model discovery) and /api/chat (inference).

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import * as ai from "../server/ai";

function tagsResponse(names: string[]) {
  return new Response(JSON.stringify({ models: names.map((n) => ({ name: n })) }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function chatJson(text: string) {
  return new Response(
    JSON.stringify({ message: { content: text }, done: true, eval_count: 5, eval_duration: 1_000_000_000 }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function chatStream(chunks: Array<{ content: string; done?: boolean }>) {
  const lines = chunks.map((c) =>
    JSON.stringify({
      message: { content: c.content },
      done: !!c.done,
      ...(c.done ? { eval_count: 2, eval_duration: 1_000_000_000 } : {}),
    }) + "\n"
  );
  return new Response(
    new ReadableStream({
      start(controller) {
        for (const l of lines) controller.enqueue(new TextEncoder().encode(l));
        controller.close();
      },
    }),
    { status: 200, headers: { "Content-Type": "application/x-ndjson" } }
  );
}

beforeEach(() => {
  ai._resetDefaultModelCache();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ai façade — listModels / default model", () => {
  test("listModels maps /api/tags names to a flat list", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      expect(String(url)).toContain("/api/tags");
      return tagsResponse(["qwen3:8b", "llama3.3:70b"]);
    });
    expect(await ai.listModels()).toEqual(["qwen3:8b", "llama3.3:70b"]);
  });

  test("resolveDefaultModel picks the first local model", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(tagsResponse(["qwen3-coder:30b", "qwen3:8b"]));
    expect(await ai.resolveDefaultModel()).toBe("qwen3-coder:30b");
  });

  test("resolveDefaultModel throws a clear error when no local model is installed", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(tagsResponse([]));
    await expect(ai.resolveDefaultModel()).rejects.toThrow(/no local ollama model available/);
  });

  test("listModels: ilk base erişilemez → sonraki base'den döner (Faz11C T1-001)", async () => {
    let calls = 0;
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      calls++;
      if (calls === 1) throw new Error("ECONNREFUSED"); // docker host unreachable on local boot
      expect(String(url)).toContain("/api/tags");
      return tagsResponse(["qwen3:8b"]);
    });
    expect(await ai.listModels()).toEqual(["qwen3:8b"]);
    expect(calls).toBeGreaterThanOrEqual(2);
  });
});

describe("ai façade — generateText", () => {
  test("returns text using the auto-selected default model", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/tags")) return tagsResponse(["qwen3:8b"]);
      if (u.includes("/api/chat")) return chatJson("The capital of France is Paris.");
      throw new Error(`unexpected url: ${u}`);
    });
    expect(await ai.generateText("What is the capital of France?")).toBe("The capital of France is Paris.");
  });

  test("honors an explicit model (no /api/tags call needed)", async () => {
    const seen: string[] = [];
    vi.spyOn(global, "fetch").mockImplementation(async (url, init) => {
      const u = String(url);
      seen.push(u);
      if (u.includes("/api/chat")) {
        const body = JSON.parse((init as any).body);
        expect(body.model).toBe("llama3.3:70b");
        return chatJson("ok");
      }
      throw new Error(`unexpected url: ${u}`);
    });
    expect(await ai.generateText("hi", { model: "llama3.3:70b" })).toBe("ok");
    expect(seen.some((u) => u.includes("/api/tags"))).toBe(false);
  });
});

describe("ai façade — generateTextStream", () => {
  test("yields chunks in order then completes", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes("/api/tags")) return tagsResponse(["qwen3:8b"]);
      return chatStream([{ content: "Once " }, { content: "upon a time.", done: true }]);
    });
    const out: string[] = [];
    for await (const c of ai.generateTextStream("Tell me a story.")) out.push(c);
    expect(out).toEqual(["Once ", "upon a time."]);
  });
});
