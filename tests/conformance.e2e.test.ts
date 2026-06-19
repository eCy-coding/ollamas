// v1.7-B: MCP conformance harness. Drives the live /mcp EXPOSE endpoint with the
// official MCP Inspector CLI (@modelcontextprotocol/inspector --cli, MIT) — an
// INDEPENDENT client implementation, so this catches protocol drift the in-repo
// SDK-client e2e tests cannot (same SDK on both sides). Boots the real server,
// mints a tenant key, then asserts Inspector's JSON output for the core methods.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = Number(process.env.TEST_CONFORMANCE_PORT || 3979);
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `ollamas-conf-${process.pid}.db`);
const ADMIN = "test-admin-token";
const INSPECTOR = path.join(ROOT, "node_modules", ".bin", "mcp-inspector");

let child: ChildProcess;

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("server did not become healthy in time");
}

// Run the Inspector CLI against /mcp (streamable HTTP) and return parsed stdout JSON.
async function inspect(key: string, args: string[]): Promise<any> {
  const { stdout } = await execFileP(
    INSPECTOR,
    ["--cli", `${BASE}/mcp`, "--transport", "http", "--header", `Authorization: Bearer ${key}`, ...args],
    { cwd: ROOT, timeout: 30000, maxBuffer: 64 << 20 }
  );
  return JSON.parse(stdout);
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

async function mintKey(plan = "enterprise"): Promise<string> {
  const j = (r: Response) => r.json() as any;
  const t = await j(await fetch(`${BASE}/api/saas/tenants`, {
    method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
    body: JSON.stringify({ name: `conf-${plan}`, plan }),
  }));
  const k = await j(await fetch(`${BASE}/api/saas/keys`, {
    method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
    body: JSON.stringify({ tenantId: t.id }),
  }));
  return k.key;
}

describe("MCP conformance (official Inspector CLI vs live /mcp)", () => {
  test("tools/list returns spec-shaped tool descriptors", async () => {
    const key = await mintKey();
    const out = await inspect(key, ["--method", "tools/list"]);
    expect(Array.isArray(out.tools)).toBe(true);
    expect(out.tools.length).toBeGreaterThan(0);
    const read = out.tools.find((t: any) => t.name === "read_file");
    expect(read).toBeTruthy();
    expect(read.inputSchema?.type).toBe("object");
  }, 40000);

  test("tools/call (list_tree) executes through the choke-point", async () => {
    const key = await mintKey();
    const out = await inspect(key, ["--method", "tools/call", "--tool-name", "list_tree"]);
    // Inspector surfaces CallToolResult: content[] present, not a protocol error.
    expect(Array.isArray(out.content)).toBe(true);
  }, 40000);

  test("prompts/list exposes the 3-stage pipeline", async () => {
    const key = await mintKey();
    const out = await inspect(key, ["--method", "prompts/list"]);
    const names = (out.prompts || []).map((p: any) => p.name).sort();
    expect(names).toEqual(["architect", "coder", "reviewer"]);
  }, 40000);
});
