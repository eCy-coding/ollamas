import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Isolated temp DB per run. Env must be set BEFORE the store module loads, so
// the store + middleware + billing are imported dynamically inside beforeAll.
const DB = path.join(os.tmpdir(), `ollamas-test-${process.pid}.db`);
let store: typeof import("../server/store/index");
let auth: typeof import("../server/middleware/auth");
let rl: typeof import("../server/middleware/rate-limit");
let billing: typeof import("../server/billing/stripe");

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  delete process.env.STRIPE_API_KEY; // force dry-run billing
  store = await import("../server/store/index");
  auth = await import("../server/middleware/auth");
  rl = await import("../server/middleware/rate-limit");
  billing = await import("../server/billing/stripe");
  store.initStore();
});
afterAll(() => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

// Fake Express req/res/next for middleware unit tests.
function mkRes() {
  const r: any = { statusCode: 200, body: undefined, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}

describe("store: tenants, keys, plans", () => {
  test("seeds three plans with escalating tiers", () => {
    const plans = store.listPlans();
    expect(plans.map((p) => p.id).sort()).toEqual(["enterprise", "free", "pro"]);
    expect(store.getPlan("free")!.allowed_tiers).toEqual(["safe"]);
    expect(store.getPlan("enterprise")!.allowed_tiers).toEqual(["safe", "host", "privileged"]);
  });

  test("createTenant + issueApiKey + resolveKey round-trip", () => {
    const t = store.createTenant("acme", "pro", "cus_123");
    expect(t.stripe_customer_id).toBe("cus_123");
    const { key } = store.issueApiKey(t.id, "ci");
    const resolved = store.resolveKey(key);
    expect(resolved?.tenantId).toBe(t.id);
    expect(resolved?.plan.id).toBe("pro");
    expect(store.getTenantByStripeCustomer("cus_123")?.id).toBe(t.id);
  });

  test("resolveKey rejects unknown + revoked keys", () => {
    const t = store.createTenant("revoco", "free");
    const { id, key } = store.issueApiKey(t.id);
    expect(store.resolveKey("olm_bogus")).toBeNull();
    store.revokeApiKey(id);
    expect(store.resolveKey(key)).toBeNull();
  });

  test("listKeys returns metadata only (no hash/plaintext)", () => {
    const t = store.createTenant("meta", "free");
    store.issueApiKey(t.id, "k1");
    const keys = store.listKeys(t.id);
    expect(keys).toHaveLength(1);
    expect(Object.keys(keys[0]).sort()).toEqual(["created_at", "expires_at", "id", "label", "last_used_at", "revoked", "scopes"]);
  });

  test("API-key lifecycle: scopes returned, expiry enforced (Faz 9B)", async () => {
    const t = store.createTenant("life", "pro");
    const scoped = store.issueApiKey(t.id, "scoped", 0, "tools:host tools:privileged");
    expect(scoped.expiresAt).toBeNull();
    expect(store.resolveKey(scoped.key)!.scopes).toEqual(["tools:host", "tools:privileged"]);
    // ~0.86s TTL → expired after a 1s wait.
    const shortLived = store.issueApiKey(t.id, "tmp", 0.00001);
    expect(typeof shortLived.expiresAt).toBe("string");
    await new Promise((r) => setTimeout(r, 1000));
    expect(store.resolveKey(shortLived.key)).toBeNull();
  });
});

describe("store: usage + billing idempotency", () => {
  test("recordUsage + monthToDateUsage + aggregateUsage", () => {
    const t = store.createTenant("usage", "pro");
    for (let i = 0; i < 4; i++) store.recordUsage({ tenantId: t.id, tool: "read_file", tier: "safe", ok: true, latencyMs: 5 });
    expect(store.monthToDateUsage(t.id)).toBe(4);
    const agg = store.aggregateUsage().find((a) => a.tenantId === t.id);
    expect(agg?.calls).toBe(4);
  });

  test("recordInvoice is idempotent per (tenant, period)", () => {
    const t = store.createTenant("inv", "pro");
    const first = store.recordInvoice(t.id, "2026-06", 10);
    const second = store.recordInvoice(t.id, "2026-06", 10);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(store.hasInvoice(t.id, "2026-06")).toBe(true);
  });

  test("computeRun dry-runs without a Stripe key", () => {
    const run = billing.computeRun();
    expect(run.dryRun).toBe(true);
    expect(run.total).toBeGreaterThanOrEqual(0);
  });

  test("Stripe helpers degrade gracefully without a key (Faz 9C)", async () => {
    expect(billing.isLive()).toBe(false);
    expect(await billing.ensureBillingConfig()).toBeNull();
    const t = store.createTenant("nostripe", "pro");
    expect(await billing.ensureCustomer(t.id)).toBeNull();
    expect(await billing.createPortalSession(t.id)).toBeNull();
    expect(await billing.createCheckoutSession(t.id)).toBeNull();
  });

  test("billing_config roundtrip + stripe event dedup (Faz 9C)", () => {
    store.setBillingConfig("meter_id", "mtr_123");
    expect(store.getBillingConfig("meter_id")).toBe("mtr_123");
    expect(store.stripeEventSeen("evt_1")).toBe(false); // first time
    expect(store.stripeEventSeen("evt_1")).toBe(true);  // duplicate
  });

  test("token dimension (tool=__llm__) aggregates tokens (Faz 6D)", () => {
    const t = store.createTenant("tok", "pro");
    store.recordUsage({ tenantId: t.id, tool: "__llm__", tier: "safe", ok: true, latencyMs: 100, tokens: 250 });
    store.recordUsage({ tenantId: t.id, tool: "__llm__", tier: "safe", ok: true, latencyMs: 90, tokens: 150 });
    const agg = store.aggregateUsage().find((a) => a.tenantId === t.id);
    expect(agg?.tokens).toBe(400);
  });
});

describe("audit log (Faz 6C)", () => {
  test("recordAudit + listAudit (newest-first, tenant-scoped)", () => {
    const t = store.createTenant("audco", "enterprise");
    store.recordAudit({ tenantId: t.id, tool: "macos_terminal", tier: "privileged", ok: true });
    store.recordAudit({ tenantId: t.id, tool: "git_commit", tier: "host", ok: false });
    const rows = store.listAudit(t.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].tool).toBe("git_commit"); // newest first
    expect(rows[0].ok).toBe(0);
    expect(rows[1].tier).toBe("privileged");
  });
});

describe("auth middleware", () => {
  test("Bearer token resolves to req.tenant", () => {
    const t = store.createTenant("authco", "pro");
    const { key } = store.issueApiKey(t.id);
    const req: any = { headers: { authorization: `Bearer ${key}` } };
    const res = mkRes(); const next = vi.fn();
    auth.authMiddleware(true)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.tenant?.tenantId).toBe(t.id);
  });

  test("missing key with required=true → 401", () => {
    const req: any = { headers: {} };
    const res = mkRes(); const next = vi.fn();
    auth.authMiddleware(true)(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("invalid key → 401 even when not required", () => {
    const req: any = { headers: { "x-api-key": "olm_nope" } };
    const res = mkRes(); const next = vi.fn();
    auth.authMiddleware(false)(req, res, next);
    expect(res.statusCode).toBe(401);
  });
});

describe("rate-limit middleware (in-memory fallback, no REDIS_URL)", () => {
  test("token bucket exhausts → 429", async () => {
    const tenant = { tenantId: "rl1", keyId: "k", plan: { id: "tiny", name: "t", rate_per_min: 2, monthly_quota: 0, allowed_tiers: ["safe"] as any } };
    const mw = rl.rateLimitMiddleware();
    let pass = 0, blocked = 0;
    for (let i = 0; i < 5; i++) {
      const res = mkRes(); const next = vi.fn();
      await mw({ tenant } as any, res, next);
      if (next.mock.calls.length) pass++; else if (res.statusCode === 429) blocked++;
    }
    expect(pass).toBe(2);
    expect(blocked).toBe(3);
  });

  test("monthly quota exceeded → 429", async () => {
    const t = store.createTenant("quota", "free");
    const tenant = { tenantId: t.id, keyId: "k", plan: { id: "q", name: "q", rate_per_min: 1000, monthly_quota: 1, allowed_tiers: ["safe"] as any } };
    store.recordUsage({ tenantId: t.id, tool: "x", tier: "safe", ok: true, latencyMs: 1 });
    const res = mkRes(); const next = vi.fn();
    await rl.rateLimitMiddleware()({ tenant } as any, res, next);
    expect(res.statusCode).toBe(429);
  });

  test("unauthenticated request passes through unmetered", async () => {
    const res = mkRes(); const next = vi.fn();
    await rl.rateLimitMiddleware()({} as any, res, next);
    expect(next).toHaveBeenCalled();
  });
});
