import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Round-5 HIGH (S2): exchangeRefreshToken consumed the refresh token (rotateRefreshToken
// flips used=1) BEFORE validating the client binding, so an attacker presenting a victim's
// refresh token with a different client consumed it — the victim's next legitimate use then
// looked like a reuse and revoked the whole family (DoS). The fix checks the client binding
// (non-consuming) first.
const DB = path.join(os.tmpdir(), `ollamas-refbind-${process.pid}.db`);
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

describe("refresh-token cross-client DoS guard (Round-5 HIGH)", () => {
  test("a wrong-client presentation is rejected WITHOUT consuming the victim's token", async () => {
    const { token } = await store.saveRefreshToken({ client_id: "oc_victim", tenant_id: "local", scopes: "tools:safe", resource: null, ttlSecs: 3600 });
    const provider = new OllamasOAuthProvider();
    // Attacker presents the victim's refresh token bound to oc_victim, but as oc_attacker.
    await expect(provider.exchangeRefreshToken({ client_id: "oc_attacker" } as any, token)).rejects.toThrow(/client mismatch/i);
    // The victim's token is still valid (not consumed by the attacker's attempt) → no false reuse.
    expect((await store.rotateRefreshToken(token)).status).toBe("ok");
  });

  test("refreshTokenClientId returns the binding without consuming", async () => {
    const { token } = await store.saveRefreshToken({ client_id: "oc_x", tenant_id: "local", scopes: "tools:safe", resource: null, ttlSecs: 3600 });
    expect(await store.refreshTokenClientId(token)).toBe("oc_x");
    expect(await store.refreshTokenClientId(token)).toBe("oc_x"); // idempotent / non-consuming
    expect((await store.rotateRefreshToken(token)).status).toBe("ok"); // still consumable
  });
});
