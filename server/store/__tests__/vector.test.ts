// O0 Faz 3 (02-o0-foundation.md §3 FAZ 3, RED 1-5) — VectorStore: per-collection
// sqlite-vec file behind server/store/vector.ts, wrapping the proven rag.ts
// patterns (injectable Embedder, lazy vec0, dim-lock, provider-lock) and adding
// the collection concept + delete(). Deterministic — no ollama.
import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { openVectorCollection, type VectorStore } from "../vector";

const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-o0-vec-"));
const open: VectorStore[] = [];

afterAll(() => {
  for (const s of open) try { s.close(); } catch {}
  fs.rmSync(baseDir, { recursive: true, force: true });
});

// Deterministic 3-dim embedder: alpha/bravo live on different axes; a query
// "close to alpha" lands nearest to "a" by L2 distance.
const fakeEmbed = async (text: string): Promise<number[]> => {
  if (text.includes("alpha")) return [1, 0, 0];
  if (text.includes("bravo")) return [0, 1, 0];
  return [0.9, 0.1, 0];
};

const col = (name: string, opts: Record<string, unknown> = {}): VectorStore => {
  const s = openVectorCollection(name, { baseDir, embed: fakeEmbed, ...opts });
  open.push(s);
  return s;
};

describe("VectorStore (per-collection sqlite-vec file)", () => {
  test("upsert + query returns the nearest neighbor (fake embedder, no ollama)", async () => {
    const t1 = col("t1");
    await t1.upsert("a", "alpha text");
    await t1.upsert("b", "bravo text");
    const hits = await t1.query("close to alpha", 1);
    expect(hits.length).toBe(1);
    expect(hits[0].id).toBe("a");
  });

  test("query on an empty collection → [] (rag.ts:144 parity)", async () => {
    const empty = col("t-empty");
    expect(await empty.query("anything", 3)).toEqual([]);
  });

  test("delete(id) removes the doc from query results", async () => {
    const t1 = col("t1");
    await t1.delete("a");
    const hits = await t1.query("close to alpha", 5);
    expect(hits.map((h) => h.id)).not.toContain("a");
    expect(hits.map((h) => h.id)).toContain("b"); // only "a" was removed
  });

  test("collection isolation: docs written to t1 are invisible to t2 (separate files)", async () => {
    const t2 = col("t2");
    await t2.upsert("z", "bravo text");
    const hits = await t2.query("close to alpha", 10);
    expect(hits.map((h) => h.id)).toEqual(["z"]);
    expect(fs.existsSync(path.join(baseDir, "t1.db"))).toBe(true);
    expect(fs.existsSync(path.join(baseDir, "t2.db"))).toBe(true);
  });

  test("dim-lock + provider-lock parity with rag.ts error contracts", async () => {
    const locked = col("t-locked");
    await locked.upsert("a", "alpha text"); // locks dim=3, provider=ollama-local
    locked.close();

    const wrongDim = col("t-locked", { embed: async () => [1, 0, 0, 0] });
    await expect(wrongDim.upsert("b", "four dims")).rejects.toThrow(/embedding dim mismatch/);
    wrongDim.close();

    const wrongProvider = col("t-locked", { embedProvider: "other-provider" });
    await expect(wrongProvider.upsert("c", "alpha text")).rejects.toThrow(/embed provider mismatch/);
  });
});
