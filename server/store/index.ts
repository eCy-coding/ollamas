// Multi-tenant SaaS store (AGENTS.md Faz 2). Uses Node 24's built-in node:sqlite
// (zero external dep, no native rebuild in Docker — aligns with the project's
// zero-dependency principle). Holds tenants, API keys (hashed), plans, usage
// events, and invoices for the MCP gateway's tenancy + metering + billing layers.

import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import type { ToolTier } from "../tool-registry";

const DATA_DIR = process.env.MISSION_CONTROL_DATA_DIR || path.join(os.homedir(), ".llm-mission-control");
const DB_PATH = process.env.SAAS_DB_PATH || path.join(DATA_DIR, "saas.db");

export interface Plan {
  id: string;
  name: string;
  rate_per_min: number;
  monthly_quota: number; // 0 = unlimited
  allowed_tiers: ToolTier[];
}
export interface Tenant {
  id: string;
  name: string;
  plan_id: string;
  stripe_customer_id?: string | null;
  created_at: string;
}
export interface ResolvedKey {
  tenantId: string;
  keyId: string;
  plan: Plan;
  scopes: string[];
}
export interface UsageEvent {
  tenantId: string;
  tool: string;
  tier: ToolTier;
  ok: boolean;
  latencyMs: number;
  tokens?: number;
  cost?: number;
}

let db: DatabaseSync | null = null;

const sha256 = (s: string) => crypto.createHash("sha256").update(s).digest("hex");
const nowIso = () => new Date().toISOString();
// Billing period key. UTC by contract — quotas reset at 00:00 UTC on the 1st,
// the same instant for every tenant regardless of local timezone. Consistent and
// audit-friendly; document this for tenants in other zones.
const monthKey = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

/** Idempotent: create the DB + tables and seed default plans. Call once at boot. */
export function initStore(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  db.exec(`
    CREATE TABLE IF NOT EXISTS plans (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      rate_per_min INTEGER NOT NULL DEFAULT 60,
      monthly_quota INTEGER NOT NULL DEFAULT 0,
      allowed_tiers TEXT NOT NULL DEFAULT 'safe'
    );
    CREATE TABLE IF NOT EXISTS tenants (
      id TEXT PRIMARY KEY, name TEXT NOT NULL,
      plan_id TEXT NOT NULL REFERENCES plans(id),
      stripe_customer_id TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL REFERENCES tenants(id),
      key_hash TEXT NOT NULL UNIQUE,
      label TEXT, scopes TEXT NOT NULL DEFAULT '',
      revoked INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_tenant ON api_keys(tenant_id);
    CREATE TABLE IF NOT EXISTS usage_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL, tool TEXT NOT NULL, tier TEXT NOT NULL,
      ok INTEGER NOT NULL, latency_ms INTEGER NOT NULL,
      tokens INTEGER NOT NULL DEFAULT 0, cost REAL NOT NULL DEFAULT 0,
      month TEXT NOT NULL, ts TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_tenant_month ON usage_events(tenant_id, month);
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL REFERENCES tenants(id),
      period TEXT NOT NULL, amount REAL NOT NULL,
      status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_invoices_tenant_period ON invoices(tenant_id, period);
    CREATE TABLE IF NOT EXISTS audit_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tenant_id TEXT NOT NULL, tool TEXT NOT NULL, tier TEXT NOT NULL,
      ok INTEGER NOT NULL, ts TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_events(tenant_id, ts);
  `);
  migrate();
  seedPlans();
  return db;
}

// Idempotent column adds for DBs created before a column existed (node:sqlite
// has no IF NOT EXISTS on ADD COLUMN, so probe table_info first).
function migrate() {
  const tcols = (d().prepare("PRAGMA table_info(tenants)").all() as any[]).map((c) => c.name);
  if (!tcols.includes("stripe_customer_id")) {
    d().exec("ALTER TABLE tenants ADD COLUMN stripe_customer_id TEXT");
  }
  // API-key lifecycle (Faz 9B): expiry + last-used tracking.
  const kcols = (d().prepare("PRAGMA table_info(api_keys)").all() as any[]).map((c) => c.name);
  if (!kcols.includes("expires_at")) d().exec("ALTER TABLE api_keys ADD COLUMN expires_at TEXT");
  if (!kcols.includes("last_used_at")) d().exec("ALTER TABLE api_keys ADD COLUMN last_used_at TEXT");
}

function d(): DatabaseSync {
  if (!db) throw new Error("Store not initialized — call initStore() first.");
  return db;
}

