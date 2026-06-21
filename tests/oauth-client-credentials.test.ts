// Faz 22 (v1.13) — client_credentials grant (M2M). Self-booted server (same pattern
// as mcp-gateway.e2e.test.ts). A confidential, tenant-bound client with the
// client_credentials grant exchanges its secret for an access token; the SDK's
// /token still handles every other grant. Covers happy-path + the rejection paths.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = Number(process.env.TEST_CC_PORT || 3981);
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `ollamas-cc-${process.pid}.db`);
const ADMIN = "test-admin-token";
let child: ChildProcess;

const j = (r: Response) => r.json() as any;
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("server did not become healthy in time");
}

beforeAll(async () => {
  child = spawn("npx", ["tsx", "server.ts"], {
    cwd: ROOT, detached: true,
    env: { ...process.env, PORT: String(PORT), SAAS_ENFORCE: "1", SAAS_ADMIN_TOKEN: ADMIN, SAAS_DB_PATH: DB, HOST_BRIDGE_URL: "http://127.0.0.1:9" },
    stdio: "ignore",
  });
  await waitForHealth();
}, 40000);

afterAll(() => {
  try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch {}
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

/** Create a tenant + api-key, then DCR-register a tenant-bound confidential client. */
async function boundClient(grantTypes: string[]) {
  const t = await j(await fetch(`${BASE}/api/saas/tenants`, {
    method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
    body: JSON.stringify({ name: "cc", plan: "free" }),
  }));
  const k = await j(await fetch(`${BASE}/api/saas/keys`, {
    method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
    body: JSON.stringify({ tenantId: t.id }),
  }));
  return j(await fetch(`${BASE}/register`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${k.key}` },
    body: JSON.stringify({ token_endpoint_auth_method: "client_secret_basic", grant_types: grantTypes }),
  }));
}

describe("client_credentials grant (v1.13, self-booted)", () => {
  test("confidential client → access token that authenticates against /mcp", async () => {
    const c = await boundClient(["client_credentials"]);
    expect(c.client_secret).toMatch(/^ocs_/);

    const tok = await j(await fetch(`${BASE}/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ grant_type: "client_credentials", client_id: c.client_id, client_secret: c.client_secret, scope: "tools:safe" }),
    }));
    expect(tok.access_token).toMatch(/^ot_/);
    expect(tok.token_type).toBe("bearer");

    // The cc-issued token must pass auth on /mcp (no token → 401).
    const noAuth = await fetch(`${BASE}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cc", version: "0" } } }),
    });
    expect(noAuth.status).toBe(401);

    const withAuth = await fetch(`${BASE}/mcp`, {
      method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tok.access_token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cc", version: "0" } } }),
    });
    expect(withAuth.status).not.toBe(401); // auth passed (protocol result irrelevant here)
  }, 30000);

  test("wrong secret → 401 invalid_client", async () => {
    const c = await boundClient(["client_credentials"]);
    const r = await fetch(`${BASE}/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ grant_type: "client_credentials", client_id: c.client_id, client_secret: "ocs_wrong" }),
    });
    expect(r.status).toBe(401);
    expect((await j(r)).error).toBe("invalid_client");
  }, 30000);

  test("grant not in client's grant_types → 400 unauthorized_client", async () => {
    const c = await boundClient(["authorization_code"]); // client_credentials NOT allowed
    const r = await fetch(`${BASE}/token`, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form({ grant_type: "client_credentials", client_id: c.client_id, client_secret: c.client_secret }),
    });
    expect(r.status).toBe(400);
    expect((await j(r)).error).toBe("unauthorized_client");
  }, 30000);
});
