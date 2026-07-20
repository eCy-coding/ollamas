// Brain re-embed migrator (S23) — the drift REMEDIATION the probe only suggests.
// When the embedding model changes (or the space silently drifts), every stored
// vector is stale: recall ranks against a space the queries no longer live in.
// health() detects this (selfHitRate < 0.8 → "re-embed the store") but until now
// nothing could actually do it. This module rebuilds brain_vec + brain_fact_vec
// from the CANONICAL text columns (content / "subject predicate object") with an
// injected embedder, then flips brain_meta provider/dim LAST:
//   • vec0 tables are dimension-fixed → on any run they are DROP+CREATEd for the
//     new dim (same-dim runs too: a full rebuild is the point of the operation).
//   • meta flips only after EVERY row re-embedded — a mid-run crash leaves meta
//     on the old provider, so the next health() still flags drift and the
//     pre-flight backup (script guard) is the way back. No half-migrated "green".
//   • embed_cache rows for the old provider stay (keyed by provider, harmless)
//     and the new provider's entries repopulate organically.
import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";
import type { EmbedRole } from "./embed-contract";

/** F0: `role` selects the nomic task prefix. Optional so pre-F0 fakes stay assignable;
 *  reembedAll always passes "document" because it rebuilds stored content, not queries. */
export type EmbedFn = (text: string, role?: EmbedRole) => Promise<number[]>;

export interface ReembedPlan {
  memories: number;
  facts: number;
  fromProvider: string | null;
  fromDim: number | null;
}

export interface ReembedResult extends ReembedPlan {
  toProvider: string;
  toDim: number;
  dryRun: boolean;
}

const f32 = (v: number[]) => Buffer.from(new Float32Array(v).buffer);

export function openBrainDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  db.enableLoadExtension(true);
  sqliteVec.load(db);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
  return db;
}

/** What a run would touch — also the dry-run output. */
export function planReembed(db: DatabaseSync): ReembedPlan {
  const memories = Number((db.prepare("SELECT COUNT(*) AS n FROM brain_memories").get() as { n: number }).n);
  const facts = Number((db.prepare("SELECT COUNT(*) AS n FROM brain_facts").get() as { n: number }).n);
  const meta = (k: string) => {
    const r = db.prepare("SELECT v FROM brain_meta WHERE k=?").get(k) as { v?: string } | undefined;
    return r?.v ?? null;
  };
  const dim = meta("dim");
  return { memories, facts, fromProvider: meta("embed_provider"), fromDim: dim ? Number(dim) : null };
}

/**
 * Full vector-space rebuild. The embedder is probed once up front to learn the
 * target dim (and to fail FAST before anything is dropped). Batched so progress
 * is observable; throws on any row failure — partial state is safe by design
 * (meta unflipped → drift stays flagged → restore from the pre-flight backup).
 */
export async function reembedAll(
  db: DatabaseSync,
  embed: EmbedFn,
  opts: { provider: string; batchSize?: number; dryRun?: boolean; onProgress?: (done: number, total: number) => void },
): Promise<ReembedResult> {
  const plan = planReembed(db);
  // Probe BEFORE dropping anything — a dead embedder must abort a no-op.
  const probe = await embed("reembed dimension probe");
  if (!Array.isArray(probe) || probe.length === 0) throw new Error("embedder returned an empty vector");
  const toDim = probe.length;
  const base: ReembedResult = { ...plan, toProvider: opts.provider, toDim, dryRun: !!opts.dryRun };
  if (opts.dryRun) return base;

  const batchSize = Math.max(1, opts.batchSize ?? 32);
  const total = plan.memories + plan.facts;
  let done = 0;

  db.exec("DROP TABLE IF EXISTS brain_vec");
  db.exec(`CREATE VIRTUAL TABLE brain_vec USING vec0(embedding float[${toDim}])`);
  const memRows = db.prepare("SELECT rowid, content FROM brain_memories ORDER BY rowid").all() as { rowid: number; content: string }[];
  const insMem = db.prepare("INSERT INTO brain_vec(rowid, embedding) VALUES(?,?)");
  for (let i = 0; i < memRows.length; i += batchSize) {
    for (const r of memRows.slice(i, i + batchSize)) {
      // F0: stored memories are DOCUMENTS. Omitting the role defaults to "query" and
      // would re-embed the whole brain into the query subspace — recall would then
      // compare query-prefixed content against query-prefixed queries, silently
      // discarding the asymmetry nomic's prefixes exist to provide.
      const v = await embed(r.content, "document");
      if (v.length !== toDim) throw new Error(`memory rowid ${r.rowid}: dim ${v.length} != ${toDim}`);
      insMem.run(BigInt(r.rowid), f32(v));
      done++;
    }
    opts.onProgress?.(done, total);
  }

  db.exec("DROP TABLE IF EXISTS brain_fact_vec");
  db.exec(`CREATE VIRTUAL TABLE brain_fact_vec USING vec0(embedding float[${toDim}])`);
  const factRows = db
    .prepare("SELECT rowid, subject, predicate, object FROM brain_facts ORDER BY rowid")
    .all() as { rowid: number; subject: string; predicate: string; object: string }[];
  const insFact = db.prepare("INSERT INTO brain_fact_vec(rowid, embedding) VALUES(?,?)");
  for (let i = 0; i < factRows.length; i += batchSize) {
    for (const r of factRows.slice(i, i + batchSize)) {
      const v = await embed(`${r.subject} ${r.predicate} ${r.object}`, "document");
      if (v.length !== toDim) throw new Error(`fact rowid ${r.rowid}: dim ${v.length} != ${toDim}`);
      insFact.run(BigInt(r.rowid), f32(v));
      done++;
    }
    opts.onProgress?.(done, total);
  }

  // Atomic completion marker: provider+dim flip together, LAST (store idiom:
  // INSERT OR REPLACE, keys `embed_provider`/`dim` — the ones ensureProvider reads).
  const setMeta = db.prepare("INSERT OR REPLACE INTO brain_meta(k, v) VALUES(?,?)");
  db.exec("BEGIN");
  try {
    setMeta.run("embed_provider", opts.provider);
    setMeta.run("dim", String(toDim));
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  return base;
}