function seedPlans() {
  const count = (d().prepare("SELECT COUNT(*) AS n FROM plans").get() as any).n;
  if (count > 0) return;
  const ins = d().prepare("INSERT INTO plans (id, name, rate_per_min, monthly_quota, allowed_tiers) VALUES (?,?,?,?,?)");
  // tiers escalate with plan; 0 quota = unlimited.
  ins.run("free", "Free", 20, 1000, "safe");
  ins.run("pro", "Pro", 120, 50000, "safe,host");
  ins.run("enterprise", "Enterprise", 600, 0, "safe,host,privileged");
}

const parseTiers = (csv: string): ToolTier[] => csv.split(",").map((s) => s.trim()).filter(Boolean) as ToolTier[];

export function getPlan(id: string): Plan | null {
  const r = d().prepare("SELECT * FROM plans WHERE id = ?").get(id) as any;
  return r ? { ...r, allowed_tiers: parseTiers(r.allowed_tiers) } : null;
}

export function listPlans(): Plan[] {
  return (d().prepare("SELECT * FROM plans").all() as any[]).map((r) => ({ ...r, allowed_tiers: parseTiers(r.allowed_tiers) }));
}

export function createTenant(name: string, planId = "free", stripeCustomerId: string | null = null): Tenant {
  if (!getPlan(planId)) throw new Error(`Unknown plan: ${planId}`);
  const t: Tenant = { id: `tnt_${crypto.randomBytes(8).toString("hex")}`, name, plan_id: planId, stripe_customer_id: stripeCustomerId, created_at: nowIso() };
  d().prepare("INSERT INTO tenants (id, name, plan_id, stripe_customer_id, created_at) VALUES (?,?,?,?,?)")
    .run(t.id, t.name, t.plan_id, t.stripe_customer_id, t.created_at);
  return t;
}

export function setTenantStripeCustomer(id: string, customerId: string): void {
  d().prepare("UPDATE tenants SET stripe_customer_id = ? WHERE id = ?").run(customerId, id);
}

export function listTenants(): Tenant[] {
  return d().prepare("SELECT * FROM tenants ORDER BY created_at DESC").all() as any[];
}

/** API-key metadata for a tenant (never the hash/plaintext). */
export function listKeys(tenantId: string): { id: string; label: string; revoked: number; scopes: string; expires_at: string | null; last_used_at: string | null; created_at: string }[] {
  return d().prepare("SELECT id, label, revoked, scopes, expires_at, last_used_at, created_at FROM api_keys WHERE tenant_id = ? ORDER BY created_at DESC").all(tenantId) as any[];
}

const DEFAULT_TTL_DAYS = Number(process.env.API_KEY_MAX_TTL_DAYS || 0); // 0 = never

/**
 * Mint an API key. Returns the plaintext ONCE — only its hash is stored.
 * @param ttlDays expiry in days (0/undefined = never; falls back to API_KEY_MAX_TTL_DAYS)
 * @param scopes space-separated scope grants (Faz 9B)
 */
