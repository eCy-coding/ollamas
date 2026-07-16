// server/semantic-cache.ts — in-house LLM response cache on the ProviderRouter.generate
// seam (C4). ZERO new deps: reuses server/store/db-adapter.ts (exact-hash metadata,
// sqlite/pg dialect-agnostic, jobs.ts table pattern) + server/store/vector.ts's
// openVectorCollection (sqlite-vec KNN, rag.ts/vector.ts usage pattern) for the
// semantic fallback.
//
// Two-level lookup:
//   1) exact fast path — sha256({model, prompt, paramsHash}) primary-key lookup.
//   2) semantic path — cosine search over a dedicated "semantic-cache" vector
//      collection, gated to the SAME model + SAME generation-params hash (a
//      near-duplicate prompt at a different temperature is NOT a valid hit).
//
// Cosine via sqlite-vec: vec0's default distance for float columns is raw (non-squared)
// Euclidean L2 (server/store/__tests__/vector.test.ts:20; verified empirically —
// distance is sqrt of the squared term, NOT the squared term itself). Both the stored
// and the query vector are L2-normalized by `normalizingEmbedder` before ever reaching
// vec0, so for unit vectors ||a-b||^2 = 2 - 2*cos(a,b) => cos(a,b) = 1 - distance^2/2
// (cosineFromL2Dist — squares the raw distance internally).
//
// Gating: SEMANTIC_CACHE=1 enables (default OFF — every exported entry point below
// short-circuits to a no-op/miss when unset, so the feature is inert by default and
// safe to import unconditionally). Only the providers.ts wiring decides *what* is
// cacheable (successful, non-streaming) — this module itself never streams.
//
// Failure isolation: lookupCache/storeCache (and their process-wide wrappers
// semanticCacheLookup/semanticCacheStore) NEVER throw — any DB or embedder error is
// logged as a warning and treated as a miss / skipped store. Cache must never break
// generation.
import crypto from "node:crypto";
import { createAdapter, type DbClient } from "./store/db-adapter";
import { openVectorCollection, type VectorStore } from "./store/vector";
import { embedText, type Embedder } from "./rag";
import { registerRecurring } from "./jobs";
import { semanticCacheEventsTotal } from "./metrics";

// ── Config (env-tunable, pure resolvers) ────────────────────────────────────────
const DEFAULT_THRESHOLD = 0.95;
const DEFAULT_TTL_S = 3600;
const DEFAULT_SEARCH_K = 20;

export function isSemanticCacheEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.SEMANTIC_CACHE === "1";
}

export function resolveThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.SEMANTIC_CACHE_THRESHOLD);
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : DEFAULT_THRESHOLD;
}

export function resolveTtlS(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.SEMANTIC_CACHE_TTL_S);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_TTL_S;
}

function resolveSearchK(env: NodeJS.ProcessEnv = process.env): number {
  const v = Number(env.SEMANTIC_CACHE_SEARCH_K);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : DEFAULT_SEARCH_K;
}

// ── Pure hashing / vector math (unit-tested directly) ───────────────────────────
export interface CacheMessage { role: string; content: string; }
export interface CacheParams {
  model: string;
  messages: CacheMessage[];
  temperature?: number;
  numCtx?: number;
  tools?: any[];
}

function sha256(s: string): string {
  return crypto.createHash("sha256").update(s).digest("hex");
}

/** Pure: fold a message array into the text embedded/hashed for cache identity. */
export function computePromptText(messages: CacheMessage[]): string {
  return messages.map((m) => `${m.role}:${m.content}`).join("\n");
}

/** Pure: hash of the generation params ONLY (model + prompt excluded) — a semantic
 *  match additionally requires this to match exactly, so a near-duplicate prompt at
 *  a different temperature/tool-set never counts as a hit. */
export function computeParamsHash(params: Pick<CacheParams, "temperature" | "numCtx" | "tools">): string {
  const norm = {
    temperature: params.temperature ?? null,
    numCtx: params.numCtx ?? null,
    tools: params.tools && params.tools.length ? JSON.stringify(params.tools) : null,
  };
  return sha256(JSON.stringify(norm));
}

/** Pure: the exact-fast-path primary key — sha256({model, prompt, paramsHash}). */
export function computeExactHash(model: string, prompt: string, paramsHash: string): string {
  return sha256(JSON.stringify({ model, prompt, paramsHash }));
}

/** Pure: L2-normalize a vector; a zero/degenerate vector is returned unchanged
 *  (guards divide-by-zero — a downstream cosine of ~0 just never clears threshold). */
export function normalizeVector(v: number[]): number[] {
  let sumSq = 0;
  for (const x of v) sumSq += x * x;
  const norm = Math.sqrt(sumSq);
  if (!Number.isFinite(norm) || norm <= 0) return v.slice();
  return v.map((x) => x / norm);
}

