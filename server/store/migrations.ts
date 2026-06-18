// Versioned schema migrations (Faz 13B). Zero-dep, works on BOTH dialects.
//
// Contract: initStore()'s `CREATE TABLE IF NOT EXISTS` DDL is the BASELINE — a
// fresh DB already gets the current schema. Migrations carry schema EVOLUTION
// from here forward. A new schema change is added as a new MIGRATIONS entry,
// NOT by editing the baseline DDL. Each `up` is idempotent and dialect-aware.
//
// runMigrations() is wrapped in a cross-replica advisory lock (db.withLock) so
// concurrent multi-replica boots apply each version exactly once, in order.

import type { DbClient } from "./db-adapter";

export interface Migration {
  version: number;
  name: string;
  up: (db: DbClient) => Promise<void>;
}

// Advisory-lock key (arbitrary constant, unique to this app's migration runner).
const MIGRATION_LOCK_KEY = 778124;

// Ordered, append-only. Never renumber or mutate a shipped migration — add a new
// one. `up` must be idempotent (IF NOT EXISTS / guarded) so a retry is safe.
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "usage_events_ts_index",
    // Speeds up time-bucketed usage queries on large pg deployments. Harmless on
    // sqlite. Demonstrates the dialect-agnostic migration path (Faz 13B baseline).
    up: async (db) => {
      await db.exec("CREATE INDEX IF NOT EXISTS idx_usage_events_ts ON usage_events(ts)");
    },
  },
];

/** Apply all pending migrations in order under a cross-replica lock. Idempotent:
 *  a second run (or a second replica) is a no-op once versions are recorded. */
export async function runMigrations(db: DbClient): Promise<number[]> {
  const applied: number[] = [];
  await db.withLock(MIGRATION_LOCK_KEY, async () => {
    await db.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)"
    );
    const done = new Set(
      (await db.query("SELECT version FROM schema_migrations")).rows.map((r) => Number(r.version))
    );
    for (const m of [...MIGRATIONS].sort((a, b) => a.version - b.version)) {
      if (done.has(m.version)) continue;
      await m.up(db);
      await db.run("INSERT INTO schema_migrations (version, name, applied_at) VALUES (?,?,?)", [
        m.version,
        m.name,
        new Date().toISOString(),
      ]);
      applied.push(m.version);
    }
  });
  return applied;
}
