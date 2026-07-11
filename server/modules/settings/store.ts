// O8 settings module store — the ONLY place this module touches persistence,
// exclusively through the _core/store facade (never server/store directly; the
// eslint import-guard enforces this, server/store/__tests__/module-migrations.test.ts).
// Claims v14 off the GLOBAL ledger in server/modules/registry.ts. NOTE: the
// ledger comment there pencils "v11 O8 security: tenants.role + totp_secrets"
// for this feature, but this task was explicitly told the parallel email-panel
// agent claims v11 — so this module claims v14 instead (the next free slot
// after v13 documents) to avoid a migration-version collision between the two
// concurrently-running agents. The v11 ledger line is left untouched (owned by
// the email lane); only a new v14 row + updated "free pool" marker are appended.
//
// TOTP secrets are AES-256-GCM encrypted via the EXISTING server/db.ts SecureDB
// singleton (`db.encrypt`/`db.decrypt`, master-key-backed, fail-closed) — no new
// crypto primitive, per docs/odyssey/07-security.md GAP-1. This is a plain
// `server/db` import (not `server/store`), which the lint guard does not
// restrict (server/backup.ts, server/providers.ts etc. already do the same).
import crypto from "node:crypto";
import type { Migration } from "../../store/migrations";
import { getModuleDb } from "../_core/store";
import { db as secureDb } from "../../db";
import type { Capability, GeneralPrefs, PermMatrix, RoleName, RoleRecord, SessionRecord, ToolId, ToolPolicyRecord } from "./schema";
import { CAPABILITIES, ROLE_NAMES, TOOL_IDS } from "./schema";

const TOTP_TABLE = "module_settings_totp";
const BACKUP_TABLE = "module_settings_backup_codes";
const ROLES_TABLE = "module_settings_roles";
const TOOL_POLICY_TABLE = "module_settings_tool_policy";
const PREFS_TABLE = "module_settings_prefs";
const SESSIONS_TABLE = "module_settings_sessions";

const DEFAULT_ROLE_PERMS: Record<RoleName, { locked: boolean; kind: string; perms: PermMatrix }> = {
  owner: {
    locked: true,
    kind: "Full access",
    perms: { models: "allow", tools: "allow", vault: "allow", users: "allow", daemon: "allow" },
  },
  admin: {
    locked: false,
    kind: "Administrator",
    perms: { models: "allow", tools: "allow", vault: "allow", users: "allow", daemon: "scoped" },
  },
  operator: {
    locked: false,
    kind: "Operator",
    perms: { models: "allow", tools: "scoped", vault: "deny", users: "deny", daemon: "deny" },
  },
  viewer: {
    locked: false,
    kind: "Read-only",
    perms: { models: "allow", tools: "deny", vault: "deny", users: "deny", daemon: "deny" },
  },
  agent: {
    locked: false,
    kind: "Service account",
    perms: { models: "allow", tools: "scoped", vault: "deny", users: "deny", daemon: "deny" },
  },
};

const DEFAULT_TOOL_POLICY: Record<ToolId, { policy: "allow" | "ask" | "deny"; scope: string }> = {
  net: { policy: "ask", scope: "*" },
  fsr: { policy: "allow", scope: "workspace" },
  fsw: { policy: "ask", scope: "workspace" },
  sh: { policy: "ask", scope: "workspace" },
  py: { policy: "ask", scope: "workspace" },
  mcp: { policy: "ask", scope: "*" },
  clip: { policy: "allow", scope: "local" },
  mem: { policy: "allow", scope: "local" },
};

