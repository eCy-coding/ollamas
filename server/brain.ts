// Brain v1 (Tur 4, ported from integrate-wt commit 6ec3b29) — tiered semantic
// memory + bi-temporal facts for the agent. Built on the exact rag.ts machinery
// (dedicated sqlite-vec DatabaseSync, injectable embedder, dim/provider guards)
// so the zero-new-dep and choke-point laws hold.
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
import * as sqliteVec from "sqlite-vec";
import { type Embedder, embedText, resolveEmbedder } from "./rag";
import { withLlmSpan } from "./tracing";

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
}

export interface BrainRecallHit {
  id: string;
  tier: MemoryTier;
  content: string;
  distance: number;
  score: number;
  createdAt: number;
}

export interface BrainFactInput {
  subject: string;
  predicate: string;
  object: string;
  episodeId?: string;
  ns?: string;
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
  remember(m: BrainMemoryInput): Promise<{ id: string; dim: number }>;
  recall(query: string, opts?: { k?: number; tier?: MemoryTier; ns?: string }): Promise<BrainRecallHit[]>;
  assertFact(f: BrainFactInput): Promise<{ changed: boolean; invalidated: number }>;
  factsAbout(subject: string, opts?: { ns?: string; at?: number }): BrainFact[];
  ingest(batch: { episodeId: string; memories?: Extraction["memories"]; facts?: BrainFactInput[]; ns?: string }): Promise<{ memories: number; facts: number }>;
  stats(): { memories: Record<MemoryTier, number>; facts: number };
  close(): void;
}

const f32 = (v: number[]) => new Uint8Array(new Float32Array(v).buffer);
const DEFAULT_NS = "default";

/** Recency multiplier: 1.0 fresh → ~0.5 at 30 days → asymptotically small. */
const recency = (createdAt: number, now: number) => {
  const ageDays = Math.max(0, now - createdAt) / 86_400_000;
  return 1 / (1 + ageDays / 30);
};

