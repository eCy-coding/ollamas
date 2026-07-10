// O0 VectorStore (02-o0-foundation.md §2.2, decision K2) — collection = ONE
// sqlite-vec file per collection under <dataDir>/vec/<name>.db, wrapping
// createRagStore() (server/rag.ts) unchanged: its injectable Embedder,
// provider-lock and dim-lock therefore apply PER COLLECTION (a module may use
// a different embed model without fighting a global lock). The global rag.db
// used by the rag_index/rag_search tools is untouched (regression-free).
//
// delete() is the one operation rag.ts lacks; it reuses the exact row-removal
// pattern of RagStore.index()'s upsert (rag.ts:132-135) over a second
// extension-enabled connection to the same file (vec0 rows need sqlite-vec
// loaded on the deleting connection too).
import { DatabaseSync } from "node:sqlite";
import * as sqliteVec from "sqlite-vec";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRagStore, type Embedder, type RagStore } from "../rag";

export interface VectorStore {
  upsert(id: string, text: string): Promise<{ id: string; dim: number }>;
  query(text: string, k?: number): Promise<{ id: string; text: string; distance: number }[]>;
  delete(id: string): Promise<void>;
  close(): void;
}

// Same shape as module ids — also blocks path traversal in the file name.
const NAME_RE = /^[a-z][a-z0-9-]*$/;

function defaultBaseDir(): string {
  const dataDir = process.env.MISSION_CONTROL_DATA_DIR || path.join(os.homedir(), ".llm-mission-control");
  return path.join(dataDir, "vec");
}

/** Open (or create) the named vector collection. Embedder is injectable so
 *  tests run without ollama (rag.ts:13 pattern). */
export function openVectorCollection(
  name: string,
  opts: { baseDir?: string; embed?: Embedder; embedProvider?: string } = {},
): VectorStore {
  if (!NAME_RE.test(name)) {
    throw new Error(`invalid vector collection name '${name}' (must match ${NAME_RE})`);
  }
  const baseDir = opts.baseDir || defaultBaseDir();
  fs.mkdirSync(baseDir, { recursive: true });
  const dbPath = path.join(baseDir, `${name}.db`);
  const store: RagStore = createRagStore({ dbPath, embed: opts.embed, embedProvider: opts.embedProvider });

  // Lazy second connection for delete(); opened only when delete is first used.
  let del: DatabaseSync | null = null;
  const delDb = (): DatabaseSync => {
    if (!del) {
      del = new DatabaseSync(dbPath, { allowExtension: true });
      del.enableLoadExtension(true);
      sqliteVec.load(del);
    }
    return del;
  };

  return {
    upsert: (id, text) => store.index(id, text),
    query: (text, k) => store.search(text, k),
    async delete(id) {
      const db = delDb();
      const prior = db.prepare("SELECT rowid FROM rag_docs WHERE doc_id=?").get(id) as { rowid?: number } | undefined;
      if (prior?.rowid === undefined) return; // absent → no-op (idempotent)
      db.prepare("DELETE FROM rag_vec WHERE rowid=?").run(BigInt(prior.rowid));
      db.prepare("DELETE FROM rag_docs WHERE rowid=?").run(BigInt(prior.rowid));
    },
    close() {
      try { del?.close(); } catch { /* already closed */ }
      del = null;
      store.close();
    },
  };
}