export function issueApiKey(tenantId: string, label = "", ttlDays?: number, scopes = ""): { id: string; key: string; expiresAt: string | null } {
  const key = `olm_${crypto.randomBytes(24).toString("hex")}`;
  const id = `key_${crypto.randomBytes(6).toString("hex")}`;
  const days = ttlDays ?? DEFAULT_TTL_DAYS;
  const expiresAt = days > 0 ? new Date(Date.now() + days * 86400_000).toISOString() : null;
  d().prepare("INSERT INTO api_keys (id, tenant_id, key_hash, label, scopes, expires_at, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, tenantId, sha256(key), label, scopes, expiresAt, nowIso());
  return { id, key, expiresAt };
}

export function revokeApiKey(keyId: string): void {
  d().prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?").run(keyId);
}

/**
 * Resolve a plaintext key → tenant + plan. Null if unknown/revoked.
 * Lookup is by SHA-256 hash over a UNIQUE-indexed column: the secret is never
 * byte-compared in JS, so there is no string-compare timing side-channel to
 * leak — the index probe is on the 256-bit digest, not the plaintext.
 */
export function resolveKey(plaintext: string): ResolvedKey | null {
  const row = d().prepare("SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0").get(sha256(plaintext)) as any;
  if (!row) return null;
  // Expiry (Faz 9B): reject keys past expires_at.
  if (row.expires_at && row.expires_at <= nowIso()) return null;
  const tenant = d().prepare("SELECT * FROM tenants WHERE id = ?").get(row.tenant_id) as any;
  if (!tenant) return null;
  const plan = getPlan(tenant.plan_id);
  if (!plan) return null;
  d().prepare("UPDATE api_keys SET last_used_at = ? WHERE id = ?").run(nowIso(), row.id);
  const scopes = String(row.scopes || "").split(/\s+/).filter(Boolean);
  return { tenantId: tenant.id, keyId: row.id, plan, scopes };
}

export function recordUsage(e: UsageEvent): void {
  d().prepare("INSERT INTO usage_events (tenant_id, tool, tier, ok, latency_ms, tokens, cost, month, ts) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(e.tenantId, e.tool, e.tier, e.ok ? 1 : 0, e.latencyMs, e.tokens ?? 0, e.cost ?? 0, monthKey(), nowIso());
}

/** Count of usage events for a tenant in the current UTC month (quota check). */
export function monthToDateUsage(tenantId: string): number {
  return (d().prepare("SELECT COUNT(*) AS n FROM usage_events WHERE tenant_id = ? AND month = ?").get(tenantId, monthKey()) as any).n;
}

export function getTenant(id: string): Tenant | null {
  return (d().prepare("SELECT * FROM tenants WHERE id = ?").get(id) as any) || null;
}

export function getTenantByStripeCustomer(customerId: string): Tenant | null {
  return (d().prepare("SELECT * FROM tenants WHERE stripe_customer_id = ?").get(customerId) as any) || null;
}

export function setTenantPlan(id: string, planId: string): void {
  if (!getPlan(planId)) throw new Error(`Unknown plan: ${planId}`);
  d().prepare("UPDATE tenants SET plan_id = ? WHERE id = ?").run(planId, id);
}

export interface UsageAgg {
  tenantId: string;
  calls: number;
  okCalls: number;
  tokens: number;
  latencyMs: number;
}

/** Per-tenant usage rollup for a billing period (default = current month). */
export function aggregateUsage(month = monthKey()): UsageAgg[] {
  const rows = d().prepare(
    `SELECT tenant_id AS tenantId, COUNT(*) AS calls,
            SUM(ok) AS okCalls, SUM(tokens) AS tokens, SUM(latency_ms) AS latencyMs
     FROM usage_events WHERE month = ? GROUP BY tenant_id`
  ).all(month) as any[];
  return rows.map((r) => ({ tenantId: r.tenantId, calls: r.calls, okCalls: r.okCalls || 0, tokens: r.tokens || 0, latencyMs: r.latencyMs || 0 }));
}

export interface AuditEvent { tenantId: string; tool: string; tier: ToolTier; ok: boolean; }

/** Security audit: record a host/privileged/upstream tool invocation (AGENTS.md 6C). */
export function recordAudit(e: AuditEvent): void {
  d().prepare("INSERT INTO audit_events (tenant_id, tool, tier, ok, ts) VALUES (?,?,?,?,?)")
    .run(e.tenantId, e.tool, e.tier, e.ok ? 1 : 0, nowIso());
}

/** Recent audit events, newest first; optionally scoped to a tenant. */
export function listAudit(tenantId?: string, limit = 100): any[] {
  const lim = Math.min(Math.max(1, limit), 1000);
  return tenantId
    ? d().prepare("SELECT * FROM audit_events WHERE tenant_id = ? ORDER BY id DESC LIMIT ?").all(tenantId, lim) as any[]
    : d().prepare("SELECT * FROM audit_events ORDER BY id DESC LIMIT ?").all(lim) as any[];
}

/** True if an invoice already exists for (tenant, period) — billing idempotency. */
export function hasInvoice(tenantId: string, period: string): boolean {
  return !!d().prepare("SELECT 1 FROM invoices WHERE tenant_id = ? AND period = ? LIMIT 1").get(tenantId, period);
}

/** Idempotent: returns the existing invoice id for (tenant, period) or creates one. */
export function recordInvoice(tenantId: string, period: string, amount: number): { id: string; created: boolean } {
  const existing = d().prepare("SELECT id FROM invoices WHERE tenant_id = ? AND period = ? LIMIT 1").get(tenantId, period) as any;
  if (existing) return { id: existing.id, created: false };
  const id = `inv_${crypto.randomBytes(8).toString("hex")}`;
  d().prepare("INSERT INTO invoices (id, tenant_id, period, amount, status, created_at) VALUES (?,?,?,?,?,?)")
    .run(id, tenantId, period, amount, "open", nowIso());
  return { id, created: true };
}

export { monthKey };
