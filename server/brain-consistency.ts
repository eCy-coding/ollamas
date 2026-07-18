// Brain consistency sentinel (S25) — report-only invariant checks over brain.db.
// The stores maintain four cross-table contracts that nothing verified until now:
//   1. fact uniqueness: at most ONE live fact per (ns, subject, predicate) —
//      assertFact's supersede chain guarantees it; a violation means a direct
//      write or a buggy import corrupted bi-temporal history.
//   2. vector sync: every memory row has exactly one brain_vec row and vice
//      versa (an orphan vector ranks KNN results that no longer exist; a missing
//      vector makes a memory unrecallable semantically).
//   3. fact-vector sync: same contract for brain_facts ↔ brain_fact_vec.
//   4. FTS sync: every memory is indexed exactly once in brain_fts (when FTS5 is
//      available) — desync silently weakens the hybrid-RRF keyword arm.
// Plus a hygiene signal: case-variant subjects ("Emre" vs "emre") fragment the
// entity graph (buildGraph normalizes ids, but facts stay split across spellings).
// Report-only by design (SSGM: maintenance never auto-destroys); wired into
// brain-maintain after health(), and standalone via `make brain-check`.
//
// Known limit: sync checks correlate by rowid, and sqlite REUSES freed rowids —
// an external DELETE followed by an insert can hand a new memory the old row's
// vector/fts entries, which then look "in sync" while pointing at wrong content.
// The store's own deleteMemRow removes all three rows together, so this only
// arises from writes behind the store's back; catching it would need content
// hashing, deliberately out of scope for a $0 SQL-only sentinel.
import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";

export interface ConsistencyReport {
  duplicateLiveFacts: { ns: string; subject: string; predicate: string; count: number }[];
  orphanVecRows: number;
  missingVecRows: number;
  orphanFactVecRows: number;
  missingFactVecRows: number;
  ftsMissing: number;
  ftsStale: number;
  caseVariantSubjects: { normalized: string; variants: string[] }[];
  /** Sum of all violation counts — 0 means every invariant holds. */
  total: number;
  /** Set instead of throwing: the sentinel itself must never break maintenance. */
  error?: string;
}

const EMPTY: Omit<ConsistencyReport, "total"> = {
  duplicateLiveFacts: [],
  orphanVecRows: 0,
  missingVecRows: 0,
  orphanFactVecRows: 0,
  missingFactVecRows: 0,
  ftsMissing: 0,
  ftsStale: 0,
  caseVariantSubjects: [],
};

const count = (db: DatabaseSync, sql: string): number => {
  try {
    return Number((db.prepare(sql).get() as { n: number }).n);
  } catch {
    return 0; // table absent (v1 store / FTS unavailable) → contract vacuously holds
  }
};

/** Pure given a db handle: run every invariant check, fold into one report. */
export function checkConsistency(db: DatabaseSync): ConsistencyReport {
  try {
    const duplicateLiveFacts = db
      .prepare(
        `SELECT ns, subject, predicate, COUNT(*) AS count FROM brain_facts
         WHERE invalidated_at IS NULL GROUP BY ns, subject, predicate HAVING COUNT(*) > 1`,
      )
      .all() as unknown as ConsistencyReport["duplicateLiveFacts"];

    const orphanVecRows = count(db, "SELECT COUNT(*) AS n FROM brain_vec WHERE rowid NOT IN (SELECT rowid FROM brain_memories)");
    const missingVecRows = count(db, "SELECT COUNT(*) AS n FROM brain_memories WHERE rowid NOT IN (SELECT rowid FROM brain_vec)");
    const orphanFactVecRows = count(db, "SELECT COUNT(*) AS n FROM brain_fact_vec WHERE rowid NOT IN (SELECT rowid FROM brain_facts)");
    const missingFactVecRows = count(db, "SELECT COUNT(*) AS n FROM brain_facts WHERE rowid NOT IN (SELECT rowid FROM brain_fact_vec)");

    // FTS contract only when the shadow table exists (feature-detected elsewhere).
    let ftsMissing = 0;
    let ftsStale = 0;
    try {
      db.prepare("SELECT 1 FROM brain_fts LIMIT 0").all();
      ftsMissing = count(db, "SELECT COUNT(*) AS n FROM brain_memories WHERE rowid NOT IN (SELECT mem_rowid FROM brain_fts)");
      ftsStale = count(db, "SELECT COUNT(*) AS n FROM brain_fts WHERE mem_rowid NOT IN (SELECT rowid FROM brain_memories)");
    } catch { /* FTS5 absent → vector-only store, nothing to verify */ }

    const caseVariantSubjects = (db
      .prepare(
        `SELECT LOWER(TRIM(subject)) AS normalized, GROUP_CONCAT(DISTINCT subject) AS variants
         FROM brain_facts GROUP BY LOWER(TRIM(subject)) HAVING COUNT(DISTINCT subject) > 1`,
      )
      .all() as { normalized: string; variants: string }[])
      .map((r) => ({ normalized: r.normalized, variants: String(r.variants).split(",") }));

    const total =
      duplicateLiveFacts.reduce((a, d) => a + d.count - 1, 0) +
      orphanVecRows + missingVecRows + orphanFactVecRows + missingFactVecRows +
      ftsMissing + ftsStale + caseVariantSubjects.length;

    return {
      duplicateLiveFacts, orphanVecRows, missingVecRows, orphanFactVecRows,
      missingFactVecRows, ftsMissing, ftsStale, caseVariantSubjects, total,
    };
  } catch (e) {
    return { ...EMPTY, total: 0, error: (e as Error).message };
  }
}

/** Thin-IO convenience for the CLI/maintain runner: open → check → close.
 *  MUST load the sqlite-vec extension — a plain connection cannot even read a
 *  vec0 virtual table ("no such module: vec0"), which would make every vector
 *  check silently report 0 (found the hard way; the test suite now guards it). */
export function checkConsistencyAt(dbPath: string): ConsistencyReport {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true, allowExtension: true });
    db.enableLoadExtension(true);
    sqliteVec.load(db);
  } catch (e) {
    return { ...EMPTY, total: 0, error: (e as Error).message };
  }
  try {
    return checkConsistency(db);
  } finally {
    db.close();
  }
}
