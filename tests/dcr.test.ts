// Faz 15B — OAuth 2.1 Dynamic Client Registration (RFC 7591). Hermetic store test
// (same tmp-DB pattern as saas-store.test.ts) so it runs on BOTH dialects: sqlite
// by default, Postgres when DATABASE_URL is set (CI matrix). Also checks the
// RFC 8414 AS-metadata builder advertises the registration_endpoint.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { buildAuthServerMetadata, buildResourceMetadata, REGISTRATION_PATH } from "../server/mcp/oauth-metadata";

const DB = path.join(os.tmpdir(), `ollamas-dcr-${process.pid}.db`);
let store: typeof import("../server/store/index");

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  store = await import("../server/store/index");
  await store.initStore();
});
afterAll(() => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

describe("DCR client registration (store)", () => {
  test("confidential client gets a one-time secret + registration token", async () => {
    const r = await store.registerClient({ redirect_uris: ["https://app.example.com/cb"], client_name: "test-app" });
    expect(r.client_id).toMatch(/^oc_[0-9a-f]{16}$/);
    expect(r.client_secret).toMatch(/^ocs_/);
    expect(r.registration_access_token).toMatch(/^rat_/);
    expect(r.token_endpoint_auth_method).toBe("client_secret_basic");
    // Stored, and the lookup never returns the secret.
    const c = await store.getClient(r.client_id);
    expect(c).not.toBeNull();
    expect(c!.redirect_uris).toEqual(["https://app.example.com/cb"]);
    expect(c as any).not.toHaveProperty("client_secret");
    expect(c as any).not.toHaveProperty("client_secret_hash");
  });

  test("public client (auth_method=none) gets NO secret (RFC 7591)", async () => {
    const r = await store.registerClient({ token_endpoint_auth_method: "none", redirect_uris: [] });
    expect(r.client_secret).toBeUndefined();
    expect(r.client_secret_hash).toBeNull();
  });

  test("defaults grant_types when omitted", async () => {
    const r = await store.registerClient({});
    expect(r.grant_types).toEqual(["authorization_code", "refresh_token"]); // refresh added in v1.13
  });

  test("migration v2 (oauth_clients) is recorded + idempotent", async () => {
    const versions = await store.appliedVersions();
    expect(versions).toContain(2);
    // Re-running migrations is a no-op (already applied).
    const applied = await store.migrateNow();
    expect(applied).not.toContain(2);
  });
});

describe("RFC 8414 authorization-server metadata", () => {
  test("advertises the DCR registration_endpoint", () => {
    const m = buildAuthServerMetadata("https://gw.example.com") as any;
    expect(m.registration_endpoint).toBe(`https://gw.example.com${REGISTRATION_PATH}`);
    expect(m.issuer).toBe("https://gw.example.com");
  });

  test("resource metadata points clients at the AS (DCR discoverable by default)", () => {
    delete process.env.OAUTH_AUTH_SERVERS;
    const rm = buildResourceMetadata("https://gw.example.com") as any;
    expect(rm.authorization_servers).toContain("https://gw.example.com");
  });
});
