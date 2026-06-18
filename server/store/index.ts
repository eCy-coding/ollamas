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
  created_at: string;
}
export interface ResolvedKey {
  tenantId: string;
  keyId: string;
  plan: Plan;
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
  `);
  seedPlans();
  return db;
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

export function createTenant(name: string, planId = "free"): Tenant {
  if (!getPlan(planId)) throw new Error(`Unknown plan: ${planId}`);
  const t: Tenant = { id: `tnt_${crypto.randomBytes(8).toString("hex")}`, name, plan_id: planId, created_at: nowIso() };
  d().prepare("INSERT INTO tenants (id, name, plan_id, created_at) VALUES (?,?,?,?)").run(t.id, t.name, t.plan_id, t.created_at);
  return t;
}

/** Mint an API key. Returns the plaintext ONCE — only its hash is stored. */
export function issueApiKey(tenantId: string, label = ""): { id: string; key: string } {
  const key = `olm_${crypto.randomBytes(24).toString("hex")}`;
  const id = `key_${crypto.randomBytes(6).toString("hex")}`;
  d().prepare("INSERT INTO api_keys (id, tenant_id, key_hash, label, created_at) VALUES (?,?,?,?,?)")
    .run(id, tenantId, sha256(key), label, nowIso());
  return { id, key };
}

export function revokeApiKey(keyId: string): void {
  d().prepare("UPDATE api_keys SET revoked = 1 WHERE id = ?").run(keyId);
}

/** Resolve a plaintext key → tenant + plan. Null if unknown/revoked. */
export function resolveKey(plaintext: string): ResolvedKey | null {
  const row = d().prepare("SELECT * FROM api_keys WHERE key_hash = ? AND revoked = 0").get(sha256(plaintext)) as any;
  if (!row) return null;
  const tenant = d().prepare("SELECT * FROM tenants WHERE id = ?").get(row.tenant_id) as any;
  if (!tenant) return null;
  const plan = getPlan(tenant.plan_id);
  if (!plan) return null;
  return { tenantId: tenant.id, keyId: row.id, plan };
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

export function recordInvoice(tenantId: string, period: string, amount: number): { id: string } {
  const id = `inv_${crypto.randomBytes(8).toString("hex")}`;
  d().prepare("INSERT INTO invoices (id, tenant_id, period, amount, status, created_at) VALUES (?,?,?,?,?,?)")
    .run(id, tenantId, period, amount, "open", nowIso());
  return { id };
}

export { monthKey };
