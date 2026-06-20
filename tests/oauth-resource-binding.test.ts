// Faz 25 (v1.16) — RFC 8707 resource binding on opaque OAuth tokens. A token bound
// to a `resource` (audience) must be rejected when presented to a different resource
// server (no cross-resource token reuse). A token with no resource stays
// unrestricted (backward-compatible). Hermetic store + authMiddleware mock req/res.
import { describe, test, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DB = path.join(os.tmpdir(), `ollamas-resbind-${process.pid}.db`);
let store: typeof import("../server/store/index");
let authMiddleware: typeof import("../server/middleware/auth").authMiddleware;

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  delete process.env.OAUTH_AUDIENCE; // expected resource = `${base}/mcp`
  store = await import("../server/store/index");
  await store.initStore();
  ({ authMiddleware } = await import("../server/middleware/auth"));
});
afterAll(() => { for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {} });

function mockReqRes(token: string, host = "api.example") {
  const req: any = { headers: { authorization: `Bearer ${token}`, host }, get: (h: string) => (h === "host" ? host : undefined), protocol: "http" };
  const res: any = { _status: 200, _json: null, setHeader() {}, status(c: number) { this._status = c; return this; }, json(o: any) { this._json = o; return this; } };
  const next = vi.fn();
  return { req, res, next };
}

async function mintToken(resource: string | null) {
  const t = await store.createTenant("res", "free");
  return store.saveOAuthToken({ client_id: "oc_x", tenant_id: t.id, scopes: "tools:safe", resource, ttlSecs: 3600 });
}

describe("RFC 8707 resource binding on opaque OAuth tokens (Faz 25)", () => {
  test("token resource matching the request resource → authenticated", async () => {
    const token = await mintToken("http://api.example/mcp");
    const { req, res, next } = mockReqRes(token, "api.example");
    await authMiddleware()(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.tenant?.tenantId).toBeTruthy();
  });

  test("token bound to a DIFFERENT resource → 401 (no cross-resource reuse)", async () => {
    const token = await mintToken("http://other.example/mcp");
    const { req, res, next } = mockReqRes(token, "api.example"); // expected = http://api.example/mcp
    await authMiddleware()(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._status).toBe(401);
  });

  test("token with no resource is unrestricted (backward-compat)", async () => {
    const token = await mintToken(null);
    const { req, res, next } = mockReqRes(token, "api.example");
    await authMiddleware()(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.tenant?.tenantId).toBeTruthy();
  });

  test("trailing slash is canonicalized (…/mcp == …/mcp/)", async () => {
    const token = await mintToken("http://api.example/mcp/");
    const { req, res, next } = mockReqRes(token, "api.example"); // expected http://api.example/mcp
    await authMiddleware()(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });
});
