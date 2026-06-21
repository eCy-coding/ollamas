// Local RAG (v1.13). Proves sqlite-vec + embedding store works end-to-end and
// flows through the ToolRegistry choke-point. Core logic is deterministic via a
// FAKE embedder (no ollama). A RUN_LIVE_E2E test uses real ollama embeddings.
import { describe, test, expect, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { createRagStore } from "../server/rag";

// Deterministic 3-dim fake embedder: each doc maps to a fixed unit-ish vector so
// KNN ordering is predictable without any model.
const VECTORS: Record<string, number[]> = {
  cat: [1, 0, 0],
  dog: [0.9, 0.1, 0],
  car: [0, 1, 0],
  query_pet: [1, 0, 0],
};
const fakeEmbed = async (t: string) => VECTORS[t] ?? [0, 0, 1];

const tmpDb = () => path.join(os.tmpdir(), `ollamas-rag-${process.pid}-${Math.floor(performance.now())}.db`);

describe("RAG — sqlite-vec store + choke-point", () => {
  test("createRagStore indexes and returns nearest neighbours in order", async () => {
    const s = createRagStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await s.index("cat", "cat");
    await s.index("dog", "dog");
    await s.index("car", "car");
    const hits = await s.search("query_pet", 2);
    expect(hits.map((h) => h.id)).toEqual(["cat", "dog"]); // cat exact, dog closest
    expect(hits[0].distance).toBeCloseTo(0);
    expect(hits[0].text).toBe("cat");
    s.close();
  });

  test("re-indexing the same id replaces (no duplicate rows)", async () => {
    const s = createRagStore({ dbPath: tmpDb(), embed: fakeEmbed });
    await s.index("cat", "cat");
    await s.index("cat", "dog"); // same id, different vector
    const hits = await s.search("query_pet", 5);
    expect(hits.filter((h) => h.id === "cat")).toHaveLength(1);
    s.close();
  });

  test("rag_search through the choke-point on an empty store returns [] (no ollama needed)", async () => {
    process.env.RAG_DB_PATH = tmpDb(); // fresh empty store → search short-circuits before embedding
    const { ToolRegistry } = await import("../server/tool-registry");
    const out = await ToolRegistry.execute(
      "rag_search",
      { query: "anything" },
      { isLive: false, workspaceRoot: ".", autoApply: true, deps: {} as any },
    );
    expect(out.ok).toBe(true);
    expect(out.output.results).toEqual([]);
    delete process.env.RAG_DB_PATH;
  });

  test("rag_index host tier, rag_search safe tier", async () => {
    const { ToolRegistry } = await import("../server/tool-registry");
    expect(ToolRegistry.tier("rag_index")).toBe("host");
    expect(ToolRegistry.tier("rag_search")).toBe("safe");
  });

  // Live: real ollama embeddings (needs `ollama pull nomic-embed-text`). Opt-in.
  test.skipIf(process.env.RUN_LIVE_E2E !== "1")(
    "real ollama embeddings index + search round-trip",
    async () => {
      const { createRagStore: live } = await import("../server/rag");
      const s = live({ dbPath: tmpDb() }); // default embedText → ollama
      await s.index("d1", "The Eiffel Tower is in Paris.");
      await s.index("d2", "Photosynthesis converts sunlight into energy.");
      const hits = await s.search("Where is the Eiffel Tower?", 1);
      expect(hits[0].id).toBe("d1");
      s.close();
    },
    60000,
  );
});