/** Pure: cosine similarity from vec0's raw (non-squared) L2 distance, valid ONLY
 *  when both vectors are unit-normalized (||a-b||^2 = 2 - 2cos(a,b), and vec0
 *  returns ||a-b|| — this squares it back before applying the identity). Clamped
 *  to [-1,1] to absorb floating-point drift at the extremes. */
export function cosineFromL2Dist(l2: number): number {
  const cos = 1 - (l2 * l2) / 2;
  if (cos > 1) return 1;
  if (cos < -1) return -1;
  return cos;
}

/** Wrap a raw Embedder so every vector handed to the vector store (write or query
 *  side) is unit-normalized — the precondition cosineFromL2Sq relies on. Exported so
 *  tests wrap their fake embedder identically to production (defaultDeps below). */
export function normalizingEmbedder(embed: Embedder): Embedder {
  return async (text: string) => normalizeVector(await embed(text));
}

// ── Storage shape ────────────────────────────────────────────────────────────────
export interface StoredResult {
  text: string;
  source: string;
  modelUsed: string;
  tokensPerSec?: number;
  tokens?: number;
  tokensIn?: number;
  tokensOut?: number;
}

export type CacheOutcome = "hit_exact" | "hit_semantic" | "miss" | "store";
export interface CacheHit { result: StoredResult; outcome: "hit_exact" | "hit_semantic"; }

export interface CacheDeps {
  db: DbClient;
  vec: VectorStore;
  env?: NodeJS.ProcessEnv;
}

