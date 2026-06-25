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
  await store.initStore();
});
afterAll(() => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

function mkRes() {
  const r: any = { statusCode: 200, body: undefined, headers: {} };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; };
  return r;
}

describe("store: tenants, keys, plans", () => {
  test("seeds three plans with escalating tiers", async () => {
    const plans = await store.listPlans();
    expect(plans.map((p) => p.id).sort()).toEqual(["enterprise", "free", "pro"]);
    expect((await store.getPlan("free"))!.allowed_tiers).toEqual(["safe"]);
    expect((await store.getPlan("enterprise"))!.allowed_tiers).toEqual(["safe", "host", "privileged"]);
  });

  test("createTenant + issueApiKey + resolveKey round-trip", async () => {
    const t = await store.createTenant("acme", "pro", "cus_123");
    expect(t.stripe_customer_id).toBe("cus_123");
    const { key } = await store.issueApiKey(t.id, "ci");
    const resolved = await store.resolveKey(key);
    expect(resolved?.tenantId).toBe(t.id);
    expect(resolved?.plan.id).toBe("pro");
    expect((await store.getTenantByStripeCustomer("cus_123"))?.id).toBe(t.id);
  });

  test("resolveKey rejects unknown + revoked keys", async () => {
    const t = await store.createTenant("revoco", "free");
    const { id, key } = await store.issueApiKey(t.id);
    expect(await store.resolveKey("olm_bogus")).toBeNull();
    await store.revokeApiKey(id);
    expect(await store.resolveKey(key)).toBeNull();
  });

  test("listKeys returns metadata only (no hash/plaintext)", async () => {
    const t = await store.createTenant("meta", "free");
    await store.issueApiKey(t.id, "k1");
    const keys = await store.listKeys(t.id);
    expect(keys).toHaveLength(1);
    expect(Object.keys(keys[0]).sort()).toEqual(["created_at", "expires_at", "id", "label", "last_used_at", "revoked", "scopes"]);
  });

  test("API-key lifecycle: scopes returned, expiry enforced (Faz 9B)", async () => {
    const t = await store.createTenant("life", "pro");
    const scoped = await store.issueApiKey(t.id, "scoped", 0, "tools:host tools:privileged");
    expect(scoped.expiresAt).toBeNull();
    expect((await store.resolveKey(scoped.key))!.scopes).toEqual(["tools:host", "tools:privileged"]);
    const shortLived = await store.issueApiKey(t.id, "tmp", 0.00001);
    expect(typeof shortLived.expiresAt).toBe("string");
    await new Promise((r) => setTimeout(r, 1000));
    expect(await store.resolveKey(shortLived.key)).toBeNull();
  });
});

