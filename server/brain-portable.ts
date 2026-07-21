// Brain portability (S22) — versioned, vector-free JSON dump/restore. The binary
// backup (scripts/brain-backup.ts) assumes the same machine + same sqlite-vec build;
// this dump is the DR / machine-migration path: content + bi-temporal history travel,
// vectors are REBUILT through the normal embed path on import (embed_cache amortizes,
// and the target machine's provider/dim rules — a dump embeds correctly anywhere).
// All writes go through the BrainStore choke-point (remember/assertFact with the
// createdAt/hits/validFrom/invalidatedAt import overrides) — no duplicated SQL.
import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";
import type { BrainStore } from "./brain";

/** memory→memory nearest neighbors over a db at `dbPath` (stored-vector KNN, no re-embed).
 *  dbPath-scoped (unlike the singleton brainNeighbors) so the Obsidian sync links neighbors
 *  from the SAME db it is mirroring — including a test's temp store. Returns memId → memIds. */
export function neighborsFromDb(dbPath: string, k = 5): Map<string, string[]> {
  const out = new Map<string, string[]>();
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true, allowExtension: true });
    db.enableLoadExtension(true);
    sqliteVec.load(db);
  } catch { return out; }
  try {
    const mems = db.prepare("SELECT rowid, mem_id AS id FROM brain_memories WHERE superseded_at IS NULL").all() as { rowid: number; id: string }[];
    const idByRow = new Map<number, string>(mems.map((m) => [m.rowid, m.id]));
    const readVec = db.prepare("SELECT embedding FROM brain_vec WHERE rowid=?");
    const knn = db.prepare("SELECT rowid FROM brain_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?");
    for (const m of mems) {
      const vrow = readVec.get(BigInt(m.rowid)) as { embedding: Uint8Array } | undefined;
      if (!vrow) continue;
      const rows = knn.all(vrow.embedding, k + 1) as { rowid: number }[];
      const near = rows.map((r) => idByRow.get(r.rowid)).filter((id): id is string => !!id && id !== m.id).slice(0, k);
      if (near.length) out.set(m.id, near);
    }
  } catch { /* missing brain_vec (fresh/empty store) → no neighbors */ } finally {
    db.close();
  }
  return out;
}

export interface BrainDumpMemory {
  id: string;
  ns: string;
  tier: string;
  content: string;
  source: string | null;
  createdAt: number;
  hits: number;
}

export interface BrainDumpFact {
  subject: string;
  predicate: string;
  object: string;
  episodeId: string | null;
  ns: string;
  validFrom: number;
  invalidatedAt: number | null;
}

export interface BrainDump {
  version: 1;
  memories: BrainDumpMemory[];
  facts: BrainDumpFact[];
}

/** Read-only export: opens its own connection (WAL tolerates the live server). */
export function exportBrain(dbPath: string): BrainDump {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const memories = db
      .prepare(
        `SELECT mem_id AS id, ns, tier, content, source, created_at AS createdAt, access_count AS hits
         FROM brain_memories ORDER BY created_at, rowid`,
      )
      .all() as unknown as BrainDumpMemory[];
    const facts = db
      .prepare(
        `SELECT subject, predicate, object, episode_id AS episodeId, ns,
                valid_from AS validFrom, invalidated_at AS invalidatedAt
         FROM brain_facts ORDER BY valid_from, rowid`,
      )
      .all() as unknown as BrainDumpFact[];
    return { version: 1, memories, facts };
  } finally {
    db.close();
  }
}

export interface ImportReport {
  memories: { inserted: number; skipped: number; failed: number };
  facts: { inserted: number; skipped: number; failed: number };
  dryRun: boolean;
}

const isTier = (t: string): t is "core" | "learned" | "procedural" | "episodic" | "working" =>
  ["core", "learned", "procedural", "episodic", "working"].includes(t);

/**
 * Idempotent restore into a store. Existing memory ids are SKIPPED (an upsert would
 * reset heat and re-embed for nothing); facts are skipped when an identical row
 * (ns, subject, predicate, object, validFrom) already exists. Not transactional —
 * embedding is incremental by nature — but a failed run reports `failed` (script
 * exits 1) and a re-run completes exactly the missing rows.
 */
export async function importBrain(
  store: Pick<BrainStore, "remember" | "assertFact">,
  hasMemory: (id: string) => boolean,
  hasFact: (f: BrainDumpFact) => boolean,
  dump: BrainDump,
  opts: { dryRun?: boolean; onError?: (what: string, err: Error) => void } = {},
): Promise<ImportReport> {
  if (dump?.version !== 1) throw new Error(`unsupported dump version: ${String(dump?.version)}`);
  const report: ImportReport = {
    memories: { inserted: 0, skipped: 0, failed: 0 },
    facts: { inserted: 0, skipped: 0, failed: 0 },
    dryRun: !!opts.dryRun,
  };
  for (const m of dump.memories) {
    if (!isTier(m.tier)) { report.memories.failed++; opts.onError?.(`memory ${m.id}`, new Error(`bad tier ${m.tier}`)); continue; }
    if (hasMemory(m.id)) { report.memories.skipped++; continue; }
    if (opts.dryRun) { report.memories.inserted++; continue; }
    try {
      await store.remember({
        id: m.id, tier: m.tier, content: m.content,
        source: m.source ?? undefined, ns: m.ns, createdAt: m.createdAt, hits: m.hits,
      });
      report.memories.inserted++;
    } catch (e) {
      report.memories.failed++;
      opts.onError?.(`memory ${m.id}`, e as Error);
    }
  }
  // History rows first (verbatim inserts), then live facts in validFrom order so a
  // live re-assert never supersedes a row that is about to be imported as history.
  const ordered = [...dump.facts].sort((a, b) =>
    Number(a.invalidatedAt === null) - Number(b.invalidatedAt === null) || a.validFrom - b.validFrom);
  for (const f of ordered) {
    if (hasFact(f)) { report.facts.skipped++; continue; }
    if (opts.dryRun) { report.facts.inserted++; continue; }
    try {
      await store.assertFact({
        subject: f.subject, predicate: f.predicate, object: f.object,
        episodeId: f.episodeId ?? undefined, ns: f.ns,
        validFrom: f.validFrom, invalidatedAt: f.invalidatedAt ?? undefined,
      });
      report.facts.inserted++;
    } catch (e) {
      report.facts.failed++;
      opts.onError?.(`fact ${f.subject}|${f.predicate}`, e as Error);
    }
  }
  return report;
}

/** Existence probes for importBrain, bound to a db connection (read path only). */
export function makeExistenceProbes(db: DatabaseSync) {
  const memQ = db.prepare("SELECT 1 FROM brain_memories WHERE mem_id=? LIMIT 1");
  const factQ = db.prepare(
    "SELECT 1 FROM brain_facts WHERE ns=? AND subject=? AND predicate=? AND object=? AND valid_from=? LIMIT 1",
  );
  return {
    hasMemory: (id: string) => memQ.get(id) !== undefined,
    hasFact: (f: BrainDumpFact) => factQ.get(f.ns, f.subject, f.predicate, f.object, f.validFrom) !== undefined,
  };
}
