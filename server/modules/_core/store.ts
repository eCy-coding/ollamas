// O0 _core store facade (02-o0-foundation.md §2.1, decision K1) — the SINGLE
// access seam modules get to persistence. Deliberately thin: the real layer is
// the existing server/store (dual-dialect DbClient, WAL, withLock, closeStore
// lifecycle) — a second DB layer would duplicate all of that and fall outside
// the single migration ledger. Modules import ONLY from here; importing
// server/store directly from server/modules/** fails lint (no-restricted-imports,
// enforced by server/store/__tests__/module-migrations.test.ts).
import { initStore } from "../../store";
import { MIGRATIONS, runMigrations } from "../../store/migrations";
import type { DbClient } from "../../store/db-adapter";
import { openVectorCollection, type VectorStore } from "../../store/vector";
import type { Embedder } from "../../rag";
import { allModuleMigrations } from "../registry";

export type { DbClient, VectorStore, Embedder };

// Lazy-init (KN-O5): under OLLAMAS_NO_AUTOBOOT=1 the store is not booted, so the
// facade initializes on first use — initStore() is idempotent (store/index.ts:86)
// and already runs the CORE migrations; here the COMBINED core+module list runs
// once per process so module tables (v7+) exist before any module query.
let moduleMigrationsDone = false;

/** Narrowed DbClient for module tables. Ensures core + module migrations ran. */
export async function getModuleDb(): Promise<DbClient> {
  const db = await initStore();
  if (!moduleMigrationsDone) {
    await runMigrations(db, [...MIGRATIONS, ...allModuleMigrations()]);
    moduleMigrationsDone = true;
  }
  return db;
}

/** Per-module vector collection (K2: one sqlite-vec file per collection). */
export function getVectorCollection(
  name: string,
  opts: { baseDir?: string; embed?: Embedder; embedProvider?: string } = {},
): VectorStore {
  return openVectorCollection(name, opts);
}
