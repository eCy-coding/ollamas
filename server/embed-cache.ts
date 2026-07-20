// Embed-cache (P1, 2026-07-18) — memoizes Embedder calls so brain recall/remember/
// dedup stop re-embedding identical text. Embeddings are deterministic per
// (provider, text), so entries never expire — size is bounded instead:
//   • in-mem LRU (default 512) for the hot path
//   • persistent `embed_cache` table (lives in the SAME db handle the caller owns,
//     e.g. brain.db — WAL + busy_timeout come for free), capped by sweep()
// Vectors persist as Float32 blobs — the exact precision brain_vec stores anyway,
// so a cached vector and a fresh one rank identically in KNN.
// Zero new deps (node:crypto + node:sqlite). Opt-out at the consumer (brain.ts:
// BRAIN_EMBED_CACHE=0).
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Embedder } from "./rag";
import type { EmbedRole } from "./embed-contract";

export interface EmbedCacheStats {
  memHits: number;
  dbHits: number;
  misses: number;
  memSize: number;
}

export interface EmbedCache {
  /** Wrap an embedder; the returned embedder is a drop-in Embedder. */
  wrap(embed: Embedder): Embedder;
  stats(): EmbedCacheStats;
  /** Cap persistent rows, evicting least-recently-accessed beyond `cap`. */
  sweep(opts?: { cap?: number }): { evicted: number };
}

const DEFAULT_MEM_CAPACITY = 512;
const DEFAULT_PERSIST_CAP = 5000;

export function createEmbedCache(opts: {
  db: DatabaseSync;
  provider: string;
  memCapacity?: number;
  now?: () => number;
}): EmbedCache {
  const { db, provider } = opts;
  const memCapacity = opts.memCapacity ?? DEFAULT_MEM_CAPACITY;
  const now = opts.now ?? Date.now;
  db.exec(`CREATE TABLE IF NOT EXISTS embed_cache (
    key TEXT PRIMARY KEY,
    dim INTEGER NOT NULL,
    vec BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    last_access INTEGER NOT NULL
  )`);

  // Map doubles as LRU: re-insertion moves a key to the tail, eviction pops the head.
  const mem = new Map<string, number[]>();
  let memHits = 0;
  let dbHits = 0;
  let misses = 0;

  // F0: role is part of the key. nomic's task prefixes make the document and query
  // embeddings of the SAME string different vectors; keying on text alone would serve
  // whichever was computed first to both callers — a silent, unrecoverable mix-up.
  const keyOf = (text: string, role: EmbedRole) =>
    createHash("sha256").update(provider).update("\x00").update(role).update("\x00").update(text).digest("hex");

  const lruSet = (key: string, vec: number[]) => {
    if (mem.has(key)) mem.delete(key);
    mem.set(key, vec);
    if (mem.size > memCapacity) {
      const oldest = mem.keys().next().value;
      if (oldest !== undefined) mem.delete(oldest);
    }
  };

  // Alignment-safe Float32 roundtrip: sqlite may hand back an offset view.
  const toBlob = (vec: number[]) => new Uint8Array(new Float32Array(vec).buffer);
  const fromBlob = (u8: Uint8Array, dim: number) => {
    const f = new Float32Array(dim);
    new Uint8Array(f.buffer).set(u8.subarray(0, dim * 4));
    return Array.from(f);
  };

  return {
    wrap(embed) {
      // Default MUST match contractEmbedder's default ("query") or a caller that omits
      // the role would cache under one key and embed under another prefix.
      return async (text: string, role: EmbedRole = "query") => {
        const key = keyOf(text, role);
        const hot = mem.get(key);
        if (hot) {
          memHits++;
          lruSet(key, hot);
          return hot;
        }
        const row = db.prepare("SELECT vec, dim FROM embed_cache WHERE key=?").get(key) as
          | { vec: Uint8Array; dim: number }
          | undefined;
        if (row) {
          dbHits++;
          db.prepare("UPDATE embed_cache SET last_access=? WHERE key=?").run(now(), key);
          const vec = fromBlob(row.vec, Number(row.dim));
          lruSet(key, vec);
          return vec;
        }
        misses++;
        const vec = await embed(text, role);
        const t = now();
        db.prepare(
          "INSERT OR REPLACE INTO embed_cache(key, dim, vec, created_at, last_access) VALUES(?,?,?,?,?)",
        ).run(key, vec.length, toBlob(vec), t, t);
        lruSet(key, vec);
        return vec;
      };
    },

    stats() {
      return { memHits, dbHits, misses, memSize: mem.size };
    },

    sweep({ cap = DEFAULT_PERSIST_CAP } = {}) {
      const r = db
        .prepare(
          `DELETE FROM embed_cache WHERE key IN (
             SELECT key FROM embed_cache ORDER BY last_access DESC, key LIMIT -1 OFFSET ?
           )`,
        )
        .run(cap);
      return { evicted: Number(r.changes) };
    },
  };
}
