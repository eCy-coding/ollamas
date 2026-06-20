// Multi-tenant SaaS store (Faz 2; Faz 12 = async + Postgres). Unified async API
// over node:sqlite (default) OR Postgres (DATABASE_URL set → multi-replica). All
// exports are async and route through the db-adapter; SQLite stays the zero-config
// default. Holds tenants, API keys (hashed), plans, usage, invoices, audit,
// upstreams, webhooks.

import crypto from "node:crypto";
import type { ToolTier } from "../tool-registry";
import { createAdapter, type DbClient } from "./db-adapter";
import { runMigrations } from "./migrations";
export { runMigrations, MIGRATIONS } from "./migrations";

export interface Plan { id: string; name: string; rate_per_min: number; monthly_quota: number; allowed_tiers: ToolTier[]; }
export interface Tenant { id: string; name: string; plan_id: string; stripe_customer_id?: string | null; created_at: string; }
export interface ResolvedKey { tenantId: string; keyId: string; plan: Plan; scopes: string[]; }
export interface UsageEvent { tenantId: string; tool: string; tier: ToolTier; ok: boolean; latencyMs: number; tokens?: number; cost?: number; }

let db: DbClient | null = null;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const nowIso = () => new Date().toISOString();
// Billing period key. UTC by contract — quotas reset at 00:00 UTC on the 1st.
const monthKey = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

function d(): DbClient {
  if (!db) throw new Error("Store not initialized — call initStore() first.");
  return db;
}

/** Close the DB (pg pool.end / sqlite close) and reset. Idempotent — safe on
 *  graceful shutdown and between test runs. After this, initStore() re-opens. */
export async function closeStore(): Promise<void> {
  if (!db) return;
  const cur = db;
  db = null;
  await cur.close();
}

/** Liveness check for readiness probes: true if the DB answers a trivial query.
 *  Never throws — returns false on any error (pg down, not initialized). */
export async function pingStore(): Promise<boolean> {
  try { await d().query("SELECT 1 AS ok"); return true; }
  catch { return false; }
}

/** Run pending schema migrations against the live store; returns applied versions. */
export async function migrateNow(): Promise<number[]> { return runMigrations(d()); }
/** Recorded migration versions (ascending). */
export async function appliedVersions(): Promise<number[]> {
  return (await d().query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((r) => Number(r.version));
}

// --- Observability accessors (Faz 14C) — null-safe before initStore() ---
/** pg connection-pool counters; null on sqlite or before init. */
export function poolStats() { return db ? db.stats() : null; }
/** Highest applied migration version (0 if none / not initialized). */
export async function migrationVersion(): Promise<number> {
  if (!db) return 0;
  try { const v = await appliedVersions(); return v.length ? Math.max(...v) : 0; } catch { return 0; }
}
/** Count of webhook deliveries still pending (queue depth). */
export async function pendingDeliveryCount(): Promise<number> {
  if (!db) return 0;
  try { return Number((await d().query("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE status='pending'")).rows[0].n); }
  catch { return 0; }
}

// Postgres can race when several replicas run `CREATE TABLE IF NOT EXISTS` / seed
// concurrently at boot — the shared catalog raises transient unique/duplicate
// errors even though each statement is idempotent. Retry so concurrent boots
// converge (multi-replica is the whole point of the pg path). sqlite is
// single-writer per file, so these codes never fire there.
const TRANSIENT_INIT_CODES = new Set(["40001", "40P01", "23505", "42P07", "42710", "XX000"]);
async function withInitRetry(fn: () => Promise<void>): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try { await fn(); return; }
    catch (e: any) {
      if (attempt >= 5 || !TRANSIENT_INIT_CODES.has(e?.code)) throw e;
      await new Promise((r) => setTimeout(r, 30 * (attempt + 1)));
    }
  }
}