describe("store: usage + billing idempotency", () => {
  test("recordUsage + monthToDateUsage + aggregateUsage", async () => {
    const t = await store.createTenant("usage", "pro");
    for (let i = 0; i < 4; i++) await store.recordUsage({ tenantId: t.id, tool: "read_file", tier: "safe", ok: true, latencyMs: 5 });
    expect(await store.monthToDateUsage(t.id)).toBe(4);
    const agg = (await store.aggregateUsage()).find((a) => a.tenantId === t.id);
    expect(agg?.calls).toBe(4);
  });

  test("usageTimeseries returns daily calls+tokens (Faz 10B)", async () => {
    const t = await store.createTenant("ts", "pro");
    await store.recordUsage({ tenantId: t.id, tool: "read_file", tier: "safe", ok: true, latencyMs: 3, tokens: 10 });
    await store.recordUsage({ tenantId: t.id, tool: "read_file", tier: "safe", ok: true, latencyMs: 3, tokens: 5 });
    const series = await store.usageTimeseries(t.id);
    expect(series.length).toBeGreaterThanOrEqual(1);
    expect(series[0]).toHaveProperty("day");
    expect(series.reduce((s, r) => s + r.calls, 0)).toBe(2);
    expect(series.reduce((s, r) => s + r.tokens, 0)).toBe(15);
  });

  test("recordInvoice is idempotent per (tenant, period)", async () => {
    const t = await store.createTenant("inv", "pro");
    const first = await store.recordInvoice(t.id, "2026-06", 10);
    const second = await store.recordInvoice(t.id, "2026-06", 10);
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.id).toBe(first.id);
    expect(await store.hasInvoice(t.id, "2026-06")).toBe(true);
  });

  test("computeRun dry-runs without a Stripe key", async () => {
    const run = await billing.computeRun();
    expect(run.dryRun).toBe(true);
    expect(run.total).toBeGreaterThanOrEqual(0);
  });

  test("token dimension (tool=__llm__) aggregates tokens (Faz 6D)", async () => {
    const t = await store.createTenant("tok", "pro");
    await store.recordUsage({ tenantId: t.id, tool: "__llm__", tier: "safe", ok: true, latencyMs: 100, tokens: 250 });
    await store.recordUsage({ tenantId: t.id, tool: "__llm__", tier: "safe", ok: true, latencyMs: 90, tokens: 150 });
    const agg = (await store.aggregateUsage()).find((a) => a.tenantId === t.id);
    expect(agg?.tokens).toBe(400);
  });

  test("Stripe helpers degrade gracefully without a key (Faz 9C)", async () => {
    expect(billing.isLive()).toBe(false);
    expect(await billing.ensureBillingConfig()).toBeNull();
    const t = await store.createTenant("nostripe", "pro");
    expect(await billing.ensureCustomer(t.id)).toBeNull();
    expect(await billing.createPortalSession(t.id)).toBeNull();
    expect(await billing.createCheckoutSession(t.id)).toBeNull();
  });

  test("billing_config roundtrip + stripe event dedup (Faz 9C)", async () => {
    await store.setBillingConfig("meter_id", "mtr_123");
    expect(await store.getBillingConfig("meter_id")).toBe("mtr_123");
    // Check-only now (no side effect); the processed-marker is written separately so
    // a webhook handler can mark seen AFTER it succeeds (H6).
    expect(await store.stripeEventSeen("evt_1")).toBe(false);
    await store.markStripeEventProcessed("evt_1");
    expect(await store.stripeEventSeen("evt_1")).toBe(true);
  });
});

describe("per-tenant upstream servers (Faz 9E)", () => {
  test("add → list → delete (tenant-scoped)", async () => {
    const t = await store.createTenant("upco", "enterprise");
    const { id } = await store.addUpstreamServer(t.id, { name: "fs", transport: "stdio", command: "node", args: ["x.mjs"], allowed_tools: ["read"] });
    const list = await store.listUpstreamServers(t.id);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id, name: "fs", transport: "stdio" });
    expect(list[0].args).toEqual(["x.mjs"]);
    const other = await store.createTenant("upco2", "free");
    expect(await store.listUpstreamServers(other.id)).toHaveLength(0);
    expect(await store.deleteUpstreamServer(t.id, id)).toBe(true);
    expect(await store.listUpstreamServers(t.id)).toHaveLength(0);
  });
});

describe("audit log (Faz 6C)", () => {
  test("recordAudit + listAudit (newest-first, tenant-scoped)", async () => {
    const t = await store.createTenant("audco", "enterprise");
    await store.recordAudit({ tenantId: t.id, tool: "macos_terminal", tier: "privileged", ok: true });
    await store.recordAudit({ tenantId: t.id, tool: "git_commit", tier: "host", ok: false });
    const rows = await store.listAudit(t.id);
    expect(rows).toHaveLength(2);
    expect(rows[0].tool).toBe("git_commit");
    expect(rows[0].ok).toBe(0);
    expect(rows[1].tier).toBe("privileged");
  });
});

