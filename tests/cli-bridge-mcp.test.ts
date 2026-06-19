import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { join } from "node:path";

// Smoke-test the POSIX bridge (cli/bin/ollamas.sh) against a tiny Node stub that
// records each request. Proves the v6 additions (mcp upstreams/add/rm + saas)
// hit the right method/path/headers/body without needing the real gateway.

const BRIDGE = join(__dirname, "..", "cli", "bin", "ollamas.sh");

interface Rec {
  method: string;
  url: string;
  auth?: string;
  admin?: string;
  body: string;
}

let server: Server;
let port = 0;
const seen: Rec[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push({
        method: req.method || "",
        url: req.url || "",
        auth: req.headers["authorization"] as string | undefined,
        admin: req.headers["x-admin-token"] as string | undefined,
        body,
      });
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  port = (server.address() as any).port;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

// Async spawn (NOT spawnSync): the stub server shares this process's event loop,
// so a synchronous child would deadlock — curl could never be answered.
function runBridge(args: string[]): Promise<{ status: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("sh", [BRIDGE, ...args], {
      env: {
        ...process.env,
        OLLAMAS_GATEWAY: `http://127.0.0.1:${port}`,
        OLLAMAS_API_KEY: "olm_test",
        OLLAMAS_SAAS_ADMIN: "admin_test",
      },
    });
    let stdout = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.on("close", (code) => resolve({ status: code ?? -1, stdout }));
  });
}

describe("ollamas.sh mcp upstreams/add/rm", () => {
  it("upstreams → GET /api/saas/upstreams with Bearer", async () => {
    seen.length = 0;
    const { status } = await runBridge(["mcp", "upstreams"]);
    expect(status).toBe(0);
    expect(seen[0]).toMatchObject({ method: "GET", url: "/api/saas/upstreams", auth: "Bearer olm_test" });
  });

  it("add → POST with name/transport/url + allowedTools array", async () => {
    seen.length = 0;
    const { status } = await runBridge(["mcp", "add", "ukp", "http", "http://u:9", "hesapla,seyir"]);
    expect(status).toBe(0);
    expect(seen[0]).toMatchObject({ method: "POST", url: "/api/saas/upstreams", auth: "Bearer olm_test" });
    const json = JSON.parse(seen[0].body);
    expect(json).toMatchObject({ name: "ukp", transport: "http", url: "http://u:9", allowedTools: ["hesapla", "seyir"] });
  });

  it("add without allow → allowedTools null", async () => {
    seen.length = 0;
    await runBridge(["mcp", "add", "ukp", "stdio", ""]);
    expect(JSON.parse(seen[0].body).allowedTools).toBeNull();
  });

  it("rm <id> → DELETE /api/saas/upstreams/<id>", async () => {
    seen.length = 0;
    const { status } = await runBridge(["mcp", "rm", "u1"]);
    expect(status).toBe(0);
    expect(seen[0]).toMatchObject({ method: "DELETE", url: "/api/saas/upstreams/u1" });
  });

  it("add missing args → usage error, no request", async () => {
    seen.length = 0;
    const { status } = await runBridge(["mcp", "add", "onlyname"]);
    expect(status).toBe(2);
    expect(seen.length).toBe(0);
  });
});

describe("ollamas.sh saas (read-only, admin token)", () => {
  it("plans → GET /api/saas/plans with X-Admin-Token", async () => {
    seen.length = 0;
    const { status } = await runBridge(["saas", "plans"]);
    expect(status).toBe(0);
    expect(seen[0]).toMatchObject({ method: "GET", url: "/api/saas/plans", admin: "admin_test" });
  });

  it("tenants → GET /api/saas/tenants", async () => {
    seen.length = 0;
    await runBridge(["saas", "tenants"]);
    expect(seen[0].url).toBe("/api/saas/tenants");
  });

  it("usage <tid> → GET /api/saas/usage?tenantId=<tid>", async () => {
    seen.length = 0;
    await runBridge(["saas", "usage", "t42"]);
    expect(seen[0].url).toBe("/api/saas/usage?tenantId=t42");
  });

  it("unknown saas sub → exit 2", async () => {
    seen.length = 0;
    const { status } = await runBridge(["saas", "bogus"]);
    expect(status).toBe(2);
  });
});
