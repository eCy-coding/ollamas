// health() drift probe — the CORRECT space-match test: cosine(fresh doc-embed, stored
// vector). Must report NO drift when the embedder is unchanged (even though nomic's
// asymmetric query/document prefixes make recall-self-hit an unreliable signal), and
// MUST catch real drift when the embedding model/space changes. Deterministic (fake
// embedders, temp db) — no ollama, no network.
import { describe, test, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBrainStore } from "../server/brain";

// 8-dim deterministic embedders. Same text → same vector (fresh reproduces stored →
// cosine 1). embedderA writes ONLY even indices, embedderB ONLY odd → disjoint support
// ⇒ cosine(A,B)=0 for any text, a clean stand-in for "the embedding space changed".
const embedderA = async (t: string): Promise<number[]> => {
  const v = new Array(8).fill(0);
  for (const ch of t) v[2 * (ch.charCodeAt(0) % 4)] += 1; // indices 0,2,4,6
  if (v.every((x) => x === 0)) v[0] = 1;
  return v;
};
const embedderB = async (t: string): Promise<number[]> => {
  const v = new Array(8).fill(0);
  for (const ch of t) v[2 * (ch.charCodeAt(0) % 4) + 1] += 1; // indices 1,3,5,7
  if (v.every((x) => x === 0)) v[1] = 1;
  return v;
};

function tmpDb() { return join(mkdtempSync(join(tmpdir(), "health-")), "brain.db"); }

async function seed(dbPath: string, embed: typeof embedderA) {
  const b = createBrainStore({ dbPath, embed });
  await b.remember({ id: "l1", tier: "learned", content: "gate persists via learned weight" });
  await b.remember({ id: "l2", tier: "core", content: "Emre is the sovereign operator" });
  await b.remember({ id: "l3", tier: "learned", content: "recall fuses vector and keyword arms" });
  b.close();
}

describe("health() — cosine space-match drift probe", () => {
  test("unchanged embedder → selfHitRate ~1, NO drift (no false alarm)", async () => {
    const dbPath = tmpDb();
    await seed(dbPath, embedderA);
    const b = createBrainStore({ dbPath, embed: embedderA });
    const h = await b.health({ probes: 8, threshold: 0.8 });
    b.close();
    expect(h.probes).toBeGreaterThan(0);
    expect(h.selfHitRate).toBeGreaterThan(0.99);
    expect(h.drift).toBe(false);
  });

  test("changed embedding space → low cosine, drift TRUE (catches real drift)", async () => {
    const dbPath = tmpDb();
    await seed(dbPath, embedderA);           // vectors written in space A
    const b = createBrainStore({ dbPath, embed: embedderB }); // now probe with space B
    const h = await b.health({ probes: 8, threshold: 0.8 });
    b.close();
    expect(h.selfHitRate).toBeLessThan(0.8);
    expect(h.drift).toBe(true);
  });

  test("empty store → healthy (selfHitRate 1, no drift)", async () => {
    const b = createBrainStore({ dbPath: tmpDb(), embed: embedderA });
    const h = await b.health();
    b.close();
    expect(h).toMatchObject({ selfHitRate: 1, drift: false, probes: 0 });
  });
});
