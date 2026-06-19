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
  {
    version: 2,
    name: "oauth_clients",
    // OAuth 2.1 Dynamic Client Registration (RFC 7591, Faz 15B). Stores DCR-issued
    // client metadata. PK is a text client_id (no auto-increment needed), so the
    // DDL is identical on both dialects.
    up: async (db) => {
      await db.exec(`CREATE TABLE IF NOT EXISTS oauth_clients (
        client_id TEXT PRIMARY KEY,
        client_secret_hash TEXT,
        redirect_uris TEXT NOT NULL DEFAULT '[]',
        grant_types TEXT NOT NULL DEFAULT '[]',
        token_endpoint_auth_method TEXT NOT NULL DEFAULT 'client_secret_basic',
        client_name TEXT,
        registration_access_token_hash TEXT,
        created_at TEXT NOT NULL
      )`);
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
