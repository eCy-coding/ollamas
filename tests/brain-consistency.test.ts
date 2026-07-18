// S25 consistency sentinel: seeded violations must be found, a healthy store must
// report total 0, and the sentinel itself must degrade to {error} instead of
// throwing. Violations are injected with direct SQL — the whole point is catching
// what the store's own choke-points would never produce.
import { describe, test, expect } from "vitest";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createBrainStore } from "../server/brain";
import { checkConsistencyAt } from "../server/brain-consistency";
import { buildMaintainReport } from "../scripts/brain-maintain";

const fakeEmbed = async (t: string) => {
  let h = 7;
  for (const c of t) h = (h * 31 + c.charCodeAt(0)) % 997;
  return [h / 997, ((h * 13) % 997) / 997, 0.25];
};
const tmpDb = () =>
  path.join(os.tmpdir(), `ollamas-consistency-${process.pid}-${Math.floor(performance.now() * 1000)}.db`);

describe("brain-consistency (S25)", () => {
  test("healthy store → every invariant holds, total 0", async () => {
    const dbPath = tmpDb();
    const b = createBrainStore({ dbPath, embed: fakeEmbed });
    await b.remember({ id: "m1", tier: "learned", content: "clean row" });
    await b.assertFact({ subject: "ollamas", predicate: "port", object: "3000" });
    b.close();
    const r = checkConsistencyAt(dbPath);
    expect(r.error).toBeUndefined();
    expect(r.total).toBe(0);
  });

  test("seeded violations are each detected and counted", async () => {
    const dbPath = tmpDb();
    const b = createBrainStore({ dbPath, embed: fakeEmbed });
    await b.remember({ id: "m-keep", tier: "learned", content: "kept row" });
    await b.remember({ id: "m-orphan", tier: "learned", content: "row to orphan" });
    await b.assertFact({ subject: "Emre", predicate: "role", object: "T0" });
    await b.assertFact({ subject: "emre", predicate: "lang", object: "tr" }); // case variant
    b.close();

    const db = new DatabaseSync(dbPath);
    // missing vec FIRST, at an explicit high rowid: sqlite reuses freed rowids, so
    // inserting after the delete below would silently adopt the orphaned vector —
    // exactly the rowid-reuse hazard the module comment documents.
    db.prepare(
      "INSERT INTO brain_memories(rowid, mem_id, tier, content, ns, created_at) VALUES(99,'m-novec','episodic','no vector','default', 1)",
    ).run();
    // orphan vec + stale fts: delete ONLY the memory row (bypassing deleteMemRow)
    const orphan = db.prepare("SELECT rowid FROM brain_memories WHERE mem_id='m-orphan'").get() as { rowid: number };
    db.prepare("DELETE FROM brain_memories WHERE rowid=?").run(BigInt(orphan.rowid));
    // duplicate live fact: second live row on an existing (ns, subject, predicate)
    db.prepare(
      "INSERT INTO brain_facts(subject, predicate, object, ns, valid_from) VALUES('Emre','role','T1','default', 2)",
    ).run();
    db.close();
    // Through the vec-loading opener — a plain connection can't even read vec0
    // tables, so checkConsistency on it would silently report 0 vector issues.
    const r = checkConsistencyAt(dbPath);

    expect(r.duplicateLiveFacts).toEqual([{ ns: "default", subject: "Emre", predicate: "role", count: 2 }]);
    expect(r.orphanVecRows).toBe(1);
    expect(r.ftsStale).toBe(1);
    expect(r.missingVecRows).toBe(1);
    expect(r.ftsMissing).toBe(1); // m-novec never reached the FTS index either
    expect(r.missingFactVecRows).toBe(1); // the hand-inserted duplicate has no vector
    expect(r.caseVariantSubjects).toEqual([{ normalized: "emre", variants: ["Emre", "emre"] }]);
    // 1 extra live fact + 1 orphanVec + 1 missingVec + 1 ftsMissing + 1 ftsStale + 1 missingFactVec + 1 case-variant
    expect(r.total).toBe(7);
  });

  test("sentinel degrades to {error}, never throws (missing db)", () => {
    const r = checkConsistencyAt(path.join(os.tmpdir(), "does-not-exist-brain.db"));
    expect(r.total).toBe(0);
    expect(r.error).toBeTruthy();
  });

  test("maintain report carries violations without touching the alarm contract", () => {
    const base = {
      sweep: { swept: 0 },
      consolidate: { promoted: 0, merged: 0 },
      health: { selfHitRate: 1, drift: false, probes: 8 },
    };
    const withViolations = buildMaintainReport({ ...base, consistency: { total: 7 } });
    expect(withViolations.consistencyViolations).toBe(7);
    expect(withViolations.exitCode).toBe(0); // report-only: never escalates
    expect(buildMaintainReport(base).consistencyViolations).toBe(0);
  });
});