describe("auth middleware", () => {
  test("Bearer token resolves to req.tenant", async () => {
    const t = await store.createTenant("authco", "pro");
    const { key } = await store.issueApiKey(t.id);
    const req: any = { headers: { authorization: `Bearer ${key}` } };
    const res = mkRes(); const next = vi.fn();
    await auth.authMiddleware(true)(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.tenant?.tenantId).toBe(t.id);
  });

  test("missing key with required=true → 401", async () => {
    const req: any = { headers: {} };
    const res = mkRes(); const next = vi.fn();
    await auth.authMiddleware(true)(req, res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  test("invalid key → 401 even when not required", async () => {
    const req: any = { headers: { "x-api-key": "olm_nope" } };
    const res = mkRes(); const next = vi.fn();
    await auth.authMiddleware(false)(req, res, next);
    expect(res.statusCode).toBe(401);
  });
});

describe("rate-limit middleware (in-memory fallback, no REDIS_URL)", () => {
  test("token bucket exhausts → 429", async () => {
    const tenant = { tenantId: "rl1", keyId: "k", scopes: [], plan: { id: "tiny", name: "t", rate_per_min: 2, monthly_quota: 0, allowed_tiers: ["safe"] as any } };
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
    const t = await store.createTenant("quota", "free");
    const tenant = { tenantId: t.id, keyId: "k", scopes: [], plan: { id: "q", name: "q", rate_per_min: 1000, monthly_quota: 1, allowed_tiers: ["safe"] as any } };
    await store.recordUsage({ tenantId: t.id, tool: "x", tier: "safe", ok: true, latencyMs: 1 });
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

describe("store: OAuth 2.1 AS — codes + opaque tokens (Faz 19)", () => {
  test("DCR client binds to a tenant; getClient returns tenant_id", async () => {
    const t = await store.createTenant("oauth-owner", "pro");
    const c = await store.registerClient({ redirect_uris: ["https://app/cb"], tenant_id: t.id });
    expect((await store.getClient(c.client_id))!.tenant_id).toBe(t.id);
    const anon = await store.registerClient({ redirect_uris: ["https://app/cb"] });
    expect((await store.getClient(anon.client_id))!.tenant_id).toBeNull();
  });

  test("auth code is single-use and expiry-gated", async () => {
    await store.saveAuthCode({ code: "code-1", client_id: "oc_x", tenant_id: "t1", code_challenge: "chal", redirect_uri: "https://app/cb", scopes: "tools:safe", resource: null, expires_at: new Date(Date.now() + 60000).toISOString() });
    expect((await store.getAuthCode("code-1"))!.code_challenge).toBe("chal");
    const first = await store.consumeAuthCode("code-1");
    expect(first!.tenant_id).toBe("t1");
    expect(await store.consumeAuthCode("code-1")).toBeNull(); // already used
  });

  test("expired auth code does not resolve", async () => {
    await store.saveAuthCode({ code: "code-exp", client_id: "oc_x", tenant_id: "t1", code_challenge: "c", redirect_uri: "u", scopes: "", resource: null, expires_at: new Date(Date.now() - 1000).toISOString() });
    expect(await store.consumeAuthCode("code-exp")).toBeNull();
  });

  test("opaque token: issue → resolve → revoke", async () => {
    const token = await store.saveOAuthToken({ client_id: "oc_x", tenant_id: "t9", scopes: "tools:safe tools:host", resource: null, ttlSecs: 3600 });
    expect(token).toMatch(/^ot_/);
    const r = await store.resolveOAuthToken(token);
    expect(r!.tenantId).toBe("t9");
    expect(r!.scopes).toEqual(["tools:safe", "tools:host"]);
    await store.revokeOAuthToken(token);
    expect(await store.resolveOAuthToken(token)).toBeNull();
  });

  test("expired token does not resolve", async () => {
    const token = await store.saveOAuthToken({ client_id: "oc_x", tenant_id: "t9", scopes: "", resource: null, ttlSecs: -1 });
    expect(await store.resolveOAuthToken(token)).toBeNull();
  });
});
