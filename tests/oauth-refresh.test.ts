// Faz 22 (v1.13) — OAuth refresh-token rotation (RFC 9700). Hermetic store+provider
// test (same tmp-DB pattern as dcr.test.ts) → runs on BOTH dialects (sqlite default,
// Postgres in CI). Covers: issue access+refresh, rotate, reuse-detection (family
// revoke), client mismatch, scope-narrowing, expiry.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DB = path.join(os.tmpdir(), `ollamas-refresh-${process.pid}.db`);
let store: typeof import("../server/store/index");
let OllamasOAuthProvider: typeof import("../server/mcp/oauth-provider").OllamasOAuthProvider;

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  store = await import("../server/store/index");
  await store.initStore();
  ({ OllamasOAuthProvider } = await import("../server/mcp/oauth-provider"));
});
afterAll(() => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

const future = () => new Date(Date.now() + 60_000).toISOString();

describe("refresh-token rotation — store level (RFC 9700)", () => {
  test("rotate once consumes the token and returns the grant", async () => {
    const { token } = await store.saveRefreshToken({ client_id: "oc_a", tenant_id: "local", scopes: "tools:safe", resource: null, ttlSecs: 3600 });
    const r = await store.rotateRefreshToken(token);
    expect(r.status).toBe("ok");
    if (r.status === "ok") { expect(r.client_id).toBe("oc_a"); expect(r.tenant_id).toBe("local"); }
  });

  test("replay of a rotated token → reuse + the whole family is revoked", async () => {
    const { token, family_id } = await store.saveRefreshToken({ client_id: "oc_b", tenant_id: "local", scopes: "", resource: null, ttlSecs: 3600 });
    // a second live token in the same family (as a rotation would create)
    const { token: sibling } = await store.saveRefreshToken({ family_id, client_id: "oc_b", tenant_id: "local", scopes: "", resource: null, ttlSecs: 3600 });

    expect((await store.rotateRefreshToken(token)).status).toBe("ok"); // legit use
    expect((await store.rotateRefreshToken(token)).status).toBe("reuse"); // replay → compromise
    // family revoked → the sibling is now unusable too
    expect((await store.rotateRefreshToken(sibling)).status).toBe("reuse");
  });

  test("missing token → invalid; expired token → invalid", async () => {
    expect((await store.rotateRefreshToken("rt_does_not_exist")).status).toBe("invalid");
    const { token } = await store.saveRefreshToken({ client_id: "oc_c", tenant_id: "local", scopes: "", resource: null, ttlSecs: -10 });
    expect((await store.rotateRefreshToken(token)).status).toBe("invalid");
  });
});

describe("refresh-token rotation — provider level", () => {
  async function mintViaAuthCode(clientId: string, scopes = "tools:safe") {
    const prov = new OllamasOAuthProvider();
    const code = `ac_${clientId}_${Date.now()}`;
    await store.saveAuthCode({ code, client_id: clientId, tenant_id: "local", code_challenge: "x", redirect_uri: "https://cb", scopes, resource: null, expires_at: future() });
    const tokens = await prov.exchangeAuthorizationCode({ client_id: clientId } as any, code);
    return { prov, tokens };
  }

  test("authorization_code issues access + refresh; refresh rotates to a new pair", async () => {
    const { prov, tokens } = await mintViaAuthCode("oc_p1");
    expect(tokens.access_token).toMatch(/^ot_/);
    expect(tokens.refresh_token).toMatch(/^rt_/);

    const next = await prov.exchangeRefreshToken({ client_id: "oc_p1" } as any, tokens.refresh_token!);
    expect(next.access_token).toMatch(/^ot_/);
    expect(next.refresh_token).toMatch(/^rt_/);
    expect(next.refresh_token).not.toBe(tokens.refresh_token);
  });

  test("replaying the old refresh token throws invalid_grant (reuse) and kills the family", async () => {
    const { prov, tokens } = await mintViaAuthCode("oc_p2");
    const rotated = await prov.exchangeRefreshToken({ client_id: "oc_p2" } as any, tokens.refresh_token!);

    await expect(prov.exchangeRefreshToken({ client_id: "oc_p2" } as any, tokens.refresh_token!)).rejects.toThrow(/invalid_grant/);
    // family revoked → even the freshly rotated token no longer works
    await expect(prov.exchangeRefreshToken({ client_id: "oc_p2" } as any, rotated.refresh_token!)).rejects.toThrow(/invalid_grant/);
  });

  test("client mismatch is rejected", async () => {
    const { prov, tokens } = await mintViaAuthCode("oc_p3");
    await expect(prov.exchangeRefreshToken({ client_id: "oc_OTHER" } as any, tokens.refresh_token!)).rejects.toThrow(/invalid_grant/);
  });

  test("requesting a scope outside the original grant is rejected", async () => {
    const { prov, tokens } = await mintViaAuthCode("oc_p4", "tools:safe");
    await expect(prov.exchangeRefreshToken({ client_id: "oc_p4" } as any, tokens.refresh_token!, ["tools:privileged"])).rejects.toThrow(/invalid_scope/);
  });
});
