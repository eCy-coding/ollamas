// Brain retrieval-quality eval (P4) — MRR over a golden fixture, mirroring the RAG
// lane's MRR proof. Seeds a THROWAWAY brain.db (never the live one) from
// eval/brain-mrr-fixture.json with the real resolved embedder ($0 local nomic),
// recalls each golden query, and scores Mean Reciprocal Rank of the expected id.
//   MRR = mean(1 / rank_of_expected), 0 when absent from top-k.
// Exit 1 below the floor (BRAIN_MRR_FLOOR, default 0.6) so `make eval-brain-mrr`
// can gate. Live-embedder path — needs local ollama; not part of the unit suite.
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBrainStore, type MemoryTier } from "../server/brain";
import { resolveEmbedder } from "../server/rag";

const HERE = path.dirname(fileURLToPath(import.meta.url));

interface Fixture {
  memories: { id: string; tier: MemoryTier; content: string }[];
  queries: { q: string; expect: string }[];
}

/** Pure: fold per-query ranks (null = not found) into MRR. */
export function computeMrr(ranks: (number | null)[]): number {
  if (ranks.length === 0) return 0;
  const sum = ranks.reduce<number>((acc, r) => acc + (r ? 1 / r : 0), 0);
  return sum / ranks.length;
}

async function main() {
  const fixturePath = process.argv[2] || path.join(HERE, "../eval/brain-mrr-fixture.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as Fixture;
  const k = Number(process.env.BRAIN_MRR_K) || 5;
  const floor = Number(process.env.BRAIN_MRR_FLOOR) || 0.6;

  const dir = mkdtempSync(path.join(tmpdir(), "brain-mrr-"));
  const r = resolveEmbedder();
  const b = createBrainStore({ dbPath: path.join(dir, "eval.db"), embed: r.embed, embedProvider: r.providerId });
  try {
    for (const m of fixture.memories) await b.remember(m);
    const ranks: (number | null)[] = [];
    const misses: { q: string; expect: string; got: string[] }[] = [];
    for (const { q, expect } of fixture.queries) {
      const hits = await b.recall(q, { k });
      const idx = hits.findIndex((h) => h.id === expect);
      ranks.push(idx === -1 ? null : idx + 1);
      if (idx !== 0) misses.push({ q, expect, got: hits.map((h) => h.id).slice(0, 3) });
    }
    const mrr = computeMrr(ranks);
    console.log(
      JSON.stringify({
        event: "brain.eval.mrr",
        provider: r.providerId,
        queries: fixture.queries.length,
        k,
        mrr: Number(mrr.toFixed(4)),
        floor,
        pass: mrr >= floor,
        notTop1: misses,
      }),
    );
    process.exit(mrr >= floor ? 0 : 1);
  } finally {
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

if (process.argv[1] && process.argv[1].endsWith("brain-eval-mrr.ts")) {
  main().catch((e) => {
    console.error(`[brain] mrr eval failed: ${e?.message ?? e}`);
    process.exit(1);
  });
}