export const MIGRATION_V14_SETTINGS: Migration = {
  version: 14,
  name: "o8_settings_core",
  up: async (db) => {
    await db.exec(`CREATE TABLE IF NOT EXISTS ${TOTP_TABLE} (
      id TEXT PRIMARY KEY DEFAULT 'local',
      secret_enc TEXT,
      pending_secret_enc TEXT,
      enabled INTEGER NOT NULL DEFAULT 0,
      last_counter INTEGER NOT NULL DEFAULT -1,
      updated_at TEXT NOT NULL
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS ${BACKUP_TABLE} (
      id TEXT PRIMARY KEY,
      code_hash TEXT NOT NULL,
      used INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS ${ROLES_TABLE} (
      name TEXT PRIMARY KEY,
      locked INTEGER NOT NULL DEFAULT 0,
      kind TEXT NOT NULL DEFAULT '',
      perms TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS ${TOOL_POLICY_TABLE} (
      tool TEXT PRIMARY KEY,
      policy TEXT NOT NULL,
      scope TEXT NOT NULL DEFAULT '*',
      updated_at TEXT NOT NULL
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS ${PREFS_TABLE} (
      id TEXT PRIMARY KEY DEFAULT 'local',
      theme TEXT NOT NULL DEFAULT 'dark',
      density TEXT NOT NULL DEFAULT 'comfortable',
      language TEXT NOT NULL DEFAULT 'en-US',
      reduce_motion INTEGER NOT NULL DEFAULT 0,
      sandbox_enforced INTEGER NOT NULL DEFAULT 1
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS ${SESSIONS_TABLE} (
      id TEXT PRIMARY KEY,
      client TEXT NOT NULL,
      ip TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT '',
      last_active TEXT NOT NULL,
      is_current INTEGER NOT NULL DEFAULT 0,
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`);

    const now = new Date().toISOString();
    for (const name of ROLE_NAMES) {
      const def = DEFAULT_ROLE_PERMS[name];
      await db.run(
        `INSERT OR IGNORE INTO ${ROLES_TABLE} (name, locked, kind, perms, updated_at) VALUES (?,?,?,?,?)`,
        [name, def.locked ? 1 : 0, def.kind, JSON.stringify(def.perms), now],
      );
    }
    for (const tool of TOOL_IDS) {
      const def = DEFAULT_TOOL_POLICY[tool];
      await db.run(
        `INSERT OR IGNORE INTO ${TOOL_POLICY_TABLE} (tool, policy, scope, updated_at) VALUES (?,?,?,?)`,
        [tool, def.policy, def.scope, now],
      );
    }
    await db.run(`INSERT OR IGNORE INTO ${PREFS_TABLE} (id) VALUES ('local')`);
  },
  down: async (db) => {
    await db.exec(`DROP TABLE IF EXISTS ${SESSIONS_TABLE}`);
    await db.exec(`DROP TABLE IF EXISTS ${PREFS_TABLE}`);
    await db.exec(`DROP TABLE IF EXISTS ${TOOL_POLICY_TABLE}`);
    await db.exec(`DROP TABLE IF EXISTS ${ROLES_TABLE}`);
    await db.exec(`DROP TABLE IF EXISTS ${BACKUP_TABLE}`);
    await db.exec(`DROP TABLE IF EXISTS ${TOTP_TABLE}`);
  },
};

// ── TOTP ──────────────────────────────────────────────────────────────────────

export interface TotpRow {
  secret: string | null;
  pendingSecret: string | null;
  enabled: boolean;
  lastCounter: number;
}

export async function readTotp(): Promise<TotpRow> {
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT * FROM ${TOTP_TABLE} WHERE id = 'local'`);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return { secret: null, pendingSecret: null, enabled: false, lastCounter: -1 };
  return {
    secret: row.secret_enc ? secureDb.decrypt(String(row.secret_enc)) : null,
    pendingSecret: row.pending_secret_enc ? secureDb.decrypt(String(row.pending_secret_enc)) : null,
    enabled: Number(row.enabled) === 1,
    lastCounter: Number(row.last_counter ?? -1),
  };
}

export async function writePendingSecret(plaintextSecret: string): Promise<void> {
  const db = await getModuleDb();
  const enc = secureDb.encrypt(plaintextSecret);
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO ${TOTP_TABLE} (id, pending_secret_enc, enabled, last_counter, updated_at) VALUES ('local', ?, 0, -1, ?)
     ON CONFLICT(id) DO UPDATE SET pending_secret_enc = excluded.pending_secret_enc, updated_at = excluded.updated_at`,
    [enc, now],
  );
}

export async function activateSecret(plaintextSecret: string, counter: number): Promise<void> {
  const db = await getModuleDb();
  const enc = secureDb.encrypt(plaintextSecret);
  const now = new Date().toISOString();
  await db.run(
    `UPDATE ${TOTP_TABLE} SET secret_enc = ?, pending_secret_enc = NULL, enabled = 1, last_counter = ?, updated_at = ? WHERE id = 'local'`,
    [enc, counter, now],
  );
}

