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
export function createRagStore(opts: { dbPath?: string; embed?: Embedder } = {}): RagStore {
  const dbPath = opts.dbPath || process.env.RAG_DB_PATH || `${process.env.HOME}/.llm-mission-control/rag.db`;
  const embed = opts.embed || embedText;
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

// Default process-wide store for the tools (production path → embedText/ollama).
let _store: RagStore | null = null;
function store(): RagStore {
  if (!_store) _store = createRagStore();
  return _store;
}
export const ragIndex = (docId: string, text: string) => store().index(docId, text);
export const ragSearch = (query: string, k?: number) => store().search(query, k);
