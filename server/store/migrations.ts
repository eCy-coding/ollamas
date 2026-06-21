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

// Guarded ADD COLUMN: sqlite has no `ADD COLUMN IF NOT EXISTS`, so a retry that
// finds the column already present (duplicate) is a no-op. Retro-added columns
// are nullable — a NOT NULL add would fail on an already-populated table; the
// NOT NULL contract still holds for fresh DBs via the baseline CREATE TABLE.
async function addColumnIfMissing(db: DbClient, table: string, columnDdl: string): Promise<void> {
  try {
    await db.exec(`ALTER TABLE ${table} ADD COLUMN ${columnDdl}`);
  } catch (e: any) {
    if (!/duplicate column|already exists/i.test(String(e?.message))) throw e;
  }
}

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
  {
    version: 3,
    name: "oauth_authorization_server",
    // OAuth 2.1 Authorization Server (Faz 19, v1.10). Authorization codes + issued
    // access tokens for the authorization_code + PKCE flow. Tokens are OPAQUE and
    // stored as SHA-256 hashes (same one-way handling as api_keys). A client is
    // bound to a tenant at DCR time (oauth_clients.tenant_id) so authorize() can
    // auto-consent. Text PKs → identical DDL on both dialects.
    up: async (db) => {
      await db.exec(`CREATE TABLE IF NOT EXISTS oauth_codes (
        code TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        code_challenge TEXT NOT NULL,
        code_challenge_method TEXT NOT NULL DEFAULT 'S256',
        redirect_uri TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '',
        resource TEXT,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`);
      await db.exec(`CREATE TABLE IF NOT EXISTS oauth_tokens (
        token_hash TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '',
        resource TEXT,
        expires_at TEXT NOT NULL,
        revoked INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`);
      // Bind a DCR client to its owning tenant (nullable; anonymous DCR stays null
      // and cannot complete authorize). Guarded: ADD COLUMN has no IF NOT EXISTS on
      // sqlite, so a retry that finds the column already present is a no-op.
      try { await db.exec("ALTER TABLE oauth_clients ADD COLUMN tenant_id TEXT"); }
      catch (e: any) { if (!/duplicate column|already exists/i.test(String(e?.message))) throw e; }
    },
  },
  {
    version: 4,
    name: "oauth_refresh_tokens",
    // OAuth 2.1 refresh tokens with RFC 9700 rotation (Faz 22, v1.13). Each refresh
    // token belongs to a `family_id` (the chain born from one authorization grant).
    // On use a token is marked used=1 and a new one is issued in the same family;
    // presenting an already-used token (replay/theft) revokes the WHOLE family
    // (reuse detection). Opaque, SHA-256-hashed. Text PKs → identical on both dialects.
    up: async (db) => {
      await db.exec(`CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
        refresh_token_hash TEXT PRIMARY KEY,
        family_id TEXT NOT NULL,
        client_id TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        scopes TEXT NOT NULL DEFAULT '',
        resource TEXT,
        expires_at TEXT NOT NULL,
        used INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      )`);
      // Drift repair: if an older-shaped oauth_refresh_tokens already exists, the
      // CREATE TABLE IF NOT EXISTS above is a no-op and the family_id index below
      // would fail with "no such column: family_id" (boot crash). Guarded-add the
      // required columns first so the migration is idempotent against drift, per
      // the file's own "up must be idempotent/guarded" contract.
      for (const col of [
        "family_id TEXT",
        "client_id TEXT",
        "tenant_id TEXT",
        "scopes TEXT",
        "resource TEXT",
        "expires_at TEXT",
        "used INTEGER",
        "created_at TEXT",
      ]) {
        await addColumnIfMissing(db, "oauth_refresh_tokens", col);
      }
      await db.exec("CREATE INDEX IF NOT EXISTS idx_oauth_refresh_family ON oauth_refresh_tokens(family_id)");
    },
  },
  {
    version: 5,
    name: "ukp_stage_events",
    // UKP inbound stage-event webhook receiver (feat/ukp-ingest-receiver). Stores
    // every signed delivery exactly once — id is sha256(t.raw) so duplicate POSTs
    // (retries, replays) are naturally deduplicated by the PRIMARY KEY conflict.
    up: async (db) => {
      await db.exec(`CREATE TABLE IF NOT EXISTS ukp_stage_events (
        id TEXT PRIMARY KEY,
        event_type TEXT,
        payload TEXT,
        ts INTEGER,
        received_at TEXT
      )`);
    },
  },
  {
    version: 6,
    name: "ukp_stage_events_ts_index",
    // Speeds up retention prune (DELETE WHERE ts < cutoff) and ts-DESC list scans
    // on ukp_stage_events. Mirrors the usage_events_ts_index pattern (v1 above).
    up: async (db) => {
      await db.exec("CREATE INDEX IF NOT EXISTS idx_ukp_stage_events_ts ON ukp_stage_events(ts)");
    },
  },
];

// Fail fast at module load on a duplicate migration version. A typo'd duplicate
// silently SKIPS on an existing DB (version already in schema_migrations) yet runs
// twice on a fresh DB → divergent schema. Cheap invariant, caught at boot not prod.
{
  const seenVersions = new Set<number>();
  for (const m of MIGRATIONS) {
    if (seenVersions.has(m.version)) throw new Error(`Duplicate migration version ${m.version} (${m.name})`);
    seenVersions.add(m.version);
  }
}

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