export async function setLastCounter(counter: number): Promise<void> {
  const db = await getModuleDb();
  await db.run(`UPDATE ${TOTP_TABLE} SET last_counter = ? WHERE id = 'local'`, [counter]);
}

export async function disableTotp(): Promise<void> {
  const db = await getModuleDb();
  await db.run(
    `UPDATE ${TOTP_TABLE} SET secret_enc = NULL, pending_secret_enc = NULL, enabled = 0, last_counter = -1 WHERE id = 'local'`,
  );
  await db.run(`DELETE FROM ${BACKUP_TABLE}`);
}

export async function insertBackupCodes(hashes: string[]): Promise<void> {
  const db = await getModuleDb();
  await db.run(`DELETE FROM ${BACKUP_TABLE}`);
  const now = new Date().toISOString();
  for (const hash of hashes) {
    await db.run(`INSERT INTO ${BACKUP_TABLE} (id, code_hash, used, created_at) VALUES (?,?,0,?)`, [
      crypto.randomUUID(),
      hash,
      now,
    ]);
  }
}

export async function countUnusedBackupCodes(): Promise<number> {
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT COUNT(*) as n FROM ${BACKUP_TABLE} WHERE used = 0`);
  return Number((rows[0] as { n?: unknown })?.n ?? 0);
}

/** Consume a backup code if it matches an unused hash. Returns true iff consumed. */
export async function consumeBackupCode(hash: string): Promise<boolean> {
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT id FROM ${BACKUP_TABLE} WHERE code_hash = ? AND used = 0`, [hash]);
  const row = rows[0] as { id?: unknown } | undefined;
  if (!row?.id) return false;
  await db.run(`UPDATE ${BACKUP_TABLE} SET used = 1 WHERE id = ?`, [row.id]);
  return true;
}

// ── Roles ─────────────────────────────────────────────────────────────────────

function rowToRole(r: Record<string, unknown>): RoleRecord {
  return {
    name: String(r.name) as RoleName,
    locked: Number(r.locked) === 1,
    kind: String(r.kind ?? ""),
    perms: JSON.parse(String(r.perms)) as PermMatrix,
  };
}

export async function listRoles(): Promise<RoleRecord[]> {
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT * FROM ${ROLES_TABLE} ORDER BY name`);
  return rows.map(rowToRole);
}

export async function getRole(name: RoleName): Promise<RoleRecord | undefined> {
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT * FROM ${ROLES_TABLE} WHERE name = ?`, [name]);
  return rows[0] ? rowToRole(rows[0]) : undefined;
}

export async function updateRolePerms(name: RoleName, patch: Partial<PermMatrix>): Promise<RoleRecord | undefined> {
  const existing = await getRole(name);
  if (!existing) return undefined;
  const merged: PermMatrix = { ...existing.perms };
  for (const cap of CAPABILITIES as readonly Capability[]) {
    if (patch[cap] !== undefined) merged[cap] = patch[cap] as PermMatrix[Capability];
  }
  const db = await getModuleDb();
  await db.run(`UPDATE ${ROLES_TABLE} SET perms = ?, updated_at = ? WHERE name = ?`, [
    JSON.stringify(merged),
    new Date().toISOString(),
    name,
  ]);
  return { ...existing, perms: merged };
}

// ── Tool policy ───────────────────────────────────────────────────────────────

function rowToToolPolicy(r: Record<string, unknown>): Omit<ToolPolicyRecord, "tierRef"> {
  return {
    tool: String(r.tool) as ToolId,
    policy: String(r.policy) as ToolPolicyRecord["policy"],
    scope: String(r.scope ?? "*"),
  };
}

