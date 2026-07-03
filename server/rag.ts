// Local RAG (v1.13) — embedded vector search via sqlite-vec (MIT/Apache) + ollama
// embeddings. Uses a DEDICATED DatabaseSync opened with { allowExtension: true }
// (separate file from the SaaS store → the SaaS DB is never opened with extension
// loading, no regression). Exposed to the agent as the rag_index / rag_search
// tools through the single ToolRegistry choke-point.
//
// The embedder is injectable so the contract test can run deterministically
// without ollama; production uses embedText() against the local ollama daemon.
import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";
import { pickEmbedProvider, buildEmbedRequest, parseEmbedResponse } from "./embed-catalog";

export type Embedder = (text: string) => Promise<number[]>;

/** Embed text via the local ollama daemon (`POST /api/embeddings`). Model +
 *  host are env-configurable; mirrors the ollama-local pattern in providers.ts. */
export async function embedText(text: string): Promise<number[]> {
  const host = process.env.OLLAMA_HOST || "http://localhost:11434";
  const model = process.env.OLLAMA_EMBED_MODEL || "nomic-embed-text";
  const res = await fetch(`${host}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`ollama embeddings error ${res.status}`);
  const json = await res.json();
  const v = json?.embedding;
  if (!Array.isArray(v) || v.length === 0) throw new Error("ollama embeddings: empty vector");
  return v;
}

/** Resolve the production embedder from the EMBED_PROVIDER pin (embed-catalog.ts).
 *  Pinned cloud provider → OpenAI-compat /embeddings via fetch, falling back to the local
 *  ollama embedder on ANY failure (quota/network/malformed) — the local tier is terminal
 *  and never removed. No pin (or unusable pin) → local directly. `providerId` identifies
 *  which provider the vectors come from so the store can enforce index consistency. */
export function resolveEmbedder(
  env: NodeJS.ProcessEnv = process.env,
  deps: { fetchFn?: typeof fetch; localEmbed?: Embedder } = {},
): { embed: Embedder; providerId: string } {
  const local = deps.localEmbed ?? embedText;
  const entry = pickEmbedProvider(env);
  if (!entry) return { embed: local, providerId: "ollama-local" };
  const fetchFn = deps.fetchFn ?? fetch;
  const embed: Embedder = async (text) => {
    try {
      const req = buildEmbedRequest(entry, [text], (env[entry.envKey] || "").trim(), env);
      const res = await fetchFn(req.url, {
        method: "POST", headers: req.headers, body: req.body, signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) throw new Error(`${entry.id} embeddings error ${res.status}`);
      return parseEmbedResponse(await res.json())[0];
    } catch (e: any) {
      // Terminal fallback. Safe on an empty index; on a cloud-built index the store's
      // dim/provider guards below stop a mixed-dim write before it can corrupt anything.
      console.warn(`[RAG] ${entry.id} embed failed (${e?.message ?? e}) → local ollama fallback`);
      return local(text);
    }
  };
  return { embed, providerId: entry.id };
}

const f32 = (v: number[]) => new Uint8Array(new Float32Array(v).buffer);

export interface RagStore {
  index(docId: string, text: string): Promise<{ id: string; dim: number }>;
  search(query: string, k?: number): Promise<{ id: string; text: string; distance: number }[]>;
  close(): void;
}

/**
 * Build a RAG store backed by a dedicated sqlite-vec database. `dbPath` defaults
 * to RAG_DB_PATH or ~/.llm-mission-control/rag.db. The vec0 table is created
 * lazily on first index() using the embedding's dimension (so any embed model /
 * test fake works). `embed` is injectable for deterministic tests.
 */
export function createRagStore(opts: { dbPath?: string; embed?: Embedder; embedProvider?: string } = {}): RagStore {
  const dbPath = opts.dbPath || process.env.RAG_DB_PATH || `${process.env.HOME}/.llm-mission-control/rag.db`;
  const embed = opts.embed || embedText;
  const embedProvider = opts.embedProvider || "ollama-local";
  const db = new DatabaseSync(dbPath, { allowExtension: true });
  db.enableLoadExtension(true);
  sqliteVec.load(db);
  db.exec(`CREATE TABLE IF NOT EXISTS rag_docs (
    rowid INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id TEXT UNIQUE NOT NULL,
    text TEXT NOT NULL
  )`);
  db.exec(`CREATE TABLE IF NOT EXISTS rag_meta (k TEXT PRIMARY KEY, v TEXT)`);

  let dim: number | null = (() => {
    const r = db.prepare("SELECT v FROM rag_meta WHERE k='dim'").get() as { v?: string } | undefined;
    return r?.v ? Number(r.v) : null;
  })();

  // Embed-provider consistency (T2-F1): vectors from different providers/models are not
  // comparable and usually differ in dims — an index is bound to the provider that built
  // it. Legacy DBs (no stored provider) adopt the current one on first guarded call.
  const ensureProvider = () => {
    const r = db.prepare("SELECT v FROM rag_meta WHERE k='embed_provider'").get() as { v?: string } | undefined;
    const stored = r?.v;
    if (!stored) {
      db.prepare("INSERT OR REPLACE INTO rag_meta(k,v) VALUES('embed_provider',?)").run(embedProvider);
      return;
    }
    if (stored !== embedProvider) {
      throw new Error(
        `embed provider mismatch: store built with '${stored}', current EMBED_PROVIDER resolves to '${embedProvider}' ` +
        `(pin EMBED_PROVIDER=${stored} or re-create the RAG db to switch)`,
      );
    }
  };

  const ensureVec = (d: number) => {
    if (dim === null) {
      db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS rag_vec USING vec0(embedding float[${d}])`);
      db.prepare("INSERT OR REPLACE INTO rag_meta(k,v) VALUES('dim',?)").run(String(d));
      dim = d;
    } else if (dim !== d) {
      throw new Error(`embedding dim mismatch: store=${dim} got=${d} (re-create the RAG db to change models)`);
    }
  };

  return {
    async index(docId, text) {
      ensureProvider();
      const vec = await embed(text);
      ensureVec(vec.length);
      // Upsert: drop any prior vector for this doc id, then insert text + vector
      // sharing the same rowid so search can join back to the source text.
      const prior = db.prepare("SELECT rowid FROM rag_docs WHERE doc_id=?").get(docId) as { rowid?: number } | undefined;
      if (prior?.rowid !== undefined) {
        db.prepare("DELETE FROM rag_vec WHERE rowid=?").run(BigInt(prior.rowid));
        db.prepare("DELETE FROM rag_docs WHERE rowid=?").run(BigInt(prior.rowid));
      }
      const ins = db.prepare("INSERT INTO rag_docs(doc_id, text) VALUES(?,?)").run(docId, text);
      const rowid = BigInt(ins.lastInsertRowid); // vec0 requires an integer (bigint) primary key
      db.prepare("INSERT INTO rag_vec(rowid, embedding) VALUES(?,?)").run(rowid, f32(vec));
      return { id: docId, dim: vec.length };
    },
    async search(query, k = 5) {
      ensureProvider();
      if (dim === null) return []; // nothing indexed yet
      const vec = await embed(query);
      ensureVec(vec.length);
      // vec0 needs the LIMIT directly on the MATCH; do KNN in a subquery, then
      // join back to the doc text (a JOIN around MATCH hides the LIMIT from vec0).
      const rows = db
        .prepare(
          `SELECT d.doc_id AS id, d.text AS text, m.distance AS distance
           FROM (SELECT rowid, distance FROM rag_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?) m
           JOIN rag_docs d ON d.rowid = m.rowid
           ORDER BY m.distance`,
        )
        .all(f32(vec), k) as { id: string; text: string; distance: number }[];
      return rows;
    },
    close() {
      db.close();
    },
  };
}

// Default process-wide store for the tools. The embedder resolves from the EMBED_PROVIDER
// pin (cloud free tier with local fallback); no pin keeps the prior embedText/ollama path.
let _store: RagStore | null = null;
function store(): RagStore {
  if (!_store) {
    const r = resolveEmbedder();
    _store = createRagStore({ embed: r.embed, embedProvider: r.providerId });
  }
  return _store;
}
export const ragIndex = (docId: string, text: string) => store().index(docId, text);
export const ragSearch = (query: string, k?: number) => store().search(query, k);