// ── Schema (db-adapter — sqlite by default, pg when DATABASE_URL is set) ────────
export async function initSemanticCacheSchema(db: DbClient): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_cache (
      id TEXT PRIMARY KEY,
      params_hash TEXT NOT NULL,
      model TEXT NOT NULL,
      prompt_text TEXT NOT NULL,
      response TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_semantic_cache_expiry ON semantic_cache(expires_at);
    CREATE INDEX IF NOT EXISTS idx_semantic_cache_model_params ON semantic_cache(model, params_hash);
  `);
}

async function deleteExpiredRow(deps: CacheDeps, id: string): Promise<void> {
  try { await deps.db.run("DELETE FROM semantic_cache WHERE id = ?", [id]); } catch { /* best-effort */ }
  try { await deps.vec.delete(id); } catch { /* best-effort */ }
}

// ── Pure-core (given injected deps) lookup / store / cleanup ───────────────────
/**
 * Two-level cache lookup. Returns null on: disabled, miss, below-threshold semantic
 * candidates, param-hash mismatch, or ANY thrown error (db down, embedder down) —
 * failure isolation lives here so callers never need their own try/catch.
 */
export async function lookupCache(deps: CacheDeps, cfg: CacheParams, nowMs = Date.now()): Promise<CacheHit | null> {
  const env = deps.env ?? process.env;
  if (!isSemanticCacheEnabled(env)) return null;
  try {
    const prompt = computePromptText(cfg.messages);
    const pHash = computeParamsHash(cfg);
    const id = computeExactHash(cfg.model, prompt, pHash);

    // 1) exact fast path
    const exactRow = (await deps.db.query("SELECT * FROM semantic_cache WHERE id = ?", [id])).rows[0];
    if (exactRow) {
      if (Number(exactRow.expires_at) > nowMs) {
        return { result: JSON.parse(exactRow.response), outcome: "hit_exact" };
      }
      await deleteExpiredRow(deps, id); // lazy TTL delete
    }

    // 2) semantic path — nearest neighbors over the prompt embedding, filtered to
    // the SAME model + SAME params hash, first candidate clearing the threshold wins
    // (candidates arrive ordered by distance ascending, i.e. cosine descending).
    const threshold = resolveThreshold(env);
    const candidates = await deps.vec.query(prompt, resolveSearchK(env));
    for (const c of candidates) {
      if (c.id === id) continue; // already resolved (hit or expired-deleted) above
      const row = (await deps.db.query("SELECT * FROM semantic_cache WHERE id = ?", [c.id])).rows[0];
      if (!row) continue; // vector present, metadata gone (race/partial write) — skip defensively
      if (Number(row.expires_at) <= nowMs) { await deleteExpiredRow(deps, c.id); continue; }
      if (row.model !== cfg.model || row.params_hash !== pHash) continue;
      const cosine = cosineFromL2Dist(c.distance);
      if (cosine >= threshold) {
        return { result: JSON.parse(row.response), outcome: "hit_semantic" };
      }
    }
    return null;
  } catch (e: any) {
    console.warn(`[SemanticCache] lookup failed (${e?.message ?? e}) → miss`);
    return null;
  }
}

/** Upsert a successful result under its exact-hash id. Never throws — any error is
 *  logged and swallowed (a failed cache write must not fail the caller's generate()). */
export async function storeCache(deps: CacheDeps, cfg: CacheParams, result: StoredResult, nowMs = Date.now()): Promise<void> {
  const env = deps.env ?? process.env;
  if (!isSemanticCacheEnabled(env)) return;
  try {
    const prompt = computePromptText(cfg.messages);
    const pHash = computeParamsHash(cfg);
    const id = computeExactHash(cfg.model, prompt, pHash);
    const expiresAt = nowMs + resolveTtlS(env) * 1000;
    await deps.db.run(
      `INSERT INTO semantic_cache (id, params_hash, model, prompt_text, response, created_at, expires_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET response=excluded.response, created_at=excluded.created_at, expires_at=excluded.expires_at`,
      [id, pHash, cfg.model, prompt, JSON.stringify(result), nowMs, expiresAt],
    );
    await deps.vec.upsert(id, prompt);
  } catch (e: any) {
    console.warn(`[SemanticCache] store failed (${e?.message ?? e}) → skipped`);
  }
}

/** Delete every row past its TTL (metadata + vector). Returns the count removed.
 *  Driven by the registerRecurring loop below (every 10min); exported for tests. */
export async function cleanupExpiredCache(db: DbClient, vec: VectorStore, nowMs = Date.now()): Promise<number> {
  const rows = (await db.query("SELECT id FROM semantic_cache WHERE expires_at <= ?", [nowMs])).rows;
  for (const r of rows) { try { await vec.delete(r.id); } catch { /* best-effort */ } }
  const res = await db.run("DELETE FROM semantic_cache WHERE expires_at <= ?", [nowMs]);
  return res.changes;
}

// ── Process-wide wiring (default embedder = embedText, own DbClient + vector
// collection — same "own dedicated connection" pattern as jobs.ts / rag.ts) ─────
let depsPromise: Promise<CacheDeps> | null = null;

function defaultDeps(): Promise<CacheDeps> {
  if (!depsPromise) {
    depsPromise = (async () => {
      const db = await createAdapter();
      await initSemanticCacheSchema(db);
      const vec = openVectorCollection("semantic-cache", { embed: normalizingEmbedder(embedText) });
      return { db, vec, env: process.env };
    })();
  }
  return depsPromise;
}

/** Test-only: drop the memoized singleton so the next call re-reads env/rebuilds deps. */
export function _resetSemanticCacheForTest(): void {
  depsPromise = null;
}

/**
 * High-level entry point for ProviderRouter.generate (server/providers.ts). Disabled
 * (default) short-circuits before any IO. Never throws — see lookupCache above.
 */
export async function semanticCacheLookup(cfg: CacheParams): Promise<CacheHit | null> {
  if (!isSemanticCacheEnabled()) return null;
  try {
    const deps = await defaultDeps();
    const hit = await lookupCache(deps, cfg);
    semanticCacheEventsTotal.labels(hit ? hit.outcome : "miss").inc();
    return hit;
  } catch (e: any) {
    console.warn(`[SemanticCache] lookup wiring failed (${e?.message ?? e}) → miss`);
    return null;
  }
}

/** High-level entry point for ProviderRouter.generate's success path. Never throws. */
export async function semanticCacheStore(cfg: CacheParams, result: StoredResult): Promise<void> {
  if (!isSemanticCacheEnabled()) return;
  try {
    const deps = await defaultDeps();
    await storeCache(deps, cfg, result);
    semanticCacheEventsTotal.labels("store").inc();
  } catch (e: any) {
    console.warn(`[SemanticCache] store wiring failed (${e?.message ?? e}) → skipped`);
  }
}

// ── GET /api/cache snapshot (server.ts, style of /api/jobs) ────────────────────
export async function getSemanticCacheSnapshot(): Promise<{
  enabled: boolean;
  config: { threshold: number; thresholdDefault: number; ttlS: number; ttlSDefault: number };
  events: Record<"hit_exact" | "hit_semantic" | "miss" | "store", number>;
}> {
  const metric = await semanticCacheEventsTotal.get();
  const events: Record<"hit_exact" | "hit_semantic" | "miss" | "store", number> = {
    hit_exact: 0, hit_semantic: 0, miss: 0, store: 0,
  };
  for (const v of metric.values) {
    const outcome = String((v.labels as any)?.outcome ?? "");
    if (outcome in events) events[outcome as CacheOutcome & keyof typeof events] = v.value;
  }
  return {
    enabled: isSemanticCacheEnabled(),
    config: {
      threshold: resolveThreshold(),
      thresholdDefault: DEFAULT_THRESHOLD,
      ttlS: resolveTtlS(),
      ttlSDefault: DEFAULT_TTL_S,
    },
    events,
  };
}

// ── Recurring cleanup (jobs.ts registerRecurring, 10min) ────────────────────────
// Registration is idempotent/cheap (no IO) — the tick itself no-ops when the
// feature is disabled, so importing this module has zero cost by default.
registerRecurring("semantic-cache-cleanup", 10 * 60 * 1000, async () => {
  if (!isSemanticCacheEnabled()) return;
  const deps = await defaultDeps();
  const n = await cleanupExpiredCache(deps.db, deps.vec);
  if (n > 0) console.log(`[SemanticCache] cleanup: removed ${n} expired entr${n === 1 ? "y" : "ies"}`);
});
