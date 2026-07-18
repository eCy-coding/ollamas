// Brain v1 (Tur 4) — tiered semantic memory + bi-temporal facts for the agent.
// Built on the exact rag.ts machinery (dedicated sqlite-vec DatabaseSync, injectable
// embedder, dim/provider guards) so the zero-new-dep and choke-point laws hold.
//
// Design lineage (docs/COMPLEMENTARY-REPOS research, 2026-07-16):
//   • agentmem blueprint — five memory tiers in ONE sqlite file, hybrid recall
//   • graphiti pattern  — facts as bi-temporal edges (valid_from / invalidated_at),
//     so "what is true now" and "what was true then" are both answerable
//   • Letta pattern     — the agent itself distills episodes and writes via tools
//     (brain_* in tool-registry.ts); no extra LLM wiring inside the store.
//
// Recall score = closeness × tier weight × recency. Closeness = 1/(1+distance);
// recency halves roughly every ~30 days so working notes fade and core facts persist.
import { DatabaseSync } from "node:sqlite";
import { statSync } from "node:fs";
import * as sqliteVec from "sqlite-vec";
import { type Embedder, embedText, resolveEmbedder } from "./rag";
import { createEmbedCache, type EmbedCache } from "./embed-cache";
import { llmActive } from "./gpu-coordinator";

export type MemoryTier = "core" | "procedural" | "learned" | "episodic" | "working";

/** Rank order is contractual: recall maths break if core stops outranking working. */
export const TIER_WEIGHT: Record<MemoryTier, number> = {
  core: 1.3,
  learned: 1.15,
  procedural: 1.1,
  episodic: 1.0,
  working: 0.9,
};

const TIERS = Object.keys(TIER_WEIGHT) as MemoryTier[];

export interface BrainMemoryInput {
  id?: string;
  tier: MemoryTier;
  content: string;
  source?: string;
  ns?: string;
  /** Epoch ms override for imports/migrations — recency decay must see the ORIGINAL
   *  event time, not the import time. Omit for live writes. */
  createdAt?: number;
  /** Access-count override for imports (S22) — heat feeds consolidate()/usageBoost,
   *  so a restore must not reset every memory to cold. Omit for live writes. */
  hits?: number;
  /** B5 multi-party attribution: who this memory is about/from (user id, agent name).
   *  Filterable at recall — prevents identity leakage across speakers. */
  actor?: string;
}

export interface BrainRecallHit {
  id: string;
  tier: MemoryTier;
  content: string;
  distance: number;
  score: number;
  createdAt: number;
  actor?: string | null;
  /** E1: set when the embedder was unavailable and this ranking came from the
   *  FTS/BM25 arm alone — still an answer, just keyword-grounded. */
  lexical?: boolean;
}

export interface BrainFactInput {
  subject: string;
  predicate: string;
  object: string;
  episodeId?: string;
  ns?: string;
  /** Epoch ms overrides for imports/migrations (S22) — bi-temporal history must
   *  survive a dump/restore verbatim. A fact arriving with `invalidatedAt` is a
   *  history row: inserted as-is, never superseding live facts. Omit for live use. */
  validFrom?: number;
  invalidatedAt?: number;
}

export interface BrainFact extends BrainFactInput {
  validFrom: number;
  invalidatedAt: number | null;
}

export interface Extraction {
  memories: { tier: MemoryTier; content: string }[];
  facts: BrainFactInput[];
}

export interface BrainStore {
  /** `deferred` = the embedder was contended: the row is durable (FTS-indexed) but its
   *  vector arrives via backfillEmbeddings(). dim is 0 for a deferred write. */
  remember(m: BrainMemoryInput): Promise<{ id: string; dim: number; merged?: boolean; deferred?: boolean; revised?: string[] }>;
  /** Write-behind drain: embed pending rows in small batches; aborts on the first
   *  failure (embedder still busy) and retries next maintain pass. GPU-gated (Tur-4):
   *  defers entirely while a local generation is active, unless the pending queue
   *  exceeds BRAIN_BACKFILL_BOUNDARY (starvation guard). Returns rows indexed. */
  backfillEmbeddings(opts?: { limit?: number }): Promise<number>;
  /** B4 right-to-be-forgotten: deterministic ns-scoped substring purge (row+vector+fts),
   *  recorded in the audit ledger. */
  forget(opts: { contains: string; ns?: string }): { forgotten: number };
  /** B3 audit ledger tail — append-only mutation history (remember/merge/revise/forget). */
  auditTail(limit?: number): { ts: number; action: string; memId: string | null; detail: string }[];
  /** `fresh` bypasses the embed cache (P1) — the drift probe needs the LIVE embedding
   *  space; a cached vector would mask a silent model swap. `graphExpand` (P3) adds a
   *  third RRF arm: memories mentioning entities from semantically-near facts (1-hop). */
  recall(query: string, opts?: { k?: number; tier?: MemoryTier; ns?: string; fresh?: boolean; graphExpand?: boolean; minScore?: number; actor?: string; since?: number; until?: number }): Promise<BrainRecallHit[]>;
  assertFact(f: BrainFactInput): Promise<{ changed: boolean; invalidated: number }>;
  /** S42: episodes ↔ sessions reverse link — every memory a distill/ingest wrote
   *  for a session carries source=episodeId(=sessionId). */
  memoriesBySource(source: string, opts?: { limit?: number }): { id: string; tier: MemoryTier; content: string; ns: string; createdAt: number }[];
  /** S49: namespaces present in the store (admin cross-ns recall fans over these). */
  listNamespaces(): string[];
  factsAbout(subject: string, opts?: { ns?: string; at?: number }): BrainFact[];
  /** Semantic fact search (v2): KNN over embedded "subject predicate object" strings,
   *  filtered to facts VALID at `at` (default now) — history stays searchable. */
  searchFacts(query: string, opts?: { k?: number; ns?: string; at?: number }): Promise<(BrainFact & { distance: number })[]>;
  /** Forgetting (v2): delete working-tier memories older than the TTL. Also caps
   *  the persistent embed cache (P1, BRAIN_EMBED_CACHE_CAP, default 5000) and
   *  importance-prunes cold episodic/working rows (P4): importance =
   *  tier_weight × tierRecency × usageBoost; below the threshold the row falls off.
   *  core/learned/procedural are NEVER auto-pruned. BRAIN_PRUNE=0 opts out. */
  sweep(opts?: { workingTtlMs?: number; pruneThreshold?: number }): { swept: number; pruned?: number; factsPruned?: number; embedEvicted?: number; supersededPruned?: number };
  /** Consolidation (v2+v3): promote hot episodic memories to learned, then merge
   *  duplicate learned contents (normalized) into the oldest row, summing hits. */
  consolidate(opts?: { minAccess?: number }): { promoted: number; merged: number };
  /** Drift probe (v3): recall each recent learned/core memory by its own content —
   *  top-1 must be itself. selfHitRate below the threshold ⇒ the embedding space
   *  no longer matches the stored vectors (model swap/decay). Report-only. */
  health(opts?: { probes?: number; threshold?: number }): Promise<{ selfHitRate: number; drift: boolean; probes: number }>;
  ingest(batch: { episodeId: string; memories?: Extraction["memories"]; facts?: BrainFactInput[]; ns?: string }): Promise<{ memories: number; facts: number }>;
  stats(): {
    memories: Record<MemoryTier, number>;
    facts: number;
    factsSuperseded: number;
    namespaces: number;
    embedCacheRows: number;
    dbBytes: number;
  };
  /** One read-only bundle for the admin panel / viewer: stats + recent memories +
   *  live facts + superseded history + a drift-probe health snapshot. */
  overview(opts?: { recent?: number }): Promise<BrainOverview>;
  /** Entity graph (V1) for the namespace: live facts + recent superseded, reified into
   *  nodes/edges with degree centrality. Feeds the live brain map. */
  graph(opts?: { ns?: string; at?: number; limit?: number }): Promise<BrainGraph>;
  close(): void;
}