export function createBrainStore(
  opts: { dbPath?: string; embed?: Embedder; embedProvider?: string; now?: () => number } = {},
): BrainStore {
  const dbPath = opts.dbPath || process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;
  const rawEmbed = opts.embed || embedText;
  const embedProvider = opts.embedProvider || "ollama-local";
  // Single tracing seam (mirrors providers.ts's one withLlmSpan call site): every
  // outbound embed call funnels through here, whether it originates from
  // remember/ingest or recall, so instrumentation stays a single wrap, not
  // scattered across each store method.
  const embed: Embedder = (text) =>
    withLlmSpan("llm.embed", { provider: embedProvider, model: "embed" }, () => rawEmbed(text));
  const now = opts.now || Date.now;
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  db.enableLoadExtension(true);
  sqliteVec.load(db);
  db.exec(`CREATE TABLE IF NOT EXISTS brain_memories (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    mem_id TEXT UNIQUE NOT NULL,
    tier TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT,
    ns TEXT NOT NULL DEFAULT '${DEFAULT_NS}',
    created_at INTEGER NOT NULL
  )`);
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

  let dim: number | null = (() => {
    const r = db.prepare("SELECT v FROM brain_meta WHERE k='dim'").get() as { v?: string } | undefined;
    return r?.v ? Number(r.v) : null;
  })();

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
      db.prepare("INSERT OR REPLACE INTO brain_meta(k,v) VALUES('dim',?)").run(String(d));
      dim = d;
    } else if (dim !== d) {
      throw new Error(`brain embedding dim mismatch: store=${dim} got=${d} (re-create the brain db to change models)`);
    }
  };

  const rememberOne = async (m: BrainMemoryInput): Promise<{ id: string; dim: number }> => {
    if (!TIERS.includes(m.tier)) throw new Error(`invalid tier '${m.tier}' (${TIERS.join("/")})`);
    if (!m.content?.trim()) throw new Error("empty memory content");
    ensureProvider();
    const id = m.id || `mem-${crypto.randomUUID()}`;
    const vec = await embed(m.content);
    ensureVec(vec.length);
    const prior = db.prepare("SELECT rowid FROM brain_memories WHERE mem_id=?").get(id) as { rowid?: number } | undefined;
    if (prior?.rowid !== undefined) {
      db.prepare("DELETE FROM brain_vec WHERE rowid=?").run(BigInt(prior.rowid));
      db.prepare("DELETE FROM brain_memories WHERE rowid=?").run(BigInt(prior.rowid));
    }
    const ins = db
      .prepare("INSERT INTO brain_memories(mem_id, tier, content, source, ns, created_at) VALUES(?,?,?,?,?,?)")
      .run(id, m.tier, m.content, m.source ?? null, m.ns || DEFAULT_NS, now());
    db.prepare("INSERT INTO brain_vec(rowid, embedding) VALUES(?,?)").run(BigInt(ins.lastInsertRowid), f32(vec));
    return { id, dim: vec.length };
  };

  return {
    remember: rememberOne,

    async recall(query, { k = 5, tier, ns } = {}) {
      ensureProvider();
      if (dim === null) return []; // nothing remembered yet
      const vec = await embed(query);
      ensureVec(vec.length);
      // Overfetch the KNN (tier/ns filtering happens after the vector stage), then
      // re-rank by closeness × tier weight × recency and cut to k.
      const rows = db
        .prepare(
          `SELECT m.mem_id AS id, m.tier AS tier, m.content AS content, m.created_at AS createdAt,
                  v.distance AS distance, m.ns AS ns
           FROM (SELECT rowid, distance FROM brain_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?) v
           JOIN brain_memories m ON m.rowid = v.rowid`,
        )
        .all(f32(vec), k * 4 + 16) as unknown as (BrainRecallHit & { ns: string })[];
      const t = now();
      return rows
        .filter((r) => (!tier || r.tier === tier) && r.ns === (ns || DEFAULT_NS))
        .map((r) => ({
          id: r.id,
          tier: r.tier,
          content: r.content,
          distance: r.distance,
          createdAt: r.createdAt,
          score: (1 / (1 + r.distance)) * TIER_WEIGHT[r.tier] * recency(r.createdAt, t),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, k);
    },

    async assertFact(f) {
      if (!f.subject?.trim() || !f.predicate?.trim() || !f.object?.trim()) {
        throw new Error("fact needs subject, predicate and object");
      }
      const ns = f.ns || DEFAULT_NS;
      const t = now();
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
      db.prepare(
        "INSERT INTO brain_facts(subject, predicate, object, episode_id, ns, valid_from) VALUES(?,?,?,?,?,?)",
      ).run(f.subject, f.predicate, f.object, f.episodeId ?? null, ns, t);
      return { changed: true, invalidated };
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
      return { memories, facts: Number(f.n) };
    },

    close() {
      db.close();
    },
  };
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

// Process-wide default store for the tools (rag.ts convention): embedder resolves
// from the EMBED_PROVIDER pin with local-ollama terminal fallback.
let _store: BrainStore | null = null;
function store(): BrainStore {
  if (!_store) {
    const r = resolveEmbedder();
    _store = createBrainStore({ embed: r.embed, embedProvider: r.providerId });
  }
  return _store;
}
export const brainRemember = (m: BrainMemoryInput) => store().remember(m);
export const brainRecall = (q: string, o?: { k?: number; tier?: MemoryTier; ns?: string }) => store().recall(q, o);
export const brainAssertFact = (f: BrainFactInput) => store().assertFact(f);
export const brainFactsAbout = (s: string, o?: { ns?: string; at?: number }) => store().factsAbout(s, o);
export const brainIngest = (b: { episodeId: string; memories?: Extraction["memories"]; facts?: BrainFactInput[]; ns?: string }) =>
  store().ingest(b);
