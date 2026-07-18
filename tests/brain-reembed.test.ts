// S23 re-embed migrator: an A(3-dim)→B(8-dim) provider migration must rebuild
// BOTH vector tables at the new dim, keep recall working in the NEW space, and
// flip brain_meta only at the very end — a failing embedder aborts before
// anything is dropped, and a mid-run failure leaves meta unflipped (drift stays
// flagged; the pre-flight backup is the restore point).
import { describe, test, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { createBrainStore } from "../server/brain";
import { openBrainDb, planReembed, reembedAll } from "../server/brain-reembed";

const embedA = async (t: string) => {
  let h = 7;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 997;
  return [h / 997, ((h * 13) % 997) / 997, 0.25];
};
const embedB = async (t: string) => {
  let h = 3;
  for (const c of t) h = (h * 37 + c.charCodeAt(0)) % 1009;
  return Array.from({ length: 8 }, (_, i) => ((h * (i + 1)) % 1009) / 1009);
};
const tmpDb = () =>
  path.join(os.tmpdir(), `ollamas-reembed-${process.pid}-${Math.floor(performance.now() * 1000)}.db`);

async function seed(dbPath: string) {
  const b = createBrainStore({ dbPath, embed: embedA, embedProvider: "prov-A" });
  await b.remember({ id: "m1", tier: "learned", content: "likes espresso" });
  await b.remember({ id: "m2", tier: "episodic", content: "deploy uses make ship" });
  await b.assertFact({ subject: "ollamas", predicate: "port", object: "3000" });
  b.close();
}

describe("brain-reembed (S23)", () => {
  test("dry-run reports the plan without touching anything", async () => {
    const dbPath = tmpDb();
    await seed(dbPath);
    const db = openBrainDb(dbPath);
    const r = await reembedAll(db, embedB, { provider: "prov-B", dryRun: true });
    expect(r).toMatchObject({ memories: 2, facts: 1, fromProvider: "prov-A", fromDim: 3, toDim: 8, dryRun: true });
    expect(planReembed(db).fromProvider).toBe("prov-A"); // untouched
    db.close();
  });

  test("A(3d)→B(8d): both vec tables rebuilt, recall works in the new space, meta flipped", async () => {
    const dbPath = tmpDb();
    await seed(dbPath);
    const db = openBrainDb(dbPath);
    const progress: number[] = [];
    const r = await reembedAll(db, embedB, {
      provider: "prov-B",
      batchSize: 1,
      onProgress: (done) => progress.push(done),
    });
    expect(r.toDim).toBe(8);
    expect(progress.at(-1)).toBe(3); // 2 memories + 1 fact all reported
    db.close();

    // The store must accept the migrated space as ITS OWN (provider guard) and
    // recall must rank correctly with the NEW embedder.
    const b = createBrainStore({ dbPath, embed: embedB, embedProvider: "prov-B" });
    const hits = await b.recall("likes espresso", { k: 1 });
    expect(hits[0]?.id).toBe("m1");
    const facts = await b.searchFacts("ollamas port", { k: 1 });
    expect(facts[0]?.object).toBe("3000");
    b.close();
  });

  test("dead embedder aborts BEFORE anything is dropped", async () => {
    const dbPath = tmpDb();
    await seed(dbPath);
    const db = openBrainDb(dbPath);
    const dead = async () => { throw new Error("embedder down"); };
    await expect(reembedAll(db, dead, { provider: "prov-B" })).rejects.toThrow("embedder down");
    expect(planReembed(db)).toMatchObject({ fromProvider: "prov-A", fromDim: 3 }); // untouched
    db.close();
  });

  test("mid-run failure leaves meta UNFLIPPED (drift stays flagged)", async () => {
    const dbPath = tmpDb();
    await seed(dbPath);
    const db = openBrainDb(dbPath);
    let calls = 0;
    const flaky = async (t: string) => {
      calls++;
      if (calls > 2) throw new Error("provider died mid-run"); // probe + 1 row succeed
      return embedB(t);
    };
    await expect(reembedAll(db, flaky, { provider: "prov-B" })).rejects.toThrow("mid-run");
    expect(planReembed(db).fromProvider).toBe("prov-A"); // completion marker never flipped
    db.close();
  });
});