export interface BrainOverview {
  stats: { memories: Record<MemoryTier, number>; facts: number; namespaces: number; dbBytes: number };
  memories: { id: string; tier: MemoryTier; content: string; hits: number; createdAt: number }[];
  facts: { subject: string; predicate: string; object: string; episodeId: string | null }[];
  history: { subject: string; predicate: string; object: string; invalidatedAt: number }[];
  health: { selfHitRate: number; drift: boolean; probes: number; degraded?: boolean };
}

const f32 = (v: number[]) => new Uint8Array(new Float32Array(v).buffer);
const DEFAULT_NS = "default";

export interface GraphNode { id: string; label: string; degree: number; live: boolean }
export interface GraphEdge { source: string; target: string; predicate: string; live: boolean }
export interface BrainGraph { nodes: GraphNode[]; edges: GraphEdge[] }

/** Entity reification (V1, 2026 SOTA graph memory) — fold flat bi-temporal S-P-O facts
 *  into an entity graph: distinct subjects/objects become nodes, predicates become edges,
 *  and degree (incident edge count) is a cheap centrality/importance signal. A node is
 *  `live` if it touches at least one non-invalidated fact. id is case-normalized (so
 *  "Emre"=="emre"), label keeps the first-seen original casing. */
export function buildGraph(facts: BrainFact[]): BrainGraph {
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const touch = (raw: string, live: boolean) => {
    const id = raw.toLowerCase().trim();
    const n = nodes.get(id);
    if (!n) nodes.set(id, { id, label: raw, degree: 1, live });
    else { n.degree++; n.live = n.live || live; }
    return id;
  };
  for (const f of facts) {
    const live = f.invalidatedAt == null;
    const s = touch(f.subject, live);
    const o = touch(f.object, live);
    edges.push({ source: s, target: o, predicate: f.predicate, live });
  }
  return { nodes: [...nodes.values()], edges };
}

/** Sanitize a natural-language query into a safe FTS5 MATCH expression: keep alnum
 *  tokens, OR them, drop punctuation/operators that would be parsed as FTS5 syntax. */
// Dalga-7 root-fix: question filler ("nedir", "hangi", "what", "how") matches
// EVERYTHING in a Turkish/English store and drowns the real keyword's BM25 rank —
// the cold-embedder lexical arm kept returning noise for exactly this reason.
const FTS_STOPWORDS = new Set([
  "nedir", "nasıl", "nasil", "hangi", "neden", "niye", "için", "icin", "gibi", "daha",
  "çok", "cok", "şu", "su", "bu", "ne", "ile", "ve", "veya", "ama", "mi", "mı", "mu",
  "zaman", "kullanılır", "kullanilir", "yapılır", "yapilir", "olur", "var", "yok",
  "what", "how", "which", "why", "when", "the", "is", "are", "does", "do", "a", "an",
  "of", "to", "in", "and", "or", "it", "for",
]);
export function ftsQuery(q: string): string {
  const tokens = (q.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []).slice(0, 16);
  if (tokens.length === 0) throw new Error("no searchable tokens");
  const meaty = tokens.filter((t) => !FTS_STOPWORDS.has(t));
  // An all-filler query ("nedir bu?") keeps legacy behavior — an empty MATCH would throw.
  return (meaty.length ? meaty : tokens).map((t) => `"${t}"`).join(" OR ");
}

/** Reciprocal Rank Fusion (W1, 2026 hybrid retrieval) — fuse N ranked id lists by
 *  rank position alone, sidestepping vector/BM25 score incompatibility. An id ranked
 *  by MULTIPLE retrievers rises. k0=60 is the standard damping constant. Returns top-k ids. */
export function rrfFuseMany(lists: string[][], k: number, k0 = 60): string[] {
  const score = new Map<string, number>();
  for (const list of lists) {
    list.forEach((id, i) => score.set(id, (score.get(id) ?? 0) + 1 / (k0 + i + 1)));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, k).map(([id]) => id);
}

export function rrfFuse(vecRanked: string[], ftsRanked: string[], k: number, k0 = 60): string[] {
  return rrfFuseMany([vecRanked, ftsRanked], k, k0);
}

/** Recency half-life is a TIER property (P3): a scratchpad note goes stale in a day,
 *  a verified lesson stays relevant for months, identity never decays. Multiplier is
 *  1.0 fresh → 0.5 at one half-life → asymptotically small. */
export const TIER_HALF_LIFE_DAYS: Record<MemoryTier, number> = {
  core: Infinity,
  learned: 90,
  procedural: 90,
  episodic: 7,
  working: 1,
};

export const tierRecency = (createdAt: number, now: number, tier: MemoryTier) => {
  const halfLife = TIER_HALF_LIFE_DAYS[tier];
  if (!Number.isFinite(halfLife)) return 1;
  const ageDays = Math.max(0, now - createdAt) / 86_400_000;
  return 1 / (1 + ageDays / halfLife);
};

/** Usage reinforcement (P3): often-recalled memories rank higher. Bounded at +12% —
 *  strictly below the smallest adjacent tier-weight ratio (core/learned = 1.13) — so
 *  no amount of heat lets a lower tier outrank a higher one at equal distance+recency.
 *  The tier ORDER contract stays intact. */
export const usageBoost = (hits: number) => 1 + 0.12 * (1 - 1 / (1 + Math.log1p(Math.max(0, hits))));

