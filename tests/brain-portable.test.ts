// S22 brain-portable: a dump must survive a full round-trip into a FRESH store —
// content, namespaces, original timestamps, heat (access_count) and bi-temporal
// fact history all travel; vectors are rebuilt via the embed path. Deterministic
// fake embedder + tmp dbs (tests/brain.test.ts convention).
import { describe, test, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBrainStore } from "../server/brain";
import { exportBrain, importBrain, makeExistenceProbes, type BrainDump } from "../server/brain-portable";

const fakeEmbed = async (t: string) => {
  // 3-dim deterministic hash-ish embedding, distinct per text
  let h = 7;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 997;
  return [h / 997, ((h * 13) % 997) / 997, ((h * 29) % 997) / 997];
};
const tmpDb = () =>
  path.join(os.tmpdir(), `ollamas-portable-${process.pid}-${Math.floor(performance.now() * 1000)}.db`);

async function seedSource(dbPath: string) {
  let clock = Date.parse("2026-01-01T00:00:00Z");
  const b = createBrainStore({ dbPath, embed: fakeEmbed, now: () => clock });
  await b.remember({ id: "m-core", tier: "core", content: "operator is Emre", createdAt: clock });
  await b.remember({ id: "m-epi", tier: "episodic", content: "deploy uses make ship", ns: "org", createdAt: clock, hits: 5 });
  await b.assertFact({ subject: "ollamas", predicate: "branch", object: "v1" });
  clock += 86_400_000;
  await b.assertFact({ subject: "ollamas", predicate: "branch", object: "v2" }); // v1 → history
  b.close();
  return clock;
}

describe("brain-portable (S22)", () => {
  test("export → import into a fresh store: content, heat, ns and fact history survive", async () => {
    const src = tmpDb();
    await seedSource(src);
    const dump = exportBrain(src);
    expect(dump.version).toBe(1);
    expect(dump.memories).toHaveLength(2);
    expect(dump.facts).toHaveLength(2); // v1 (history) + v2 (live)

    const dst = tmpDb();
    const b2 = createBrainStore({ dbPath: dst, embed: fakeEmbed });
    const probeDb = new DatabaseSync(dst);
    const probes = makeExistenceProbes(probeDb);
    const r1 = await importBrain(b2, probes.hasMemory, probes.hasFact, dump);
    expect(r1).toMatchObject({
      memories: { inserted: 2, skipped: 0, failed: 0 },
      facts: { inserted: 2, skipped: 0, failed: 0 },
    });
    // Re-import is a no-op (idempotent merge — partial-failure re-runs are safe).
    const r2 = await importBrain(b2, probes.hasMemory, probes.hasFact, dump);
    expect(r2).toMatchObject({
      memories: { inserted: 0, skipped: 2 },
      facts: { inserted: 0, skipped: 2 },
    });

    const stats = b2.stats();
    expect(stats.memories.core).toBe(1);
    expect(stats.memories.episodic).toBe(1);
    expect(stats.facts).toBe(1); // only v2 live
    expect(stats.factsSuperseded).toBe(1); // v1 history preserved verbatim
    // Heat traveled: the hot episodic memory must still be 2 recalls from promotion.
    const row = probeDb.prepare("SELECT access_count AS hits, created_at AS createdAt FROM brain_memories WHERE mem_id='m-epi'").get() as { hits: number; createdAt: number };
    expect(row.hits).toBe(5);
    expect(row.createdAt).toBe(Date.parse("2026-01-01T00:00:00Z"));
    // Live fact answers correctly; vectors rebuilt (semantic recall works).
    expect(b2.factsAbout("ollamas", { ns: "default" }).map((f) => f.object)).toEqual(["v2"]);
    const hits = await b2.recall("deploy uses make ship", { k: 1, ns: "org" });
    expect(hits[0]?.id).toBe("m-epi");
    probeDb.close();
    b2.close();
  });

  test("dry-run counts without writing; bad tier and bad version fail loudly", async () => {
    const src = tmpDb();
    await seedSource(src);
    const dump = exportBrain(src);

    const dst = tmpDb();
    const b2 = createBrainStore({ dbPath: dst, embed: fakeEmbed });
    const probeDb = new DatabaseSync(dst);
    const probes = makeExistenceProbes(probeDb);
    const dry = await importBrain(b2, probes.hasMemory, probes.hasFact, dump, { dryRun: true });
    expect(dry.memories.inserted).toBe(2);
    expect(b2.stats().memories.core).toBe(0); // nothing written

    const badTier: BrainDump = { version: 1, memories: [{ ...dump.memories[0], tier: "galactic" }], facts: [] };
    const r = await importBrain(b2, probes.hasMemory, probes.hasFact, badTier);
    expect(r.memories.failed).toBe(1);

    await expect(importBrain(b2, probes.hasMemory, probes.hasFact, { version: 2 } as unknown as BrainDump))
      .rejects.toThrow(/unsupported dump version/);
    probeDb.close();
    b2.close();
  });

  test("historical fact import never supersedes a live fact (order independence)", async () => {
    const dst = tmpDb();
    const b = createBrainStore({ dbPath: dst, embed: fakeEmbed });
    // Live fact lands first…
    await b.assertFact({ subject: "s", predicate: "p", object: "live-now" });
    // …then a HISTORY row for the same (s,p) arrives from a dump.
    await b.assertFact({ subject: "s", predicate: "p", object: "old", validFrom: 1000, invalidatedAt: 2000 });
    expect(b.factsAbout("s").map((f) => f.object)).toEqual(["live-now"]); // untouched
    expect(b.stats().factsSuperseded).toBe(1);
    b.close();
  });
});
