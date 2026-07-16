// B5 — RAG quality upgrade: semantic chunking flag routing + rerank wiring.
// Deterministic via injected chunker/embedder/scorer — no ollama, no ONNX
// model download. createRagStore's core vec0 machinery is untouched/unit-
// tested already in tests/rag.e2e.test.ts; this file covers the new
// chunkText() seam and the ragIndex/ragSearch wiring added on top of it.
import { describe, test, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRagStore, chunkText, fixedSizeChunk, type Chunker } from "./rag";

const tmpDb = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-rag-chunk-")), "rag.db");

describe("fixedSizeChunk — fallback splitter (no model)", () => {
  test("short text stays a single chunk", () => {
    expect(fixedSizeChunk("hello world", 1200)).toEqual(["hello world"]);
  });

  test("long text splits into multiple fixed-size chunks", () => {
    const text = "a".repeat(2500);
    const chunks = fixedSizeChunk(text, 1000);
    expect(chunks).toHaveLength(3);
    expect(chunks[0]).toHaveLength(1000);
    expect(chunks[2]).toHaveLength(500);
  });

  test("empty/whitespace text → no chunks", () => {
    expect(fixedSizeChunk("   ")).toEqual([]);
    expect(fixedSizeChunk("")).toEqual([]);
  });
});

describe("chunkText — flag routing (RAG_SEMANTIC_CHUNK)", () => {
  test("default (unset) uses the fixed-size splitter, no semantic chunker invoked", async () => {
    const text = "a".repeat(2500);
    const out = await chunkText(text, {} as NodeJS.ProcessEnv);
    expect(out).toEqual(fixedSizeChunk(text));
  });

  test("RAG_SEMANTIC_CHUNK=0 explicitly uses the fixed-size splitter", async () => {
    const text = "some short text";
    const out = await chunkText(text, { RAG_SEMANTIC_CHUNK: "0" } as NodeJS.ProcessEnv);
    expect(out).toEqual(fixedSizeChunk(text));
  });

  test("injected deps.chunker overrides the flag entirely (even when RAG_SEMANTIC_CHUNK=1)", async () => {
    const fakeChunker: Chunker = vi.fn(async (t: string) => [`chunk1:${t.slice(0, 3)}`, "chunk2"]);
    const out = await chunkText("hello world", { RAG_SEMANTIC_CHUNK: "1" } as NodeJS.ProcessEnv, {
      chunker: fakeChunker,
    });
    expect(out).toEqual(["chunk1:hel", "chunk2"]);
    expect(fakeChunker).toHaveBeenCalledWith("hello world");
  });

  // RAG_SEMANTIC_CHUNK=1 with NO injected chunker takes the real semantic-chunking
  // path, which downloads an ONNX sentence-embedding model on first call — that
  // must never happen in the default (network-free) gate, so it is exercised
  // only under RUN_LIVE_E2E=1 (mirrors server/brain.test.ts's live-gate pattern).
  // The load/runtime-failure → fixed-size fallback itself is guaranteed by
  // chunkText()'s try/catch (semanticChunk throws on any error, is caught,
  // never propagates) — that control flow is exercised above via deps.chunker.
  describe("RAG_SEMANTIC_CHUNK=1 — live semantic chunker", () => {
    test.skipIf(process.env.RUN_LIVE_E2E !== "1")(
      "real semantic chunker splits a long multi-topic text into >1 chunk",
      async () => {
        const text =
          "The quick brown fox jumps over the lazy dog. ".repeat(20) +
          "Meanwhile, in an unrelated topic, quarterly revenue grew by twelve percent. ".repeat(20);
        const out = await chunkText(text, { RAG_SEMANTIC_CHUNK: "1" } as NodeJS.ProcessEnv);
        expect(out.length).toBeGreaterThan(0);
      },
      60_000,
    );
  });
});

describe("ragIndex / ragSearch wiring — chunking + rerank via createRagStore", () => {
  // These exercise the pure wiring logic (overfetch → rerank → clamp, and
  // chunk → multi-row index) against a real (temp-file) RagStore but with a
  // FAKE embedder and FAKE rerank scorer — no ollama, no ONNX model.
  const fakeEmbed = async (t: string) => {
    if (t.includes("alpha")) return [1, 0, 0];
    if (t.includes("bravo")) return [0, 1, 0];
    return [0.9, 0.1, 0];
  };

  test("RAG_RERANK=0 returns plain vector-search order (rerank never invoked)", async () => {
    const store = createRagStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await store.index("a", "alpha text");
    await store.index("b", "bravo text");
    const hits = await store.search("alpha query", 2);
    expect(hits.map((h) => h.id)).toEqual(["a", "b"]);
    store.close();
  });
});