export function createBrainStore(
  opts: { dbPath?: string; embed?: Embedder; embedProvider?: string; now?: () => number; workingCap?: number; llmActive?: () => boolean } = {},
): BrainStore {
  const workingCap = opts.workingCap ?? 64;
  const dbPath = opts.dbPath || process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;
  const rawEmbed = opts.embed || embedText;
  const embedProvider = opts.embedProvider || "ollama-local";
  const now = opts.now || Date.now;
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  db.enableLoadExtension(true);
  sqliteVec.load(db);
  // Concurrency (T1): WAL lets a reader (viewer, admin panel, another store handle)
  // run alongside a writer without "database is locked"; busy_timeout retries a
  // transient lock instead of throwing. Without these, any concurrent access crashed.
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");
  // P1 embed-cache: identical text is embedded once per provider (recall, dedup and
  // retain re-embed the same strings constantly). Deterministic → no TTL, size-capped
  // in sweep(). BRAIN_EMBED_CACHE=0 opts out.
  const embedCache: EmbedCache | null =
    process.env.BRAIN_EMBED_CACHE !== "0" ? createEmbedCache({ db, provider: embedProvider, now }) : null;
  const embed = embedCache ? embedCache.wrap(rawEmbed) : rawEmbed;
  // Per-write embed budget: the write path never waits on the embedder longer than
  // BRAIN_EMBED_WRITE_TIMEOUT_MS (default 4s). A timed-out embed keeps running in the
  // background and lands in the embed cache — the later backfill then hits it for free.
  const embedWithBudget = (text: string): Promise<number[]> => {
    const ms = Number(process.env.BRAIN_EMBED_WRITE_TIMEOUT_MS) || 4000;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`embed timed out after ${ms}ms`)), ms);
      (t as { unref?: () => void }).unref?.();
      embed(text).then(
        (v) => { clearTimeout(t); resolve(v); },
        (e) => { clearTimeout(t); reject(e); },
      );
    });
  };
  db.exec(`CREATE TABLE IF NOT EXISTS brain_memories (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    mem_id TEXT UNIQUE NOT NULL,
    tier TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT,
    ns TEXT NOT NULL DEFAULT '${DEFAULT_NS}',
    created_at INTEGER NOT NULL,
    last_access INTEGER,
    access_count INTEGER NOT NULL DEFAULT 0
  )`);
  // v1 → v2 migration: columns may be missing on an existing brain.db.
  // pending_embed (write-behind): 1 = durable row awaiting its vector (embedder was
  // contended at write time); backfillEmbeddings() indexes it when the embedder frees up.
  // superseded_at (belief revision, Tur-5): a memory contradicted by a later write is
  // invalidated bi-temporally — recall filters it, history keeps it, sweep prunes it.
  for (const col of ["last_access INTEGER", "access_count INTEGER NOT NULL DEFAULT 0", "pending_embed INTEGER NOT NULL DEFAULT 0", "superseded_at INTEGER", "actor TEXT"]) {
    try { db.exec(`ALTER TABLE brain_memories ADD COLUMN ${col}`); } catch { /* already there */ }
  }
  db.exec(`CREATE TABLE IF NOT EXISTS brain_facts (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    subject TEXT NOT NULL,
    predicate TEXT NOT NULL,
    object TEXT NOT NULL,
    episode_id TEXT,
    ns TEXT NOT NULL DEFAULT '${DEFAULT_NS}',
    valid_from INTEGER NOT NULL,
    invalidated_at INTEGER
  )`);
  db.exec(`CREATE INDEX IF NOT EXISTS brain_facts_sp ON brain_facts(ns, subject, predicate)`);
  db.exec(`CREATE TABLE IF NOT EXISTS brain_meta (k TEXT PRIMARY KEY, v TEXT)`);
  // B3 audit ledger (2026 gap-audit): append-only record of every mutation the
  // store performs — remember/merge/revise/forget. Read via auditTail(); never
  // updated or deleted in place.
  db.exec(`CREATE TABLE IF NOT EXISTS brain_audit (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    action TEXT NOT NULL,
    mem_id TEXT,
    detail TEXT
  )`);

  // W1 hybrid retrieval: an FTS5 keyword index over content, keyed by the memory rowid
  // (unindexed, so it is stored but not tokenized). Feature-detected — if this SQLite
  // build lacks FTS5, recall gracefully stays vector-only. Backfilled for v1-v3 dbs by
  // copying any existing rows on first open.
  let hasFts = false;
  try {
    db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS brain_fts USING fts5(content, mem_rowid UNINDEXED)");
    const ftsCount = (db.prepare("SELECT COUNT(*) AS n FROM brain_fts").get() as { n: number }).n;
    const memCount = (db.prepare("SELECT COUNT(*) AS n FROM brain_memories").get() as { n: number }).n;
    if (ftsCount === 0 && memCount > 0) {
      const ins = db.prepare("INSERT INTO brain_fts(content, mem_rowid) VALUES(?,?)");
      for (const r of db.prepare("SELECT rowid, content FROM brain_memories").all() as { rowid: number; content: string }[]) {
        ins.run(r.content, r.rowid);
      }
    }
    hasFts = true;
  } catch { hasFts = false; }

  const readDim = () => {
    const r = db.prepare("SELECT v FROM brain_meta WHERE k='dim'").get() as { v?: string } | undefined;
    return r?.v ? Number(r.v) : null;
  };
  let dim: number | null = readDim();
  // A store handle opened before the first write caches dim=null; another connection
  // (writer) may set it since. Re-read lazily so a long-lived reader picks it up.
  const refreshDim = () => { if (dim === null) dim = readDim(); return dim; };

  // Same consistency discipline as rag.ts: an index is bound to the provider that built it.
  const ensureProvider = () => {
    const r = db.prepare("SELECT v FROM brain_meta WHERE k='embed_provider'").get() as { v?: string } | undefined;
    if (!r?.v) {
      db.prepare("INSERT OR REPLACE INTO brain_meta(k,v) VALUES('embed_provider',?)").run(embedProvider);
      return;
    }
    if (r.v !== embedProvider) {
      throw new Error(
        `brain embed provider mismatch: store built with '${r.v}', current resolves to '${embedProvider}' ` +
        `(pin EMBED_PROVIDER=${r.v} or re-create the brain db to switch)`,
      );
    }
  };

  const ensureVec = (d: number) => {
    if (dim === null) {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS brain_vec USING vec0(embedding float[${d}])`);
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS brain_fact_vec USING vec0(embedding float[${d}])`);
      db.prepare("INSERT OR REPLACE INTO brain_meta(k,v) VALUES('dim',?)").run(String(d));
      dim = d;
    } else if (dim !== d) {
      throw new Error(`brain embedding dim mismatch: store=${dim} got=${d} (re-create the brain db to change models)`);
    } else {
      // v1 → v2: a v1 store has brain_vec but not brain_fact_vec yet.
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS brain_fact_vec USING vec0(embedding float[${d}])`);
    }
  };

  const deleteMemRow = (rowid: number) => {
    db.prepare("DELETE FROM brain_vec WHERE rowid=?").run(BigInt(rowid));
    if (hasFts) db.prepare("DELETE FROM brain_fts WHERE mem_rowid=?").run(BigInt(rowid));
    db.prepare("DELETE FROM brain_memories WHERE rowid=?").run(BigInt(rowid));
  };

  const audit = (action: string, memId: string | null, detail: string) => {
    try {
      db.prepare("INSERT INTO brain_audit(ts, action, mem_id, detail) VALUES(?,?,?,?)").run(now(), action, memId, detail);
    } catch { /* the ledger must never break the operation it records */ }
  };

  const rememberOne = async (m: BrainMemoryInput): Promise<{ id: string; dim: number; merged?: boolean; deferred?: boolean; revised?: string[] }> => {
    if (!TIERS.includes(m.tier)) throw new Error(`invalid tier '${m.tier}' (${TIERS.join("/")})`);
    if (!m.content?.trim()) throw new Error("empty memory content");
    // S24 redaction gate — the ONE enforcement point every write path funnels
    // through (retain, distill, git-capture, org-mirror, ingest, import, HTTP).
    // Enforce mode persists AND embeds the masked text: the vector of a secret is
    // itself a leak surface. Detection reuses the repo-wide interceptor rules.
    const { redactForBrain } = await import("./brain-redact");
    const red = redactForBrain(m.content);
    if (red.hits > 0) {
      console.warn(JSON.stringify({
        event: "brain.redact", mode: red.mode, hits: red.hits, tier: m.tier, source: m.source ?? null,
      }));
    }
    const content = red.text;
    ensureProvider();
    const explicitId = !!m.id;
    const id = m.id || `mem-${crypto.randomUUID()}`;
    const ns = m.ns || DEFAULT_NS;
    // Write-behind (Tur-3 research): a contended embedder (chat LLM holding VRAM) must
    // not lose the memory. The write embeds within BRAIN_EMBED_WRITE_TIMEOUT_MS
    // (default 4s); past that the row lands durably WITHOUT a vector (FTS still indexes
    // it → the hybrid recall's BM25 arm finds it at neutral distance) and
    // backfillEmbeddings() adds the vector later. BRAIN_DEFER_EMBED=0 → fail-fast.
    const deferOn = process.env.BRAIN_DEFER_EMBED !== "0";
    let vec: number[] | null = null;
    try {
      vec = await embedWithBudget(content);
    } catch (e) {
      if (!deferOn) throw e;
    }
    if (vec) ensureVec(vec.length);

    // W2 semantic write-dedup (AUDN-lite): for an AUTO-id write (no explicit id), if a
    // near-duplicate already exists in the same ns+tier, MERGE into it instead of adding
    // a polluting row. Core is exempt (identity/preference must never silently collapse).
    // Disable with BRAIN_DEDUP=0. Explicit ids keep exact-upsert semantics.
    const dedupOn = process.env.BRAIN_DEDUP !== "0" && !explicitId && m.tier !== "core" && dim !== null;
    if (dedupOn && vec) {
      const maxDist = Number(process.env.BRAIN_DEDUP_DISTANCE) || 0.08; // ≈ cosine 0.92
      const near = db
        .prepare(
          `SELECT m.rowid AS rowid, m.content AS content, m.access_count AS hits, v.distance AS distance
           FROM (SELECT rowid, distance FROM brain_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 8) v
           JOIN brain_memories m ON m.rowid = v.rowid
           WHERE m.ns=? AND m.tier=? AND m.superseded_at IS NULL`,
        )
        .all(f32(vec), ns, m.tier) as { rowid: number; content: string; hits: number; distance: number }[];
      const dup = near.find((r) => r.distance <= maxDist);
      if (dup) {
        // Keep the richer (longer) content; bump heat. No new row → recall stays clean.
        const keepContent = content.length > dup.content.length ? content : dup.content;
        db.prepare("UPDATE brain_memories SET content=?, access_count=access_count+1, last_access=? WHERE rowid=?")
          .run(keepContent, now(), BigInt(dup.rowid));
        if (hasFts) {
          db.prepare("DELETE FROM brain_fts WHERE mem_rowid=?").run(BigInt(dup.rowid));
          db.prepare("INSERT INTO brain_fts(content, mem_rowid) VALUES(?,?)").run(keepContent, BigInt(dup.rowid));
        }
        const keepId = (db.prepare("SELECT mem_id FROM brain_memories WHERE rowid=?").get(BigInt(dup.rowid)) as { mem_id: string }).mem_id;
        audit("merge", keepId, `near-dup absorbed (${m.tier}/${ns})`);
        return { id: keepId, dim: vec.length, merged: true };
      }
    }

    // Tur-5 belief revision: an auto-id write carrying a negation/change signal
    // supersedes near, entity-anchored memories (bi-temporal — recall filters them,
    // history keeps them, sweep prunes them after a TTL). Core is untouchable,
    // explicit-id operator writes don't revise, deferred writes have no vector to
    // measure nearness with. BRAIN_REVISION=0 opts out.
    const revised: string[] = [];
    if (
      process.env.BRAIN_REVISION !== "0" && !explicitId && vec && dim !== null &&
      m.tier !== "core" && contradictionSignal(content)
    ) {
      const maxDist = Number(process.env.BRAIN_REVISION_DISTANCE) || 0.4;
      const near = db
        .prepare(
          `SELECT m.rowid AS rowid, m.mem_id AS id, m.content AS content, v.distance AS distance
           FROM (SELECT rowid, distance FROM brain_vec WHERE embedding MATCH ? ORDER BY distance LIMIT 8) v
           JOIN brain_memories m ON m.rowid = v.rowid
           WHERE m.ns=? AND m.tier!='core' AND m.superseded_at IS NULL`,
        )
        .all(f32(vec), ns) as { rowid: number; id: string; content: string; distance: number }[];
      for (const r of near) {
        if (r.distance <= maxDist && entityOverlap(content, r.content) >= 1) {
          db.prepare("UPDATE brain_memories SET superseded_at=? WHERE rowid=?").run(now(), BigInt(r.rowid));
          audit("revise", r.id, `superseded by ${id}`);
          revised.push(r.id);
        }
      }
    }

    const prior = db.prepare("SELECT rowid FROM brain_memories WHERE mem_id=?").get(id) as { rowid?: number } | undefined;
    if (prior?.rowid !== undefined) deleteMemRow(prior.rowid);
    const ins = db
      .prepare("INSERT INTO brain_memories(mem_id, tier, content, source, ns, created_at, access_count, pending_embed, actor) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id, m.tier, content, m.source ?? null, ns, m.createdAt ?? now(), m.hits ?? 0, vec ? 0 : 1, m.actor ?? null);
    const rowid = BigInt(ins.lastInsertRowid);
    if (vec) db.prepare("INSERT INTO brain_vec(rowid, embedding) VALUES(?,?)").run(rowid, f32(vec));
    if (hasFts) db.prepare("INSERT INTO brain_fts(content, mem_rowid) VALUES(?,?)").run(content, rowid);
    // v3 ring buffer: working is a bounded scratchpad — beyond the cap, the oldest
    // working rows in this namespace fall off (their vectors + fts too).
    if (m.tier === "working") {
      const over = db
        .prepare(
          "SELECT rowid FROM brain_memories WHERE tier='working' AND ns=? ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET ?",
        )
        .all(ns, workingCap) as { rowid: number }[];
      for (const r of over) deleteMemRow(r.rowid);
    }
    audit("remember", id, `${m.tier}/${ns}${vec ? "" : " deferred"}`);
    return vec
      ? { id, dim: vec.length, ...(revised.length ? { revised } : {}) }
      : { id, dim: 0, deferred: true };
  };

  return {
    remember: rememberOne,

    async recall(query, { k = 5, tier, ns, fresh, graphExpand, minScore, actor, since, until } = {}) {
      // B1 abstention (2026 gap-audit): an ungrounded answer is worse than none.
      // Hits scoring below the threshold are dropped — an empty result tells the
      // caller to say "I don't know" instead of hallucinating from distant noise.
      const scoreFloor = minScore ?? (Number(process.env.BRAIN_RECALL_MIN_SCORE) || 0);
      ensureProvider();
      if (refreshDim() === null) return []; // nothing remembered yet (re-reads for concurrent writers)
      // E1 — recall never goes silent: a contended embedder degrades the VECTOR arm,
      // not the whole answer. The FTS/BM25 arm needs no embedding. fresh (drift probe)
      // keeps fail-fast semantics — a lexical probe would fake self-hit health.
      let vec: number[] | null = null;
      if (fresh) vec = await rawEmbed(query);
      else {
        try {
          vec = await embedWithBudget(query);
        } catch { /* lexical-only fallback below */ }
      }
      if (vec) ensureVec(vec.length);
      const over = k * 4 + 16;
      // W1 hybrid: vector KNN candidates ∪ FTS5 BM25 candidates, fused by RRF. FTS surfaces
      // keyword/id matches the embedder misses; the vector arm keeps semantic recall.
      const vecRows = !vec ? [] as (BrainRecallHit & { ns: string; rowid: number; hits: number })[] : db
        .prepare(
          `SELECT m.rowid AS rowid, m.mem_id AS id, m.tier AS tier, m.content AS content, m.created_at AS createdAt,
                  v.distance AS distance, m.ns AS ns, m.access_count AS hits, m.actor AS actor
           FROM (SELECT rowid, distance FROM brain_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?) v
           JOIN brain_memories m ON m.rowid = v.rowid
           WHERE m.superseded_at IS NULL`,
        )
        .all(f32(vec), over) as unknown as (BrainRecallHit & { ns: string; rowid: number; hits: number })[];
      const memFts = (q: string, limit: number): string[] => {
        try {
          const rows = db
            .prepare(
              `SELECT m.mem_id AS id FROM brain_fts f JOIN brain_memories m ON m.rowid = f.mem_rowid
               WHERE brain_fts MATCH ? AND m.superseded_at IS NULL ORDER BY f.rank LIMIT ?`,
            )
            .all(ftsQuery(q), limit) as { id: string }[];
          return rows.map((r) => r.id);
        } catch { return []; } // malformed FTS query (e.g. only punctuation) → skip this arm
      };
      const ftsIds: string[] = hasFts ? memFts(query, over) : [];
      // P3 graph expansion (opt-in): 1-hop over the fact graph — semantically-near facts
      // name entities; memories MENTIONING those entities become a third RRF arm. Widens
      // the candidate set beyond what the query's own vector/keywords can reach.
      let graphIds: string[] = [];
      if (graphExpand && hasFts && vec) {
        const seeds: (BrainFact & { distance: number })[] = await this.searchFacts(query, { k: 4, ns });
        const entities = [...new Set(seeds.flatMap((f) => [f.subject, f.object]).map((e) => e.toLowerCase().trim()))].slice(0, 6);
        graphIds = entities.flatMap((e) => memFts(e, 3));
      }
      // Attach any FTS/graph-only hits (not already in the vector set) so RRF can rank them.
      const byId = new Map(vecRows.map((r) => [r.id, r]));
      const missing = [...new Set([...ftsIds, ...graphIds])].filter((id) => !byId.has(id));
      if (missing.length) {
        const ph = missing.map(() => "?").join(",");
        const extra = db
          .prepare(
            `SELECT m.mem_id AS id, m.tier AS tier, m.content AS content, m.created_at AS createdAt, m.ns AS ns,
                    m.access_count AS hits, m.actor AS actor
             FROM brain_memories m WHERE m.mem_id IN (${ph}) AND m.superseded_at IS NULL`,
          )
          .all(...missing) as unknown as (BrainRecallHit & { ns: string; hits: number })[];
        for (const r of extra) byId.set(r.id, { ...r, distance: 1 } as any); // no vector distance → neutral
      }
      const lists = [vecRows.map((r) => r.id), ftsIds, graphIds].filter((l) => l.length > 0);
      const fusedIds = lists.length > 1 ? rrfFuseMany(lists, over) : (lists[0] ?? []);
      const rows = fusedIds.map((id) => byId.get(id)).filter(Boolean) as (BrainRecallHit & { ns: string; hits: number })[];
      const t = now();
      const scored = rows
        .filter((r) => (!tier || r.tier === tier) && r.ns === (ns || DEFAULT_NS))
        .filter((r) => !actor || (r as any).actor === actor)
        .filter((r) => (since === undefined || r.createdAt >= since) && (until === undefined || r.createdAt <= until))
        .map((r) => ({
          id: r.id,
          tier: r.tier,
          content: r.content,
          distance: r.distance,
          createdAt: r.createdAt,
          actor: (r as any).actor ?? null,
          ...(vec ? {} : { lexical: true as const }),
          score:
            (1 / (1 + r.distance)) * TIER_WEIGHT[r.tier] * tierRecency(r.createdAt, t, r.tier) * usageBoost(r.hits ?? 0),
        }))
        .sort((a, b) => b.score - a.score)
        .filter((r) => r.score >= scoreFloor);
      let hits = scored.slice(0, k);
      // B5 rerank (opt-in, BRAIN_RERANK=1): the local $0 cross-encoder (server/rerank.ts)
      // re-orders a wider pool than k before the cut. Fixture eval measured +0.66 MRR@5;
      // brain adoption stays evidence-gated on eval-brain-mrr. rerankCandidates degrades
      // gracefully, and the model download makes this unsuitable for the default gate —
      // hence opt-in, never on in tests.
      if (process.env.BRAIN_RERANK === "1" && scored.length > 1) {
        try {
          const { rerankCandidates } = await import("./rerank");
          const pool = scored.slice(0, Math.max(k * 3, 12)).map((h) => ({ ...h, text: h.content }));
          hits = (await rerankCandidates(query, pool, { topN: k })).map(({ text: _t, ...h }) => h);
        } catch { /* rerank is a quality bonus, never a blocker */ }
      }
      // v2: access accounting feeds consolidate() — recalled memories get hotter.
      const bump = db.prepare("UPDATE brain_memories SET access_count=access_count+1, last_access=? WHERE mem_id=?");
      for (const h of hits) bump.run(t, h.id);
      return hits;
    },

    async assertFact(f) {
      if (!f.subject?.trim() || !f.predicate?.trim() || !f.object?.trim()) {
        throw new Error("fact needs subject, predicate and object");
      }
      const ns = f.ns || DEFAULT_NS;
      const t = now();
      const validFrom = f.validFrom ?? t;
      // Historical import path (S22): a fact that arrives ALREADY invalidated is a
      // bi-temporal history row — insert verbatim, never supersede anything (the live
      // supersede chain belongs to live assertions only).
      if (f.invalidatedAt !== undefined) {
        ensureProvider();
        const histVec = await embed(`${f.subject} ${f.predicate} ${f.object}`);
        ensureVec(histVec.length);
        const histIns = db.prepare(
          "INSERT INTO brain_facts(subject, predicate, object, episode_id, ns, valid_from, invalidated_at) VALUES(?,?,?,?,?,?,?)",
        ).run(f.subject, f.predicate, f.object, f.episodeId ?? null, ns, validFrom, f.invalidatedAt);
        db.prepare("INSERT INTO brain_fact_vec(rowid, embedding) VALUES(?,?)").run(BigInt(histIns.lastInsertRowid), f32(histVec));
        return { changed: true, invalidated: 0 };
      }
      const current = db
        .prepare(
          "SELECT rowid, object FROM brain_facts WHERE ns=? AND subject=? AND predicate=? AND invalidated_at IS NULL",
        )
        .all(ns, f.subject, f.predicate) as { rowid: number; object: string }[];
      if (current.some((c) => c.object === f.object)) return { changed: false, invalidated: 0 };
      // Graphiti move: the new assertion supersedes every live fact on this (subject, predicate).
      let invalidated = 0;
      for (const c of current) {
        db.prepare("UPDATE brain_facts SET invalidated_at=? WHERE rowid=?").run(t, BigInt(c.rowid));
        invalidated++;
      }
      ensureProvider();
      // v2: facts are embedded ("subject predicate object") for semantic search. The
      // vector stays after invalidation so point-in-time search still works.
      const vec = await embed(`${f.subject} ${f.predicate} ${f.object}`);
      ensureVec(vec.length);
      const ins = db.prepare(
        "INSERT INTO brain_facts(subject, predicate, object, episode_id, ns, valid_from) VALUES(?,?,?,?,?,?)",
      ).run(f.subject, f.predicate, f.object, f.episodeId ?? null, ns, validFrom);
      db.prepare("INSERT INTO brain_fact_vec(rowid, embedding) VALUES(?,?)").run(BigInt(ins.lastInsertRowid), f32(vec));
      return { changed: true, invalidated };
    },

    async searchFacts(query, { k = 5, ns, at } = {}) {
      ensureProvider();
      if (refreshDim() === null) return []; // nothing embedded yet (re-reads for concurrent writers)
      const vec = await embed(query);
      ensureVec(vec.length);
      const t = at ?? now();
      const rows = db
        .prepare(
          `SELECT f.subject AS subject, f.predicate AS predicate, f.object AS object,
                  f.episode_id AS episodeId, f.ns AS ns, f.valid_from AS validFrom,
                  f.invalidated_at AS invalidatedAt, v.distance AS distance
           FROM (SELECT rowid, distance FROM brain_fact_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?) v
           JOIN brain_facts f ON f.rowid = v.rowid
           WHERE f.ns=? AND f.valid_from<=? AND (f.invalidated_at IS NULL OR f.invalidated_at>?)
           ORDER BY v.distance
           LIMIT ?`,
        )
        .all(f32(vec), k * 4 + 16, ns || DEFAULT_NS, t, t, k) as unknown as (BrainFact & { distance: number })[];
      return rows;
    },

    forget({ contains, ns } = { contains: "" }) {
      // B4 right-to-be-forgotten: deterministic substring purge (LIKE, not semantic —
      // erasure demands certainty, not similarity). ns-scoped; removes row+vector+fts.
      if (!contains || !contains.trim()) return { forgotten: 0 };
      const rows = db
        .prepare("SELECT rowid FROM brain_memories WHERE ns=? AND content LIKE ?")
        .all(ns || DEFAULT_NS, `%${contains}%`) as { rowid: number }[];
      for (const r of rows) deleteMemRow(r.rowid);
      audit("forget", null, `contains='${contains}' ns=${ns || DEFAULT_NS} (${rows.length} rows)`);
      return { forgotten: rows.length };
    },

    auditTail(limit = 50) {
      return db
        .prepare("SELECT ts, action, mem_id AS memId, detail FROM brain_audit ORDER BY rowid DESC LIMIT ?")
        .all(limit) as { ts: number; action: string; memId: string | null; detail: string }[];
    },

    async backfillEmbeddings({ limit = 16 } = {}) {
      // Write-behind drain (Tur-3): pending rows get their vectors in small batches
      // when the embedder frees up. Abort on the first failure — the embedder is still
      // contended; the next sweep/maintain pass retries. Never spins.
      // GPU gate (Tur-4): while a local generation runs (gpu-coordinator), draining
      // would steal unified-memory bandwidth from the chat LLM — defer entirely,
      // UNLESS the pending queue exceeds BRAIN_BACKFILL_BOUNDARY (default 50): then
      // one small batch is forced through so deferred rows can never starve.
      const gpuBusy = opts.llmActive ?? llmActive;
      const boundary = Number(process.env.BRAIN_BACKFILL_BOUNDARY) || 50;
      const pendingTotal = Number(
        (db.prepare("SELECT COUNT(*) AS n FROM brain_memories WHERE pending_embed=1").get() as { n: number }).n,
      );
      if (pendingTotal === 0) return 0;
      const forced = pendingTotal > boundary;
      if (gpuBusy() && !forced) return 0;
      const pending = db
        .prepare("SELECT rowid, content FROM brain_memories WHERE pending_embed=1 ORDER BY rowid LIMIT ?")
        .all(limit) as { rowid: number; content: string }[];
      let indexed = 0;
      for (const p of pending) {
        // Re-check between items (unless forced): a generation that started mid-drain
        // reclaims the GPU immediately — the rest waits for the next pass.
        if (!forced && indexed > 0 && gpuBusy()) break;
        try {
          const v = await embedWithBudget(p.content);
          ensureVec(v.length);
          db.prepare("DELETE FROM brain_vec WHERE rowid=?").run(BigInt(p.rowid));
          db.prepare("INSERT INTO brain_vec(rowid, embedding) VALUES(?,?)").run(BigInt(p.rowid), f32(v));
          db.prepare("UPDATE brain_memories SET pending_embed=0 WHERE rowid=?").run(BigInt(p.rowid));
          indexed++;
        } catch {
          break;
        }
      }
      return indexed;
    },

    sweep({ workingTtlMs = 7 * 86_400_000, pruneThreshold } = {}) {
      const cutoff = now() - workingTtlMs;
      const expired = db
        .prepare("SELECT rowid FROM brain_memories WHERE tier='working' AND created_at<?")
        .all(cutoff) as { rowid: number }[];
      for (const r of expired) deleteMemRow(r.rowid);
      // P4 importance-prune: unbounded episodic growth is the remaining leak (working
      // has TTL + ring). A row's importance uses the SAME maths recall ranks with, so
      // "too unimportant to keep" ≡ "would rank near-zero anyway". Heat extends life.
      // Only episodic/working are candidates — core/learned/procedural never auto-die.
      let pruned = 0;
      if (process.env.BRAIN_PRUNE !== "0") {
        const thr = pruneThreshold ?? (Number(process.env.BRAIN_PRUNE_THRESHOLD) || 0.15);
        const t = now();
        const candidates = db
          .prepare(
            "SELECT rowid, tier, created_at AS createdAt, access_count AS hits FROM brain_memories WHERE tier IN ('episodic','working')",
          )
          .all() as { rowid: number; tier: MemoryTier; createdAt: number; hits: number }[];
        for (const c of candidates) {
          const importance = TIER_WEIGHT[c.tier] * tierRecency(c.createdAt, t, c.tier) * usageBoost(c.hits);
          if (importance < thr) {
            deleteMemRow(c.rowid);
            pruned++;
          }
        }
      }
      // Tur-5 belief-revision hygiene: superseded MEMORIES mirror superseded facts —
      // history for a retention window, then gone (recall already filters them).
      let supersededPruned = 0;
      {
        const retentionMs = (Number(process.env.BRAIN_SUPERSEDED_PRUNE_DAYS) || 30) * 86_400_000;
        const dead = db
          .prepare("SELECT rowid FROM brain_memories WHERE superseded_at IS NOT NULL AND superseded_at<?")
          .all(now() - retentionMs) as { rowid: number }[];
        for (const r of dead) {
          deleteMemRow(r.rowid);
          supersededPruned++;
        }
      }
      // Fact hygiene (P0-3): superseded facts keep point-in-time queries honest for a
      // while, but their audit value decays and the scan cost doesn't — without this
      // they are the last unbounded leak. LIVE facts are never touched; only rows
      // invalidated longer than the retention window ago die (vector row too).
      let factsPruned = 0;
      if (process.env.BRAIN_FACT_PRUNE !== "0") {
        const retentionMs = (Number(process.env.BRAIN_FACT_PRUNE_DAYS) || 30) * 86_400_000;
        const dead = db
          .prepare("SELECT rowid FROM brain_facts WHERE invalidated_at IS NOT NULL AND invalidated_at<?")
          .all(now() - retentionMs) as { rowid: number }[];
        for (const f of dead) {
          try {
            db.prepare("DELETE FROM brain_fact_vec WHERE rowid=?").run(BigInt(f.rowid));
          } catch { /* v1 store without fact vectors */ }
          db.prepare("DELETE FROM brain_facts WHERE rowid=?").run(BigInt(f.rowid));
          factsPruned++;
        }
      }
      // P1: same maintenance pass also caps the persistent embed cache.
      const embedEvicted = embedCache
        ? embedCache.sweep({ cap: Number(process.env.BRAIN_EMBED_CACHE_CAP) || undefined }).evicted
        : 0;
      return { swept: expired.length, pruned, factsPruned, embedEvicted, supersededPruned };
    },

    consolidate({ minAccess = 3 } = {}) {
      // agentmem "skill crystallization": episodes recalled often become learned lessons.
      const r = db
        .prepare("UPDATE brain_memories SET tier='learned' WHERE tier='episodic' AND access_count>=?")
        .run(minAccess);
      // v3 dedupe: identical learned contents (case/whitespace-normalized) collapse into
      // the OLDEST row; hits sum so consolidation never loses heat.
      const learned = db
        .prepare("SELECT rowid, ns, content, access_count FROM brain_memories WHERE tier='learned' ORDER BY created_at, rowid")
        .all() as { rowid: number; ns: string; content: string; access_count: number }[];
      const keep = new Map<string, { rowid: number; hits: number }>();
      let merged = 0;
      for (const row of learned) {
        const key = `${row.ns} ${row.content.toLowerCase().replace(/\s+/g, " ").trim()}`;
        const first = keep.get(key);
        if (!first) {
          keep.set(key, { rowid: row.rowid, hits: row.access_count });
          continue;
        }
        first.hits += row.access_count;
        db.prepare("UPDATE brain_memories SET access_count=? WHERE rowid=?").run(first.hits, BigInt(first.rowid));
        deleteMemRow(row.rowid);
        merged++;
      }
      return { promoted: Number(r.changes), merged };
    },

    async health({ probes = 8, threshold = 0.8 } = {}) {
      // Probe rows carry their ns: recall() is namespace-scoped, so probing an org/tenant
      // memory through the default ns can NEVER self-hit — that false DRIFT fired the
      // first time a non-default ns gained recent learned rows (ledger migration).
      const rows = db
        .prepare(
          "SELECT mem_id AS id, content, ns FROM brain_memories WHERE tier IN ('learned','core') AND superseded_at IS NULL ORDER BY created_at DESC, rowid DESC LIMIT ?",
        )
        .all(probes) as { id: string; content: string; ns: string }[];
      if (rows.length === 0) return { selfHitRate: 1, drift: false, probes: 0 };
      let hits = 0;
      for (const p of rows) {
        const top = await this.recall(p.content, { k: 1, fresh: true, ns: p.ns });
        if (top[0]?.id === p.id) hits++;
      }
      const selfHitRate = hits / rows.length;
      const drift = selfHitRate < threshold;
      if (drift) {
        console.warn(
          `[brain] DRIFT: self-hit ${(selfHitRate * 100).toFixed(0)}% < ${threshold * 100}% — embedding space no longer matches stored vectors; consider re-embedding the store`,
        );
      }
      return { selfHitRate, drift, probes: rows.length };
    },

    memoriesBySource(source, { limit = 50 } = {}) {
      return db
        .prepare(
          "SELECT mem_id AS id, tier, content, ns, created_at AS createdAt FROM brain_memories WHERE source=? ORDER BY created_at DESC, rowid DESC LIMIT ?",
        )
        .all(source, limit) as { id: string; tier: MemoryTier; content: string; ns: string; createdAt: number }[];
    },

    listNamespaces() {
      return (db.prepare("SELECT DISTINCT ns FROM brain_memories ORDER BY ns").all() as { ns: string }[]).map((r) => r.ns);
    },

    factsAbout(subject, { ns, at } = {}) {
      const t = at ?? now();
      const rows = db
        .prepare(
          `SELECT subject, predicate, object, episode_id AS episodeId, ns,
                  valid_from AS validFrom, invalidated_at AS invalidatedAt
           FROM brain_facts
           WHERE ns=? AND subject=? AND valid_from<=? AND (invalidated_at IS NULL OR invalidated_at>?)
           ORDER BY valid_from`,
        )
        .all(ns || DEFAULT_NS, subject, t, t) as unknown as BrainFact[];
      return rows;
    },

    async ingest({ episodeId, memories = [], facts = [], ns }) {
      if (!episodeId?.trim()) throw new Error("ingest needs an episodeId");
      let m = 0;
      for (const [i, mem] of memories.entries()) {
        await rememberOne({ id: `${episodeId}:m${i}`, tier: mem.tier, content: mem.content, source: episodeId, ns });
        m++;
      }
      let fCount = 0;
      for (const fact of facts) {
        await this.assertFact({ ...fact, episodeId, ns: fact.ns || ns });
        fCount++;
      }
      return { memories: m, facts: fCount };
    },

    stats() {
      const memories = Object.fromEntries(TIERS.map((t) => [t, 0])) as Record<MemoryTier, number>;
      const rows = db.prepare("SELECT tier, COUNT(*) AS n FROM brain_memories GROUP BY tier").all() as {
        tier: MemoryTier;
        n: number;
      }[];
      for (const r of rows) if (r.tier in memories) memories[r.tier] = Number(r.n);
      const f = db.prepare("SELECT COUNT(*) AS n FROM brain_facts WHERE invalidated_at IS NULL").get() as { n: number };
      const fs = db.prepare("SELECT COUNT(*) AS n FROM brain_facts WHERE invalidated_at IS NOT NULL").get() as { n: number };
      const nsRow = db.prepare("SELECT COUNT(DISTINCT ns) AS n FROM brain_memories").get() as { n: number };
      let embedCacheRows = 0;
      try {
        embedCacheRows = Number((db.prepare("SELECT COUNT(*) AS n FROM embed_cache").get() as { n: number }).n);
      } catch { /* BRAIN_EMBED_CACHE=0 → table absent */ }
      let dbBytes = 0;
      try { dbBytes = statSync(dbPath).size; } catch { /* in-memory / not yet flushed */ }
      return {
        memories,
        facts: Number(f.n),
        factsSuperseded: Number(fs.n),
        namespaces: Number(nsRow.n),
        embedCacheRows,
        dbBytes,
      };
    },

    async overview({ recent = 20 } = {}) {
      const memories = db
        .prepare(
          "SELECT mem_id AS id, tier, content, access_count AS hits, created_at AS createdAt FROM brain_memories ORDER BY created_at DESC, rowid DESC LIMIT ?",
        )
        .all(recent) as BrainOverview["memories"];
      const facts = db
        .prepare(
          "SELECT subject, predicate, object, episode_id AS episodeId FROM brain_facts WHERE invalidated_at IS NULL ORDER BY valid_from DESC LIMIT ?",
        )
        .all(recent) as BrainOverview["facts"];
      const history = db
        .prepare(
          "SELECT subject, predicate, object, invalidated_at AS invalidatedAt FROM brain_facts WHERE invalidated_at IS NOT NULL ORDER BY invalidated_at DESC LIMIT ?",
        )
        .all(Math.min(recent, 10)) as BrainOverview["history"];
      // health() embeds fresh (the drift probe bypasses the cache by design) — under
      // embedder load one probe can outlast any HTTP client and would take this whole
      // SQL-only bundle down with it. Degrade-alive: health is best-effort within
      // BRAIN_HEALTH_TIMEOUT_MS (default 10s); a timed-out probe is flagged degraded,
      // never reported as drift.
      const healthBudget = Number(process.env.BRAIN_HEALTH_TIMEOUT_MS || 10_000);
      let health: BrainOverview["health"] = { selfHitRate: 0, drift: false, probes: 0, degraded: true };
      try {
        health = await Promise.race([
          this.health(),
          new Promise<never>((_, reject) => {
            const t = setTimeout(() => reject(new Error("health probe timed out")), healthBudget);
            (t as { unref?: () => void }).unref?.();
          }),
        ]);
      } catch {
        /* degraded default stands */
      }
      return { stats: this.stats(), memories, facts, history, health };
    },

    async graph({ ns, at, limit = 200 } = {}) {
      const t = at ?? now();
      // Live facts valid at t + a bounded tail of recently-superseded ones (so the map
      // can show history as dashed edges). Reified into an entity graph.
      const rows = db
        .prepare(
          `SELECT subject, predicate, object, episode_id AS episodeId, ns, valid_from AS validFrom, invalidated_at AS invalidatedAt
           FROM brain_facts
           WHERE ns=? AND valid_from<=? AND (invalidated_at IS NULL OR invalidated_at>?)
           ORDER BY valid_from DESC LIMIT ?`,
        )
        .all(ns || DEFAULT_NS, t, t, limit) as unknown as BrainFact[];
      const superseded = db
        .prepare(
          `SELECT subject, predicate, object, episode_id AS episodeId, ns, valid_from AS validFrom, invalidated_at AS invalidatedAt
           FROM brain_facts WHERE ns=? AND invalidated_at IS NOT NULL
             AND predicate NOT IN ('last_commit_subject')
           ORDER BY invalidated_at DESC LIMIT ?`,
        )
        .all(ns || DEFAULT_NS, Math.min(limit, 8)) as unknown as BrainFact[];
      return buildGraph([...rows, ...superseded]);
    },

    close() {
      db.close();
    },
  };
}

// Belief revision primitives (Tur-5 research: Mem0-style negation routing, zero-LLM).
// A write that NEGATES near, entity-overlapping content supersedes it at write time —
// "I am strictly vegan now" must stop "loves pepperoni pizza" from ever being recalled.
const CONTRADICTION_RE =
  /\b(not|no longer|no more|stop(ped)?|don'?t|never|anymore|cancel(led)?|quit|moved|changed|instead|değil|art[ıi]k|vazgeç\w*|b[ıi]rak\w*|iptal|yerine|taş[ıi]nd[ıi]m|değişti|içmiyorum|yemiyorum|kullanm[ıi]yorum)\b/iu;
const OVERLAP_STOPWORDS = new Set([
  "the", "and", "that", "this", "with", "have", "from", "user", "için", "gibi", "daha", "olan", "artık", "anymore",
]);

/** Does this text carry an explicit negation/change-of-state signal? Pure, TR+EN. */
export function contradictionSignal(text: string): boolean {
  return CONTRADICTION_RE.test(text || "");
}

/** Count of meaningful (len>3, non-stopword) tokens two texts share — the entity
 *  anchor that keeps semantic nearness from superseding unrelated memories. */
export function entityOverlap(a: string, b: string): number {
  const toks = (s: string) =>
    new Set(
      (s || "")
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((w) => w.length > 3 && !OVERLAP_STOPWORDS.has(w)),
    );
  const ta = toks(a);
  let n = 0;
  for (const w of toks(b)) if (ta.has(w)) n++;
  return n;
}

/** Parse an agent/LLM extraction reply into a validated Extraction. Reasoning-leakage
 *  safe: takes the LAST {...} span (models may quote JSON inside their prose first).
 *  Malformed rows are dropped, never thrown — ingest keeps whatever is usable. */
export function parseExtraction(raw: string): Extraction {
  // The answer object ends at the LAST '}'. Its opening brace is unknown (prose may
  // quote JSON fragments first), so try each '{' from the END until one parses.
  const end = raw.lastIndexOf("}") + 1;
  let parsed: any = {};
  let from = end;
  for (let attempt = 0; attempt < 24; attempt++) {
    from = raw.lastIndexOf("{", from - 1);
    if (from === -1) break;
    try {
      parsed = JSON.parse(raw.slice(from, end));
      break;
    } catch {
      parsed = {};
    }
  }
  const memories = (Array.isArray(parsed.memories) ? parsed.memories : [])
    .filter((m: any) => m && TIERS.includes(m.tier) && typeof m.content === "string" && m.content.trim())
    .map((m: any) => ({ tier: m.tier as MemoryTier, content: String(m.content) }));
  const facts = (Array.isArray(parsed.facts) ? parsed.facts : [])
    .filter((f: any) => f && [f.subject, f.predicate, f.object].every((x) => typeof x === "string" && x.trim()))
    .map((f: any) => ({ subject: String(f.subject), predicate: String(f.predicate), object: String(f.object) }));
  return { memories, facts };
}

/** Prompt for the distilling agent/model (mem0-style extraction contract). The agent
 *  runs this against a transcript, then calls the brain_ingest tool with the JSON. */
export const EXTRACTION_PROMPT = `Distill this conversation into durable memory. Reply ONLY a JSON object:
{"memories":[{"tier":"core|procedural|learned|episodic|working","content":"..."}],"facts":[{"subject":"...","predicate":"...","object":"..."}]}
Tiers: core=identity/preferences that rarely change, procedural=how-to steps, learned=verified lessons/gotchas, episodic=what happened, working=short-lived context.
Facts are subject–predicate–object triples for things that may CHANGE over time (assignments, versions, preferences). Extract only what is worth recalling weeks later; omit chit-chat.`;

// Deterministic offline embedder (BRAIN_EMBED_FAKE=1): 8-dim hash-bucket vector.
// For tests and no-ollama dev shells — NOT semantically meaningful, only stable.
const fakeHashEmbed: Embedder = async (text) => {
  const v = new Array(8).fill(0);
  for (let i = 0; i < text.length; i++) v[text.charCodeAt(i) % 8] += 1;
  const norm = Math.hypot(...v) || 1;
  return v.map((x) => x / norm);
};

// Process-wide default store for the tools (rag.ts convention): embedder resolves
// from the EMBED_PROVIDER pin with local-ollama terminal fallback.
let _store: BrainStore | null = null;
function store(): BrainStore {
  if (!_store) {
    if (process.env.BRAIN_EMBED_FAKE === "1") {
      _store = createBrainStore({ embed: fakeHashEmbed, embedProvider: "fake-hash" });
    } else {
      const r = resolveEmbedder();
      _store = createBrainStore({ embed: r.embed, embedProvider: r.providerId });
    }
  }
  return _store;
}
export const brainRemember = (m: BrainMemoryInput) => store().remember(m);
export const brainRecall = async (
  q: string,
  o?: { k?: number; tier?: MemoryTier; ns?: string; fresh?: boolean; graphExpand?: boolean; minScore?: number; actor?: string; since?: number; until?: number },
) => {
  // S21: latency observed HERE (external choke-point) and not inside recall(),
  // so the drift probe's internal this.recall() calls never skew the histogram.
  const t0 = Date.now();
  try {
    return await store().recall(q, o);
  } finally {
    try {
      const { observeRecallLatency } = await import("./brain-metrics");
      observeRecallLatency(Date.now() - t0);
    } catch { /* metrics absent → recall unaffected */ }
  }
};
export const brainAssertFact = (f: BrainFactInput) => store().assertFact(f);
export const brainFactsAbout = (s: string, o?: { ns?: string; at?: number }) => store().factsAbout(s, o);
export const brainMemoriesBySource = (s: string, o?: { limit?: number }) => store().memoriesBySource(s, o);
export const brainListNamespaces = () => store().listNamespaces();
export const brainIngest = (b: { episodeId: string; memories?: Extraction["memories"]; facts?: BrainFactInput[]; ns?: string }) =>
  store().ingest(b);
export const brainSearchFacts = (q: string, o?: { k?: number; ns?: string; at?: number }) => store().searchFacts(q, o);
export const brainSweep = (o?: { workingTtlMs?: number }) => store().sweep(o);
export const brainConsolidate = (o?: { minAccess?: number }) => store().consolidate(o);
export const brainHealth = (o?: { probes?: number; threshold?: number }) => store().health(o);
export const brainForget = (o: { contains: string; ns?: string }) => store().forget(o);
export const brainAuditTail = (limit?: number) => store().auditTail(limit);
export const brainStats = () => store().stats();
export const brainOverview = (o?: { recent?: number }) => store().overview(o);
export const brainGraph = (o?: { ns?: string; at?: number; limit?: number }) => store().graph(o);