/** Idempotent: create the DB + tables and seed default plans. Call once at boot. */
export async function initStore(): Promise<DbClient> {
  if (db) return db;
  db = await createAdapter();
  console.log(`[Store] dialect=${db.dialect}${db.dialect === "pg" ? ` poolSize=${process.env.DB_POOL_SIZE || 5}` : ""}`);
  // Dialect-specific auto-increment PK; PRAGMA only on sqlite.
  const AUTO = db.dialect === "pg" ? "BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT";
  if (db.dialect === "sqlite") await db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  await withInitRetry(() => d().exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      rate_per_min INTEGER NOT NULL DEFAULT 60, monthly_quota INTEGER NOT NULL DEFAULT 0,
      allowed_tiers TEXT NOT NULL DEFAULT 'safe'
    );
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, plan_id TEXT NOT NULL REFERENCES plans(id),
      stripe_customer_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
      key_hash TEXT NOT NULL UNIQUE, label TEXT, scopes TEXT NOT NULL DEFAULT '',
      revoked INTEGER NOT NULL DEFAULT 0, expires_at TEXT, last_used_at TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
    CREATE TABLE IF NOT EXISTS usage_events (
      id ${AUTO}, tenant_id TEXT NOT NULL, tool TEXT NOT NULL, tier TEXT NOT NULL,
      ok INTEGER NOT NULL, latency_ms INTEGER NOT NULL,
      tokens INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0, month TEXT NOT NULL, ts TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_tenant_month ON usage_events(tenant_id, month);
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
      period TEXT NOT NULL, amount REAL NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_tenant_period ON invoices(tenant_id, period);
    CREATE TABLE IF NOT EXISTS audit_events (
      id ${AUTO}, tenant_id TEXT NOT NULL, tool TEXT NOT NULL, tier TEXT NOT NULL, ok INTEGER NOT NULL, ts TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_events(tenant_id, ts);
    CREATE TABLE IF NOT EXISTS billing_config (k TEXT PRIMARY KEY, v TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, ts TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS upstream_servers (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
      name TEXT NOT NULL, transport TEXT NOT NULL, url TEXT, command TEXT, args TEXT, allowed_tools TEXT, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_upstream_tenant ON upstream_servers(tenant_id);
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
      url TEXT NOT NULL, events TEXT NOT NULL, secret TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_webhooks_tenant ON webhooks(tenant_id);
    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
      event_type TEXT NOT NULL, payload TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending', last_code INTEGER, next_retry_at TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deliveries_pending ON webhook_deliveries(status, next_retry_at);
  `));
  await migrate();
  await withInitRetry(seedPlans);
  await runMigrations(db); // versioned schema evolution (Faz 13B), advisory-locked
  return db;
}

// Legacy column adds for old sqlite DBs (pg tables already include them).
async function migrate() {
  if (d().dialect !== "sqlite") return;
  const tcols = (await d().query("PRAGMA table_info(tenants)")).rows.map((c) => c.name);
  if (!tcols.includes("stripe_customer_id")) await d().exec("ALTER TABLE tenants ADD COLUMN stripe_customer_id TEXT");
  const kcols = (await d().query("PRAGMA table_info(api_keys)")).rows.map((c) => c.name);
  if (!kcols.includes("expires_at")) await d().exec("ALTER TABLE api_keys ADD COLUMN expires_at TEXT");
  if (!kcols.includes("last_used_at")) await d().exec("ALTER TABLE api_keys ADD COLUMN last_used_at TEXT");
}

async function seedPlans() {
  const count = Number((await d().query("SELECT COUNT(*) AS n FROM plans")).rows[0].n);
  if (count > 0) return;
  // ON CONFLICT DO NOTHING: two replicas seeding at once both no-op safely.
  const ins = "INSERT INTO plans (id, name, rate_per_min, monthly_quota, allowed_tiers) VALUES (?,?,?,?,?) ON CONFLICT (id) DO NOTHING";
  await d().run(ins, ["free", "Free", 20, 1000, "safe"]);
  await d().run(ins, ["pro", "Pro", 120, 50000, "safe,host"]);
  await d().run(ins, ["enterprise", "Enterprise", 600, 0, "safe,host,privileged"]);
}

const parseTiers = (csv: string): ToolTier[] => csv.split(",").map((s) => s.trim()).filter(Boolean) as ToolTier[];

export async function getPlan(id: string): Promise<Plan | null> {
  const r = (await d().query("SELECT * FROM plans WHERE id = ?", [id])).rows[0];
  return r ? { ...r, rate_per_min: Number(r.rate_per_min), monthly_quota: Number(r.monthly_quota), allowed_tiers: parseTiers(r.allowed_tiers) } : null;
}
export async function listPlans(): Promise<Plan[]> {
  return (await d().query("SELECT * FROM plans")).rows.map((r) => ({ ...r, rate_per_min: Number(r.rate_per_min), monthly_quota: Number(r.monthly_quota), allowed_tiers: parseTiers(r.allowed_tiers) }));
}

export async function createTenant(name: string, planId = "free", stripeCustomerId: string | null = null): Promise<Tenant> {
  if (!(await getPlan(planId))) throw new Error(`Unknown plan: ${planId}`);
  const t: Tenant = { id: `tnt_${crypto.randomBytes(8).toString("hex")}`, name, plan_id: planId, stripe_customer_id: stripeCustomerId, created_at: nowIso() };
  await d().run("INSERT INTO tenants (id, name, plan_id, stripe_customer_id, created_at) VALUES (?,?,?,?,?)", [t.id, t.name, t.plan_id, t.stripe_customer_id, t.created_at]);
  return t;
}
export async function setTenantStripeCustomer(id: string, customerId: string): Promise<void> {
  await d().run("UPDATE tenants SET stripe_customer_id = ? WHERE id = ?", [customerId, id]);
}
export async function listTenants(): Promise<Tenant[]> {
  return (await d().query("SELECT * FROM tenants ORDER BY created_at DESC")).rows;
}

export async function listKeys(tenantId: string): Promise<{ id: string; label: string; revoked: number; scopes: string; expires_at: string | null; last_used_at: string | null; created_at: string }[]> {
  return (await d().query("SELECT id, label, revoked, scopes, expires_at, last_used_at, created_at FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC", [tenantId])).rows;
}

const DEFAULT_TTL_DAYS = Number(process.env.API_KEY_MAX_TTL_DAYS || 0);

export async function issueApiKey(tenantId: string, label = "", ttlDays?: number, scopes = ""): Promise<{ id: string; key: string; expiresAt: string | null }> {
  const key = `olm_${crypto.randomBytes(24).toString("hex")}`;
  const id = `key_${crypto.randomBytes(6).toString("hex")}`;
  const days = ttlDays ?? DEFAULT_TTL_DAYS;
  const expiresAt = days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null;
  await d().run("INSERT INTO api_keys (id, tenant_id, key_hash, label, scopes, expires_at, created_at) VALUES (?,?,?,?,?,?,?)", [id, tenantId, sha256(key), label, scopes, expiresAt, nowIso()]);
  await queueWebhookEvent(tenantId, "key.created", { keyId: id, label, expiresAt });
  return { id, key, expiresAt };
}
export async function revokeApiKey(keyId: string): Promise<void> {
  const row = (await d().query("SELECT tenant_id FROM api_keys WHERE id = ?", [keyId])).rows[0];
  await d().run("UPDATE api_keys SET revoked = 1 WHERE id = ?", [keyId]);
  if (row?.tenant_id) await queueWebhookEvent(row.tenant_id, "key.revoked", { keyId });
}

/** Resolve a plaintext key → tenant + plan. Null if unknown/revoked/expired. */
export async function resolveKey(plaintext: string): Promise<ResolvedKey | null> {
  const row = (await d().query("SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0", [sha256(plaintext)])).rows[0];
  if (!row) return null;
  if (row.expires_at && row.expires_at <= nowIso()) return null;
  const tenant = (await d().query("SELECT * FROM tenants WHERE id = ?", [row.tenant_id])).rows[0];
  if (!tenant) return null;
  const plan = await getPlan(tenant.plan_id);
  if (!plan) return null;
  await d().run("UPDATE api_keys SET last_used_at = ? WHERE id = ?", [nowIso(), row.id]);
  return { tenantId: tenant.id, keyId: row.id, plan, scopes: String(row.scopes || "").split(/\s+/).filter(Boolean) };
}

export async function recordUsage(e: UsageEvent): Promise<void> {
  await d().run("INSERT INTO usage_events (tenant_id, tool, tier, ok, latency_ms, tokens, cost, month, ts) VALUES (?,?,?,?,?,?,?,?,?)",
    [e.tenantId, e.tool, e.tier, e.ok ? 1 : 0, e.latencyMs, e.tokens ?? 0, e.cost ?? 0, monthKey(), nowIso()]);
}
export async function usageTimeseries(tenantId: string, month = monthKey()): Promise<{ day: string; calls: number; tokens: number }[]> {
  const rows = (await d().query("SELECT substr(ts,1,10) AS day, COUNT(*) AS calls, SUM(tokens) AS tokens FROM usage_events WHERE tenant_id = ? AND month = ? GROUP BY substr(ts,1,10) ORDER BY day", [tenantId, month])).rows;
  return rows.map((r) => ({ day: r.day, calls: Number(r.calls), tokens: Number(r.tokens || 0) }));
}
export async function monthToDateUsage(tenantId: string): Promise<number> {
  return Number((await d().query("SELECT COUNT(*) AS n FROM usage_events WHERE tenant_id = ? AND month = ?", [tenantId, monthKey()])).rows[0].n);
}
export async function getTenant(id: string): Promise<Tenant | null> {
  return (await d().query("SELECT * FROM tenants WHERE id = ?", [id])).rows[0] || null;
}
export async function getTenantByStripeCustomer(customerId: string): Promise<Tenant | null> {
  return (await d().query("SELECT * FROM tenants WHERE stripe_customer_id = ?", [customerId])).rows[0] || null;
}
export async function setTenantPlan(id: string, planId: string): Promise<void> {
  if (!(await getPlan(planId))) throw new Error(`Unknown plan: ${planId}`);
  await d().run("UPDATE tenants SET plan_id = ? WHERE id = ?", [planId, id]);
}

export interface UsageAgg { tenantId: string; calls: number; okCalls: number; tokens: number; latencyMs: number; }
export async function aggregateUsage(month = monthKey()): Promise<UsageAgg[]> {
  // Quote mixed-case aliases — Postgres folds unquoted identifiers to lowercase.
  const rows = (await d().query(`SELECT tenant_id AS "tenantId", COUNT(*) AS "calls", SUM(ok) AS "okCalls", SUM(tokens) AS "tokens", SUM(latency_ms) AS "latencyMs" FROM usage_events WHERE month = ? GROUP BY tenant_id`, [month])).rows;
  return rows.map((r) => ({ tenantId: r.tenantId, calls: Number(r.calls), okCalls: Number(r.okCalls || 0), tokens: Number(r.tokens || 0), latencyMs: Number(r.latencyMs || 0) }));
}

export interface AuditEvent { tenantId: string; tool: string; tier: ToolTier; ok: boolean; }
export async function recordAudit(e: AuditEvent): Promise<void> {
  await d().run("INSERT INTO audit_events (tenant_id, tool, tier, ok, ts) VALUES (?,?,?,?,?)", [e.tenantId, e.tool, e.tier, e.ok ? 1 : 0, nowIso()]);
}
export async function listAudit(tenantId?: string, limit = 100): Promise<any[]> {
  const lim = Math.min(Math.max(1, limit), 1000);
  return tenantId
    ? (await d().query("SELECT * FROM audit_events WHERE tenant_id = ? ORDER BY id DESC LIMIT ?", [tenantId, lim])).rows
    : (await d().query("SELECT * FROM audit_events ORDER BY id DESC LIMIT ?", [lim])).rows;
}

export async function hasInvoice(tenantId: string, period: string): Promise<boolean> {
  return !!(await d().query("SELECT 1 AS x FROM invoices WHERE tenant_id = ? AND period = ? LIMIT 1", [tenantId, period])).rows[0];
}
export async function recordInvoice(tenantId: string, period: string, amount: number): Promise<{ id: string; created: boolean }> {
  const existing = (await d().query("SELECT id FROM invoices WHERE tenant_id = ? AND period = ? LIMIT 1", [tenantId, period])).rows[0];
  if (existing) return { id: existing.id, created: false };
  const id = `inv_${crypto.randomBytes(8).toString("hex")}`;
  await d().run("INSERT INTO invoices (id, tenant_id, period, amount, status, created_at) VALUES (?,?,?,?,?,?)", [id, tenantId, period, amount, "open", nowIso()]);
  return { id, created: true };
}

// --- Billing config + Stripe webhook dedup (Faz 9C) ---
export async function getBillingConfig(key: string): Promise<string | null> {
  const r = (await d().query("SELECT v FROM billing_config WHERE k = ?", [key])).rows[0];
  return r ? r.v : null;
}
export async function setBillingConfig(key: string, value: string): Promise<void> {
  await d().run("INSERT INTO billing_config (k, v) VALUES (?,?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [key, value]);
}
export async function stripeEventSeen(eventId: string): Promise<boolean> {
  const seen = !!(await d().query("SELECT 1 AS x FROM stripe_events WHERE id = ?", [eventId])).rows[0];
  if (!seen) await d().run("INSERT INTO stripe_events (id, ts) VALUES (?,?)", [eventId, nowIso()]);
  return seen;
}

// --- Per-tenant upstream MCP servers (Faz 9E) ---
export interface UpstreamServer { id: string; tenant_id: string; name: string; transport: "stdio" | "http"; url?: string | null; command?: string | null; args?: string[]; allowed_tools?: string[]; }
export async function addUpstreamServer(tenantId: string, s: Omit<UpstreamServer, "id" | "tenant_id">): Promise<{ id: string }> {
  const id = `ups_${crypto.randomBytes(6).toString("hex")}`;
  await d().run("INSERT INTO upstream_servers (id, tenant_id, name, transport, url, command, args, allowed_tools, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [id, tenantId, s.name, s.transport, s.url ?? null, s.command ?? null, JSON.stringify(s.args ?? []), JSON.stringify(s.allowed_tools ?? []), nowIso()]);
  return { id };
}
const rowToUpstream = (r: any): UpstreamServer => ({ id: r.id, tenant_id: r.tenant_id, name: r.name, transport: r.transport, url: r.url, command: r.command, args: JSON.parse(r.args || "[]"), allowed_tools: JSON.parse(r.allowed_tools || "[]") });
export async function listUpstreamServers(tenantId: string): Promise<UpstreamServer[]> {
  return (await d().query("SELECT * FROM upstream_servers WHERE tenant_id = ? ORDER BY created_at DESC", [tenantId])).rows.map(rowToUpstream);
}
export async function allUpstreamServers(): Promise<UpstreamServer[]> {
  return (await d().query("SELECT * FROM upstream_servers")).rows.map(rowToUpstream);
}
export async function deleteUpstreamServer(tenantId: string, id: string): Promise<boolean> {
  return (await d().run("DELETE FROM upstream_servers WHERE id = ? AND tenant_id = ?", [id, tenantId])).changes > 0;
}

// --- OAuth 2.1 Dynamic Client Registration (RFC 7591, Faz 15B) ---
export interface DcrRequest {
  redirect_uris?: string[];
  grant_types?: string[];
  token_endpoint_auth_method?: string;
  client_name?: string;
  /** Owning tenant, bound at registration when the caller is tenant-authenticated
   *  (Faz 19B). authorize() requires this for auto-consent; anonymous DCR = null. */
  tenant_id?: string | null;
}
export interface DcrResult {
  client_id: string;
  client_secret?: string;
  client_secret_hash: string | null;
  redirect_uris: string[];
  grant_types: string[];
  token_endpoint_auth_method: string;
  registration_access_token: string;
}
/** Register a DCR client. Secrets are returned in plaintext ONCE and stored only
 *  as SHA-256 hashes (same one-way handling as api_keys). */
export async function registerClient(req: DcrRequest): Promise<DcrResult> {
  const clientId = `oc_${crypto.randomBytes(8).toString("hex")}`;
  const authMethod = req.token_endpoint_auth_method || "client_secret_basic";
  const redirectUris = req.redirect_uris ?? [];
  const grantTypes = req.grant_types ?? ["authorization_code", "refresh_token"];
  // Public clients (token_endpoint_auth_method=none) get no secret (RFC 7591).
  const secret = authMethod === "none" ? undefined : `ocs_${crypto.randomBytes(24).toString("hex")}`;
  const regToken = `rat_${crypto.randomBytes(24).toString("hex")}`;
  await d().run(
    "INSERT INTO oauth_clients (client_id, client_secret_hash, redirect_uris, grant_types, token_endpoint_auth_method, client_name, registration_access_token_hash, tenant_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)",
    [clientId, secret ? sha256(secret) : null, JSON.stringify(redirectUris), JSON.stringify(grantTypes), authMethod, req.client_name ?? null, sha256(regToken), req.tenant_id ?? null, nowIso()]
  );
  return {
    client_id: clientId, client_secret: secret, client_secret_hash: secret ? sha256(secret) : null,
    redirect_uris: redirectUris, grant_types: grantTypes, token_endpoint_auth_method: authMethod,
    registration_access_token: regToken,
  };
}
/** Lookup a registered client (test/introspection + OAuth provider). Never returns secrets. */
export async function getClient(clientId: string): Promise<{ client_id: string; redirect_uris: string[]; grant_types: string[]; token_endpoint_auth_method: string; tenant_id: string | null; created_at: string } | null> {
  const r = (await d().query("SELECT * FROM oauth_clients WHERE client_id = ?", [clientId])).rows[0];
  return r ? { client_id: r.client_id, redirect_uris: JSON.parse(r.redirect_uris || "[]"), grant_types: JSON.parse(r.grant_types || "[]"), token_endpoint_auth_method: r.token_endpoint_auth_method, tenant_id: r.tenant_id ?? null, created_at: r.created_at } : null;
}

// --- OAuth 2.1 Authorization Server: codes + opaque tokens (Faz 19, v1.10) ---
export interface AuthCode {
  code: string; client_id: string; tenant_id: string; code_challenge: string;
  redirect_uri: string; scopes: string; resource: string | null; expires_at: string;
}
export async function saveAuthCode(c: AuthCode): Promise<void> {
  await d().run(
    "INSERT INTO oauth_codes (code, client_id, tenant_id, code_challenge, code_challenge_method, redirect_uri, scopes, resource, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
    [c.code, c.client_id, c.tenant_id, c.code_challenge, "S256", c.redirect_uri, c.scopes, c.resource, c.expires_at, nowIso()]
  );
}
export async function getAuthCode(code: string): Promise<AuthCode | null> {
  const r = (await d().query("SELECT * FROM oauth_codes WHERE code = ?", [code])).rows[0];
  if (!r) return null;
  return { code: r.code, client_id: r.client_id, tenant_id: r.tenant_id, code_challenge: r.code_challenge, redirect_uri: r.redirect_uri, scopes: r.scopes || "", resource: r.resource ?? null, expires_at: r.expires_at };
}
/** Atomically take a code: returns it once (then deletes), null if missing/expired. */
export async function consumeAuthCode(code: string): Promise<AuthCode | null> {
  const c = await getAuthCode(code);
  await d().run("DELETE FROM oauth_codes WHERE code = ?", [code]); // one-time use
  if (!c) return null;
  if (c.expires_at <= nowIso()) return null;
  return c;
}
/** Issue an opaque access token, stored only as a SHA-256 hash. Returns plaintext once. */
export async function saveOAuthToken(t: { client_id: string; tenant_id: string; scopes: string; resource: string | null; ttlSecs: number }): Promise<string> {
  const token = `ot_${crypto.randomBytes(32).toString("hex")}`;
  const expiresAt = new Date(Date.now() + t.ttlSecs * 1000).toISOString();
  await d().run(
    "INSERT INTO oauth_tokens (token_hash, client_id, tenant_id, scopes, resource, expires_at, revoked, created_at) VALUES (?,?,?,?,?,?,0,?)",
    [sha256(token), t.client_id, t.tenant_id, t.scopes, t.resource, expiresAt, nowIso()]
  );
  return token;
}
export interface ResolvedToken { clientId: string; tenantId: string; scopes: string[]; resource: string | null; expiresAt: number; }
export async function resolveOAuthToken(plaintext: string): Promise<ResolvedToken | null> {
  const r = (await d().query("SELECT * FROM oauth_tokens WHERE token_hash = ? AND revoked = 0", [sha256(plaintext)])).rows[0];
  if (!r) return null;
  if (r.expires_at <= nowIso()) return null;
  return {
    clientId: r.client_id, tenantId: r.tenant_id, resource: r.resource ?? null,
    scopes: String(r.scopes || "").split(/\s+/).filter(Boolean),
    expiresAt: Math.floor(new Date(r.expires_at).getTime() / 1000),
  };
}
export async function revokeOAuthToken(plaintext: string): Promise<void> {
  await d().run("UPDATE oauth_tokens SET revoked = 1 WHERE token_hash = ?", [sha256(plaintext)]);
}

// --- OAuth refresh tokens with RFC 9700 rotation (Faz 22, v1.13) ---
/** Issue an opaque refresh token in a family (new family if none given). Returns
 *  the plaintext once; stored only as a SHA-256 hash. */
export async function saveRefreshToken(t: { family_id?: string; client_id: string; tenant_id: string; scopes: string; resource: string | null; ttlSecs: number }): Promise<{ token: string; family_id: string }> {
  const token = `rt_${crypto.randomBytes(32).toString("hex")}`;
  const family_id = t.family_id || crypto.randomUUID();
  const expiresAt = new Date(Date.now() + t.ttlSecs * 1000).toISOString();
  await d().run(
    "INSERT INTO oauth_refresh_tokens (refresh_token_hash, family_id, client_id, tenant_id, scopes, resource, expires_at, used, created_at) VALUES (?,?,?,?,?,?,?,0,?)",
    [sha256(token), family_id, t.client_id, t.tenant_id, t.scopes, t.resource, expiresAt, nowIso()]
  );
  return { token, family_id };
}

export type RefreshRotation =
  | { status: "ok"; family_id: string; client_id: string; tenant_id: string; scopes: string; resource: string | null }
  | { status: "reuse" }
  | { status: "invalid" };

/** RFC 9700 rotation. used=0 → consume (mark used) and return the grant. used=1 →
 *  REUSE (replay of an already-rotated token): revoke the WHOLE family and signal
 *  compromise. Missing/expired → invalid. */
export async function rotateRefreshToken(plaintext: string): Promise<RefreshRotation> {
  const hash = sha256(plaintext);
  const r = (await d().query("SELECT * FROM oauth_refresh_tokens WHERE refresh_token_hash = ?", [hash])).rows[0];
  if (!r) return { status: "invalid" };
  if (Number(r.used) === 1) {
    await revokeRefreshFamily(r.family_id); // family compromised → kill the chain
    return { status: "reuse" };
  }
  // Mark consumed regardless of expiry (a token is single-use either way).
  await d().run("UPDATE oauth_refresh_tokens SET used = 1 WHERE refresh_token_hash = ?", [hash]);
  if (r.expires_at <= nowIso()) return { status: "invalid" };
  return { status: "ok", family_id: r.family_id, client_id: r.client_id, tenant_id: r.tenant_id, scopes: r.scopes || "", resource: r.resource ?? null };
}

/** Revoke every refresh token in a family (reuse detection / explicit revoke). */
export async function revokeRefreshFamily(family_id: string): Promise<void> {
  await d().run("UPDATE oauth_refresh_tokens SET used = 1 WHERE family_id = ?", [family_id]);
}

/** The family a refresh token belongs to (lets revokeToken kill the whole chain). */
export async function refreshFamilyOf(plaintext: string): Promise<string | null> {
  const r = (await d().query("SELECT family_id FROM oauth_refresh_tokens WHERE refresh_token_hash = ?", [sha256(plaintext)])).rows[0];
  return r ? r.family_id : null;
}

/** Timing-safe verify of a confidential client's secret against its stored SHA-256
 *  hash. Public clients (no stored hash) and unknown clients → false. */
export async function verifyClientSecret(clientId: string, secret: string): Promise<boolean> {
  const r = (await d().query("SELECT client_secret_hash FROM oauth_clients WHERE client_id = ?", [clientId])).rows[0];
  if (!r || !r.client_secret_hash) return false;
  const a = Buffer.from(sha256(secret), "hex");
  const b = Buffer.from(String(r.client_secret_hash), "hex");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// --- Tenant webhooks (Faz 11B) ---
export interface Webhook { id: string; tenant_id: string; url: string; events: string[]; active: number; created_at: string; }
export async function addWebhook(tenantId: string, url: string, events: string[]): Promise<{ id: string; secret: string }> {
  const id = `whk_${crypto.randomBytes(8).toString("hex")}`;
  const secret = `whsec_${crypto.randomBytes(24).toString("hex")}`;
  await d().run("INSERT INTO webhooks (id, tenant_id, url, events, secret, created_at) VALUES (?,?,?,?,?,?)", [id, tenantId, url, events.join(","), secret, nowIso()]);
  return { id, secret };
}
export async function listWebhooks(tenantId: string): Promise<Webhook[]> {
  return (await d().query("SELECT id, tenant_id, url, events, active, created_at FROM webhooks WHERE tenant_id = ? ORDER BY created_at DESC", [tenantId])).rows
    .map((r) => ({ ...r, events: String(r.events).split(",").filter(Boolean) }));
}
export async function deleteWebhook(tenantId: string, id: string): Promise<boolean> {
  return (await d().run("DELETE FROM webhooks WHERE id = ? AND tenant_id = ?", [id, tenantId])).changes > 0;
}
export async function getWebhookSecret(id: string): Promise<string | null> {
  const r = (await d().query("SELECT secret FROM webhooks WHERE id = ?", [id])).rows[0];
  return r ? r.secret : null;
}
export async function getWebhookUrl(id: string): Promise<string | null> {
  const r = (await d().query("SELECT url FROM webhooks WHERE id = ?", [id])).rows[0];
  return r ? r.url : null;
}

export interface Delivery { id: string; webhook_id: string; tenant_id: string; event_type: string; payload: string; attempt: number; status: string; next_retry_at: string; }
export async function queueWebhookEvent(tenantId: string, eventType: string, payload: Record<string, any>): Promise<number> {
  const hooks = (await d().query("SELECT id, url, events FROM webhooks WHERE tenant_id = ? AND active = 1", [tenantId])).rows;
  const body = JSON.stringify({ type: eventType, tenantId, ts: nowIso(), data: payload });
  let n = 0;
  for (const h of hooks) {
    if (!String(h.events).split(",").includes(eventType)) continue;
    const id = `whd_${crypto.randomBytes(8).toString("hex")}`;
    await d().run("INSERT INTO webhook_deliveries (id, webhook_id, tenant_id, event_type, payload, next_retry_at, created_at) VALUES (?,?,?,?,?,?,?)", [id, h.id, tenantId, eventType, body, nowIso(), nowIso()]);
    n++;
  }
  return n;
}
/**
 * Atomically claim due deliveries (pending → claimed) so two replicas never
 * double-send (Faz 12C). Postgres uses FOR UPDATE SKIP LOCKED; sqlite relies on
 * its single-writer model via a two-step claim then read.
 */
export async function claimDeliveries(limit = 50): Promise<Delivery[]> {
  const now = nowIso();
  if (d().dialect === "pg") {
    const sql = `UPDATE webhook_deliveries SET status='claimed'
      WHERE id IN (SELECT id FROM webhook_deliveries WHERE status='pending' AND next_retry_at <= ?
                   ORDER BY next_retry_at FOR UPDATE SKIP LOCKED LIMIT ?)
      RETURNING *`;
    return (await d().query(sql, [now, limit])).rows;
  }
  // sqlite: single-writer model. Tag with a UNIQUE claim token so two parallel
  // workers select disjoint sets (a shared 'claimed' status would double-claim).
  const tok = `claimed_${crypto.randomBytes(6).toString("hex")}`;
  await d().run("UPDATE webhook_deliveries SET status=? WHERE id IN (SELECT id FROM webhook_deliveries WHERE status='pending' AND next_retry_at <= ? ORDER BY next_retry_at LIMIT ?)", [tok, now, limit]);
  return (await d().query("SELECT * FROM webhook_deliveries WHERE status=? ORDER BY next_retry_at", [tok])).rows;
}
export async function markDelivery(id: string, status: string, attempt: number, nextRetryAt: string | null, code?: number): Promise<void> {
  await d().run("UPDATE webhook_deliveries SET status = ?, attempt = ?, next_retry_at = ?, last_code = ? WHERE id = ?", [status, attempt, nextRetryAt ?? nowIso(), code ?? null, id]);
}
export async function listDeliveries(tenantId: string, limit = 50): Promise<any[]> {
  return (await d().query("SELECT id, webhook_id, event_type, attempt, status, last_code, created_at FROM webhook_deliveries WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?", [tenantId, Math.min(limit, 200)])).rows;
}

export { monthKey };
