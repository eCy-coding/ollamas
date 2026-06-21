// Faz 26 (v1.17) — OAuth expired-row GC. purgeExpiredOAuth() deletes EXPIRED
// authorization codes + access tokens + refresh tokens, keeping fresh ones. Security
// invariant: a used-but-unexpired refresh token survives so RFC 9700 reuse detection
// still works within its TTL. Hermetic store test (sqlite default; pg in CI).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DB = path.join(os.tmpdir(), `ollamas-gc-${process.pid}.db`);
let store: typeof import("../server/store/index");

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  store = await import("../server/store/index");
  await store.initStore();
});
afterAll(() => { for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {} });

const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

describe("OAuth expired-row GC (Faz 26)", () => {
  test("purges expired codes/tokens/refresh, keeps fresh", async () => {
    await store.saveAuthCode({ code: "ac_expired", client_id: "c", tenant_id: "t", code_challenge: "x", redirect_uri: "u", scopes: "", resource: null, expires_at: iso(-10_000) });
    await store.saveAuthCode({ code: "ac_fresh", client_id: "c", tenant_id: "t", code_challenge: "x", redirect_uri: "u", scopes: "", resource: null, expires_at: iso(60_000) });
    await store.saveOAuthToken({ client_id: "c", tenant_id: "t", scopes: "", resource: null, ttlSecs: -10 });
    const freshTok = await store.saveOAuthToken({ client_id: "c", tenant_id: "t", scopes: "", resource: null, ttlSecs: 3600 });
    const expiredRt = await store.saveRefreshToken({ client_id: "c", tenant_id: "t", scopes: "", resource: null, ttlSecs: -10 });
    const freshRt = await store.saveRefreshToken({ client_id: "c", tenant_id: "t", scopes: "", resource: null, ttlSecs: 3600 });

    const res = await store.purgeExpiredOAuth();
    expect(res.codes).toBeGreaterThanOrEqual(1);
    expect(res.tokens).toBeGreaterThanOrEqual(1);
    expect(res.refresh).toBeGreaterThanOrEqual(1);

    // Fresh rows survive; expired rows are gone.
    expect(await store.getAuthCode("ac_fresh")).not.toBeNull();
    expect(await store.getAuthCode("ac_expired")).toBeNull();
    expect(await store.resolveOAuthToken(freshTok)).not.toBeNull();
    expect((await store.rotateRefreshToken(freshRt.token)).status).toBe("ok");
    expect((await store.rotateRefreshToken(expiredRt.token)).status).toBe("invalid"); // purged
  });

  test("a used-but-unexpired refresh survives GC → reuse detection preserved", async () => {
    const rt = await store.saveRefreshToken({ client_id: "c", tenant_id: "t", scopes: "", resource: null, ttlSecs: 3600 });
    expect((await store.rotateRefreshToken(rt.token)).status).toBe("ok"); // used=1, still unexpired
    await store.purgeExpiredOAuth(); // must NOT delete it
    expect((await store.rotateRefreshToken(rt.token)).status).toBe("reuse"); // replay still caught
  });
});