export async function listToolPolicy(): Promise<Omit<ToolPolicyRecord, "tierRef">[]> {
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT * FROM ${TOOL_POLICY_TABLE} ORDER BY tool`);
  return rows.map(rowToToolPolicy);
}

export async function updateToolPolicy(
  tool: ToolId,
  patch: { policy?: ToolPolicyRecord["policy"]; scope?: string },
): Promise<Omit<ToolPolicyRecord, "tierRef"> | undefined> {
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT * FROM ${TOOL_POLICY_TABLE} WHERE tool = ?`, [tool]);
  const existing = rows[0] ? rowToToolPolicy(rows[0]) : undefined;
  if (!existing) return undefined;
  const merged = { ...existing, ...patch };
  await db.run(`UPDATE ${TOOL_POLICY_TABLE} SET policy = ?, scope = ?, updated_at = ? WHERE tool = ?`, [
    merged.policy,
    merged.scope,
    new Date().toISOString(),
    tool,
  ]);
  return merged;
}

// ── General prefs ─────────────────────────────────────────────────────────────

export async function readPrefs(): Promise<GeneralPrefs> {
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT * FROM ${PREFS_TABLE} WHERE id = 'local'`);
  const row = rows[0] as Record<string, unknown> | undefined;
  return {
    theme: (row?.theme as GeneralPrefs["theme"]) ?? "dark",
    density: (row?.density as GeneralPrefs["density"]) ?? "comfortable",
    language: String(row?.language ?? "en-US"),
    reduceMotion: Number(row?.reduce_motion ?? 0) === 1,
  };
}

export async function writePrefs(patch: Partial<GeneralPrefs>): Promise<GeneralPrefs> {
  const existing = await readPrefs();
  const merged: GeneralPrefs = { ...existing, ...patch };
  const db = await getModuleDb();
  await db.run(
    `UPDATE ${PREFS_TABLE} SET theme = ?, density = ?, language = ?, reduce_motion = ? WHERE id = 'local'`,
    [merged.theme, merged.density, merged.language, merged.reduceMotion ? 1 : 0],
  );
  return merged;
}

export async function readSandboxEnforced(): Promise<boolean> {
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT sandbox_enforced FROM ${PREFS_TABLE} WHERE id = 'local'`);
  const row = rows[0] as { sandbox_enforced?: unknown } | undefined;
  return Number(row?.sandbox_enforced ?? 1) === 1;
}

export async function writeSandboxEnforced(enforced: boolean): Promise<void> {
  const db = await getModuleDb();
  await db.run(`UPDATE ${PREFS_TABLE} SET sandbox_enforced = ? WHERE id = 'local'`, [enforced ? 1 : 0]);
}

// ── Sessions (module-local — no existing auth-session-list surface to read;
// docs/odyssey/07-security.md's auth layer tracks tenants/API-keys, not
// interactive device sessions, so this module owns a minimal session record
// seeded with the current local device on first read) ────────────────────────

function rowToSession(r: Record<string, unknown>): SessionRecord {
  return {
    id: String(r.id),
    client: String(r.client),
    ip: String(r.ip),
    location: String(r.location ?? ""),
    lastActive: String(r.last_active),
    current: Number(r.is_current) === 1,
  };
}

async function ensureSeedSession(): Promise<void> {
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT COUNT(*) as n FROM ${SESSIONS_TABLE}`);
  if (Number((rows[0] as { n?: unknown })?.n ?? 0) > 0) return;
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO ${SESSIONS_TABLE} (id, client, ip, location, last_active, is_current, revoked, created_at) VALUES (?,?,?,?,?,1,0,?)`,
    ["local-current", "This device (local workspace)", "127.0.0.1", "Local", now, now],
  );
}

export async function listSessions(): Promise<SessionRecord[]> {
  await ensureSeedSession();
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT * FROM ${SESSIONS_TABLE} WHERE revoked = 0 ORDER BY is_current DESC, last_active DESC`);
  return rows.map(rowToSession);
}

/** Revoke a non-current session. Returns false if not found, already revoked,
 *  or (deliberately) the current session — a session can't revoke itself here,
 *  mirroring design.html (Revoke button only rendered for `s.notCurrent`). */
export async function revokeSession(id: string): Promise<boolean> {
  await ensureSeedSession();
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT * FROM ${SESSIONS_TABLE} WHERE id = ? AND revoked = 0`, [id]);
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row) return false;
  if (Number(row.is_current) === 1) return false;
  await db.run(`UPDATE ${SESSIONS_TABLE} SET revoked = 1 WHERE id = ?`, [id]);
  return true;
}
