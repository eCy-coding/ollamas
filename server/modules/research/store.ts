// O2 research module store — persistence ONLY through the O0 _core/store facade
// (never server/store directly — the module-migrations lint guard enforces
// this), exactly like server/modules/demo/store.ts and server/modules/notes-tasks/
// store.ts. Table = research_runs, claiming v12 off the GLOBAL ledger in
// server/modules/registry.ts (v10 calendar, v11 security reserved; v12+ free
// pool) — the migration is declared HERE and passed via `migrations:` in
// index.ts's defineModule(), NOT appended to the core server/store/migrations.ts
// MIGRATIONS array (that array is a closed 1..7 set asserted by
// tests/migration-uniqueness.test.ts; module tables merge in via
// allModuleMigrations(), server/modules/_core/store.ts:getModuleDb()).
// Cross-run RAG retrieval reuses server/rag.ts DIRECTLY inside the shared
// pipeline (server/research/pipeline.ts) rather than a per-module vector
// collection — the plan's explicit reuse decision (§1.1 "Kalıcı bilgi").
import crypto from "node:crypto";
import type { Migration } from "../../store/migrations";
import { getModuleDb } from "../_core/store";
import type { Citation } from "../../research/report";
import type { SourceSummary } from "../../research/summarize";
import type { ResearchRunListItem } from "./schema";

const RUNS_TABLE = "research_runs";

export const MIGRATION_V12_RESEARCH_RUNS: Migration = {
  version: 12,
  name: "o2_research_runs",
  // Persists each deep_research run (question/report/citations/sources as JSON
  // text — no relational fan-out needed for a read-mostly history list).
  up: async (db) => {
    await db.exec(`CREATE TABLE IF NOT EXISTS ${RUNS_TABLE} (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      report TEXT NOT NULL,
      citations TEXT NOT NULL,
      sources TEXT NOT NULL,
      source_backend TEXT,
      created_at TEXT NOT NULL
    )`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_research_runs_created_at ON ${RUNS_TABLE}(created_at)`);
  },
  down: async (db) => {
    await db.exec(`DROP INDEX IF EXISTS idx_research_runs_created_at`);
    await db.exec(`DROP TABLE IF EXISTS ${RUNS_TABLE}`);
  },
};

export interface StoredRun {
  id: string;
  question: string;
  report: string;
  citations: Citation[];
  sources: SourceSummary[];
  source_backend?: string;
  created_at: string;
}

export async function saveRun(run: {
  question: string;
  report: string;
  citations: Citation[];
  sources: SourceSummary[];
  sourceBackend?: string;
}): Promise<StoredRun> {
  const db = await getModuleDb();
  const rec: StoredRun = {
    id: crypto.randomUUID(),
    question: run.question,
    report: run.report,
    citations: run.citations,
    sources: run.sources,
    source_backend: run.sourceBackend,
    created_at: new Date().toISOString(),
  };
  await db.run(
    "INSERT INTO research_runs (id, question, report, citations, sources, source_backend, created_at) VALUES (?,?,?,?,?,?,?)",
    [rec.id, rec.question, rec.report, JSON.stringify(rec.citations), JSON.stringify(rec.sources), rec.source_backend ?? null, rec.created_at],
  );
  return rec;
}

export async function listRuns(): Promise<ResearchRunListItem[]> {
  const db = await getModuleDb();
  const { rows } = await db.query("SELECT id, question, created_at FROM research_runs ORDER BY created_at DESC");
  return rows as ResearchRunListItem[];
}
