import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// M-047 — GDPR self-service erasure + export. Real temp DB (like saas-store.test).
// Routes are registered onto a fake Express app so the handlers run without a
// full server boot; auth is a pass-through and the tenant is set on req (the
// production authMiddleware does this via the API key).
const DB = path.join(os.tmpdir(), `ollamas-erasure-${process.pid}.db`);
let store: typeof import("../server/store/index");
let account: typeof import("../server/account");

const TENANT = "tnt_erase_me";

function mkRes() {
  const r: any = { statusCode: 200, body: undefined };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: any) => { r.body = b; return r; };
  return r;
}
function fakeApp() {
  const routes: Record<string, any> = {};
  const reg = (method: string) => (p: string, ...h: any[]) => { routes[`${method} ${p}`] = h[h.length - 1]; };
  return { get: reg("GET"), post: reg("POST"), routes } as any;
}
const passAuth = (_req: any, _res: any, next: any) => next();

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  delete process.env.STRIPE_API_KEY;
  store = await import("../server/store/index");
  account = await import("../server/account");
  await store.initStore();
  // Seed a tenant with keys + usage + invoice + audit.
  const t = await store.createTenant("Erase Co", "free");
  // Reassign to a fixed id by inserting rows against the created id.
  const tid = t.id;
  (globalThis as any).__erase_tid = tid;
  await store.issueApiKey(tid, "k1");
  await store.recordUsage({ tenantId: tid, tool: "echo", tier: "safe", ok: true, latencyMs: 12, tokens: 10 });
  await store.recordInvoice(tid, "2026-07", 5);
  await store.recordAudit({ tenantId: tid, tool: "echo", tier: "safe", ok: true });
});
afterAll(() => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

describe("account export (GET /api/account/export)", () => {
  test("returns the full tenant dataset as JSON", async () => {
    const tid = (globalThis as any).__erase_tid;
    const app = fakeApp();
    account.registerAccountRoutes(app, passAuth);
    const res = mkRes();
    await app.routes["GET /api/account/export"]({ tenant: { tenantId: tid } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.tenant.id).toBe(tid);
    expect(res.body.apiKeys.length).toBeGreaterThanOrEqual(1);
    expect(res.body.usageEvents.length).toBeGreaterThanOrEqual(1);
    expect(res.body.invoices.length).toBeGreaterThanOrEqual(1);
  });

  test("401 without an authenticated tenant", async () => {
    const app = fakeApp();
    account.registerAccountRoutes(app, passAuth);
    const res = mkRes();
    await app.routes["GET /api/account/export"]({}, res);
    expect(res.statusCode).toBe(401);
  });
});

describe("account delete (POST /api/account/delete)", () => {
  test("erases all tenant data + keys, keeps an erasure audit trail", async () => {
    const tid = (globalThis as any).__erase_tid;
    const app = fakeApp();
    account.registerAccountRoutes(app, passAuth);
    const res = mkRes();
    await app.routes["POST /api/account/delete"]({ tenant: { tenantId: tid } }, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.deleted).toBe(true);

    // Tenant + its data are gone.
    expect(await store.getTenant(tid)).toBeNull();
    expect(await store.listKeys(tid)).toEqual([]);
    const agg = (await store.aggregateUsage("2026-07")).find((u) => u.tenantId === tid);
    expect(agg).toBeUndefined();
    expect(await store.hasInvoice(tid, "2026-07")).toBe(false);

    // Right-to-erasure itself is auditable: one fresh account.erase entry remains.
    const audit = await store.listAudit(tid);
    expect(audit.some((a) => a.tool === "account.erase")).toBe(true);
    expect(audit.filter((a) => a.tool === "echo")).toEqual([]);
  });
});
