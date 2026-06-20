// Faz 28 (v1.19) — live deploy smoke. ONE chained production scenario against a real
// self-booted instance (vs the granular asserts in mcp-gateway.e2e): boot → health/
// ready/metrics → admin tenant+key → MCP tools/list + real safe tool call → OAuth DCR
// client_credentials → /token → token authenticates /mcp → supervisor status. Run via
// `npm run smoke`. The LLM dogfood step is gated on a reachable local ollama.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.TEST_SMOKE_PORT || 3982);
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `ollamas-smoke-${process.pid}.db`);
const ADMIN = "smoke-admin-token";
let child: ChildProcess;
const j = (r: Response) => r.json() as any;
const form = (o: Record<string, string>) => new URLSearchParams(o).toString();

async function waitForHealth(timeoutMs = 40000) {
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
}, 50000);

afterAll(() => {
  try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch {}
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

describe("live deploy smoke (production scenario)", () => {
  test("health + ready + metrics + discovery are live", async () => {
    const h = await j(await fetch(`${BASE}/api/health`));
    expect(h.db).toBe("up");
    expect((await fetch(`${BASE}/api/ready`)).status).toBe(200);
    expect((await fetch(`${BASE}/metrics`)).ok).toBe(true);
    const disc = await j(await fetch(`${BASE}/.well-known/mcp.json`));
    expect(disc.capabilities).toHaveProperty("roots");
    expect(disc.capabilities).toHaveProperty("tools");
  }, 30000);

  test("tenant key → MCP tools/list + a real safe tool call through the choke-point", async () => {
    const t = await j(await fetch(`${BASE}/api/saas/tenants`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN }, body: JSON.stringify({ name: "smoke", plan: "free" }) }));
    const k = await j(await fetch(`${BASE}/api/saas/keys`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN }, body: JSON.stringify({ tenantId: t.id }) }));

    const c = new Client({ name: "smoke", version: "0" }, { capabilities: {} });
    const tr = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${k.key}` } } });
    await c.connect(tr);
    const { tools } = await c.listTools();
    expect(tools.length).toBe(16); // free = safe tier
    expect(tools.some((x) => x.name === "sample")).toBe(true);
    const res: any = await c.callTool({ name: "list_tree", arguments: {} });
    await c.close();
    expect(res.content).toBeDefined(); // tool executed through ToolRegistry.execute
  }, 30000);

  test("OAuth client_credentials → token authenticates /mcp; supervisor status is live", async () => {
    const t = await j(await fetch(`${BASE}/api/saas/tenants`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN }, body: JSON.stringify({ name: "smoke-cc", plan: "free" }) }));
    const k = await j(await fetch(`${BASE}/api/saas/keys`, { method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN }, body: JSON.stringify({ tenantId: t.id }) }));
    const reg = await j(await fetch(`${BASE}/register`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${k.key}` }, body: JSON.stringify({ token_endpoint_auth_method: "client_secret_basic", grant_types: ["client_credentials"] }) }));
    const tok = await j(await fetch(`${BASE}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form({ grant_type: "client_credentials", client_id: reg.client_id, client_secret: reg.client_secret, scope: "tools:safe" }) }));
    expect(tok.access_token).toMatch(/^ot_/);

    const authed = await fetch(`${BASE}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${tok.access_token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "cc", version: "0" } } }) });
    expect(authed.status).not.toBe(401);

    const sup = await fetch(`${BASE}/api/saas/upstreams/status`, { headers: { authorization: `Bearer ${k.key}` } });
    expect(sup.status).toBe(200);
    expect(Array.isArray(await sup.json())).toBe(true);
  }, 30000);

  test("real LLM dogfood via /api/ai/generate (gated on local ollama)", async () => {
    const ollamaUp = await fetch("http://localhost:11434/api/tags").then((r) => r.ok).catch(() => false);
    if (!ollamaUp) { expect(true).toBe(true); return; } // skip when ollama is not running
    const r = await j(await fetch(`${BASE}/api/ai/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "Reply with exactly one word: ALIVE" }) }));
    expect(typeof r.text).toBe("string");
    expect(r.text.length).toBeGreaterThan(0);
  }, 90000);
});
