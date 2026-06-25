import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DB = path.join(os.tmpdir(), `ollamas-refresh-race-${process.pid}.db`);
let store: typeof import("../server/store/index");

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  store = await import("../server/store/index");
  await store.initStore();
});
afterAll(() => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

// H4: rotateRefreshToken did SELECT-then-UPDATE, so two concurrent rotations of the
// same token both read used=0 and both minted a fresh grant (double-spend, RFC 9700
// violation). The atomic CAS (UPDATE ... WHERE used=0) lets exactly one win.
describe("refresh-token rotation race (H4)", () => {
  test("concurrent rotation consumes the token exactly once", async () => {
    const { token } = await store.saveRefreshToken({ client_id: "oc_race", tenant_id: "local", scopes: "tools:safe", resource: null, ttlSecs: 3600 });
    const results = await Promise.all([
      store.rotateRefreshToken(token),
      store.rotateRefreshToken(token),
    ]);
    const statuses = results.map((r) => r.status);
    expect(statuses.filter((s) => s === "ok").length).toBe(1); // exactly one grant — never two
    expect(statuses).toContain("reuse"); // the loser is flagged reuse (family revoked)
  });

  test("a normal (non-concurrent) rotation still works", async () => {
    const { token } = await store.saveRefreshToken({ client_id: "oc_seq", tenant_id: "local", scopes: "tools:safe", resource: null, ttlSecs: 3600 });
    expect((await store.rotateRefreshToken(token)).status).toBe("ok");
    expect((await store.rotateRefreshToken(token)).status).toBe("reuse"); // second use = replay
  });
});
