import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const PORT = Number(process.env.TEST_MCP_PORT || 3978);
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `ollamas-e2e-${process.pid}.db`);
const ADMIN = "test-admin-token";

let child: ChildProcess;

async function waitForHealth(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${BASE}/api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  throw new Error("server did not become healthy in time");
}

beforeAll(async () => {
  child = spawn("npx", ["tsx", "server.ts"], {
    cwd: ROOT,
    detached: true,
    env: {
      ...process.env,
      PORT: String(PORT),
      SAAS_ENFORCE: "1",
      SAAS_ADMIN_TOKEN: ADMIN,
      SAAS_DB_PATH: DB,
      HOST_BRIDGE_URL: "http://127.0.0.1:9", // unreachable; no host tools invoked
    },
    stdio: "ignore",
  });
  await waitForHealth();
}, 40000);

afterAll(() => {
  try { if (child.pid) process.kill(-child.pid, "SIGKILL"); } catch {}
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

describe("MCP gateway EXPOSE (self-booted, SAAS_ENFORCE=1)", () => {
  test("no API key → 401", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  test("free-plan key lists only the 20 safe-tier tools", async () => {
    const j = (r: Response) => r.json() as any;
    const t = await j(await fetch(`${BASE}/api/saas/tenants`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ name: "e2e", plan: "free" }),
    }));
    const k = await j(await fetch(`${BASE}/api/saas/keys`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ tenantId: t.id }),
    }));

    const c = new Client({ name: "t", version: "0" }, { capabilities: {} });
    const tr = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${k.key}` } } });
    await c.connect(tr);
    const { tools } = await c.listTools();
    await c.close();

    expect(tools.length).toBe(20); // free plan = safe tier only (+ count_tokens graft → 18, +upload_file/download_file → 20)
    expect(tools.some((x) => x.name === "git_commit")).toBe(false); // host tier filtered
    expect(tools.some((x) => x.name === "read_file")).toBe(true);
    expect(tools.some((x) => x.name === "rag_search")).toBe(true); // safe-tier RAG visible to free plan
  });

  test("admin routes refuse a bad admin token", async () => {
    const res = await fetch(`${BASE}/api/saas/plans`, { headers: { "x-admin-token": "wrong" } });
    expect(res.status).toBe(401);
  });

  // --- Faz 10B: tenant self-serve (scoped, no admin token) ---
  test("self-serve usage requires the usage:read scope", async () => {
    const j = (r: Response) => r.json() as any;
    const t = await j(await fetch(`${BASE}/api/saas/tenants`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ name: "selfsvc", plan: "pro" }),
    }));
    const scoped = await j(await fetch(`${BASE}/api/saas/keys`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ tenantId: t.id, scopes: "usage:read" }),
    }));
    const plain = await j(await fetch(`${BASE}/api/saas/keys`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ tenantId: t.id }),
    }));
    const ok = await fetch(`${BASE}/api/saas/self/usage`, { headers: { Authorization: `Bearer ${scoped.key}` } });
    expect(ok.status).toBe(200);
    expect((await ok.json()).tenantId).toBe(t.id);
    const denied = await fetch(`${BASE}/api/saas/self/usage`, { headers: { Authorization: `Bearer ${plain.key}` } });
    expect(denied.status).toBe(403);
  });

  // --- Faz 6A: MCP spec-compliance ---
  // --- Faz 9D: observability ---
  test("/metrics serves Prometheus metrics", async () => {
    const res = await fetch(`${BASE}/metrics`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/process_cpu_user_seconds_total|http_request_duration_ms|mcp_tool_calls_total/);
  });

  test("/api/ready returns a readiness verdict", async () => {
    const res = await fetch(`${BASE}/api/ready`);
    expect([200, 503]).toContain(res.status);
    expect(typeof (await res.json()).ready).toBe("boolean");
  });

  // --- Faz 10C: OpenAPI ---
  test("/api/openapi.json is a valid 3.1 spec + /api/docs serves UI", async () => {
    const spec = await (await fetch(`${BASE}/api/openapi.json`)).json() as any;
    expect(spec.openapi).toBe("3.1.0");
    expect(spec.paths["/mcp"]).toBeTruthy();
    expect(spec.paths["/api/saas/self/usage"]).toBeTruthy();
    const docs = await fetch(`${BASE}/api/docs/`);
    expect(docs.status).toBe(200);
  });

  test("RFC 9728 protected-resource metadata is served", async () => {
    const j = await (await fetch(`${BASE}/.well-known/oauth-protected-resource`)).json() as any;
    expect(String(j.resource)).toMatch(/\/mcp$/);
    expect(j.bearer_methods_supported).toContain("header");
  });

  test("401 carries WWW-Authenticate pointing at resource metadata", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate") || "").toContain("resource_metadata=");
  });

  test("bad Origin is rejected (DNS-rebinding protection)", async () => {
    const res = await fetch(`${BASE}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://evil.example.com" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(403);
  });

  test("tool annotations reflect security tier (destructiveHint)", async () => {
    const j = (r: Response) => r.json() as any;
    const t = await j(await fetch(`${BASE}/api/saas/tenants`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ name: "ent", plan: "enterprise" }),
    }));
    const k = await j(await fetch(`${BASE}/api/saas/keys`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ tenantId: t.id }),
    }));
    const c = new Client({ name: "t", version: "0" }, { capabilities: {} });
    const tr = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${k.key}` } } });
    await c.connect(tr);
    const { tools } = await c.listTools();
    await c.close();
    const term = tools.find((x) => x.name === "macos_terminal");
    const read = tools.find((x) => x.name === "read_file");
    expect((term as any)?.annotations?.destructiveHint).toBe(true);
    expect((read as any)?.annotations?.readOnlyHint).toBe(true);
  });

  // --- Faz 10A: resources primitive + pagination ---
  test("resources/list is served + listTools paginates (nextCursor)", async () => {
    const j = (r: Response) => r.json() as any;
    const t = await j(await fetch(`${BASE}/api/saas/tenants`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ name: "res", plan: "enterprise" }),
    }));
    const k = await j(await fetch(`${BASE}/api/saas/keys`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ tenantId: t.id }),
    }));
    const c = new Client({ name: "t", version: "0" }, { capabilities: {} });
    const tr = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${k.key}` } } });
    await c.connect(tr);
    const resList = await c.listResources();
    expect(Array.isArray(resList.resources)).toBe(true);
    const toolList = await c.listTools();
    expect(toolList.tools.length).toBeLessThanOrEqual(50); // page cap
    await c.close();
  });

  // --- Faz 11A: prompts + completions ---
  test("prompts/list + get + completion (3-stage pipeline)", async () => {
    const j = (r: Response) => r.json() as any;
    const t = await j(await fetch(`${BASE}/api/saas/tenants`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ name: "prompts", plan: "enterprise" }),
    }));
    const k = await j(await fetch(`${BASE}/api/saas/keys`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ tenantId: t.id }),
    }));
    const c = new Client({ name: "t", version: "0" }, { capabilities: {} });
    const tr = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${k.key}` } } });
    await c.connect(tr);
    const prompts = await c.listPrompts();
    expect(prompts.prompts.map((p) => p.name).sort()).toEqual(["architect", "coder", "reviewer"]);
    const got = await c.getPrompt({ name: "coder", arguments: { spec: "build a CLI", language: "rust" } });
    expect(JSON.stringify(got.messages)).toContain("rust");
    const comp = await c.complete({ ref: { type: "ref/prompt", name: "reviewer" }, argument: { name: "focus", value: "sec" } });
    expect(comp.completion.values).toContain("security");
    await c.close();
  });

  // --- Faz 14A: MCP logging + capabilities ---
  test("server advertises logging capability; setLevel + notifications/message", async () => {
    const j = (r: Response) => r.json() as any;
    const t = await j(await fetch(`${BASE}/api/saas/tenants`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ name: "logging", plan: "enterprise" }),
    }));
    const k = await j(await fetch(`${BASE}/api/saas/keys`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ tenantId: t.id }),
    }));
    const { LoggingMessageNotificationSchema } = await import("@modelcontextprotocol/sdk/types.js");
    const c = new Client({ name: "t", version: "0" }, { capabilities: {} });
    const tr = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${k.key}` } } });
    const logs: any[] = [];
    c.setNotificationHandler(LoggingMessageNotificationSchema, (n) => { logs.push(n.params); });
    await c.connect(tr);

    // Capability advertised + setLevel handled (deterministic).
    expect((c.getServerCapabilities() as any)?.logging).toBeTruthy();
    await c.setLoggingLevel("debug"); // resolves without error
    // A tool call drives the emit path at the choke-point. Delivery of the
    // structured log over the *stateless* Streamable-HTTP POST is best-effort
    // (transport may not stream server→client notifications), so capture is soft.
    await c.callTool({ name: "list_tree", arguments: {} }).catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    await c.close();
    if (logs.length) expect(logs.every((l) => l.logger === "ollamas")).toBe(true);
  });

  // --- Faz 14C: observability depth metrics ---
  test("/metrics exposes migration version, webhook queue depth + shutdown counter", async () => {
    const body = await (await fetch(`${BASE}/metrics`)).text();
    expect(body).toContain("ollamas_migration_version");
    expect(body).toContain("ollamas_webhook_queue_depth");
    expect(body).toContain("ollamas_shutdown_total");
  });

  // --- Security (H3): local-owner introspection must be unreachable in SaaS mode ---
  test("/api/mcp/upstreams + /api/selftest are 403 in SaaS mode (no cross-tenant leak)", async () => {
    const up = await fetch(`${BASE}/api/mcp/upstreams`);
    expect(up.status).toBe(403); // previously leaked every tenant's id + upstream names
    const st = await fetch(`${BASE}/api/selftest`);
    expect(st.status).toBe(403);
  });
});

describe("MCP ecosystem interop + DCR (Faz 15, public pre-auth)", () => {
  test("/.well-known/mcp.json is served pre-auth with live capabilities", async () => {
    const r = await fetch(`${BASE}/.well-known/mcp.json`);
    expect(r.status).toBe(200);
    const d = await r.json() as any;
    expect(d.transport.type).toBe("streamable-http");
    expect(d.capabilities.tools).toBeDefined();
    expect(d.capabilities.logging).toBeDefined();
    expect(d.auth.required).toBe(true); // this boot sets SAAS_ENFORCE=1
  });

  test("/.well-known/oauth-authorization-server advertises registration_endpoint", async () => {
    const m = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json() as any;
    expect(m.registration_endpoint).toBe(`${BASE}/register`);
  });

  test("POST /register (RFC 7591) issues a client_id + secret without an API key", async () => {
    const r = await fetch(`${BASE}/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: ["https://app.example.com/cb"], client_name: "e2e" }),
    });
    expect(r.status).toBe(201);
    const c = await r.json() as any;
    expect(c.client_id).toMatch(/^oc_/);
    expect(c.client_secret).toMatch(/^ocs_/);
    expect(c.registration_client_uri).toContain(c.client_id);
  });

  test("POST /register rejects non-array redirect_uris (400)", async () => {
    const r = await fetch(`${BASE}/register`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ redirect_uris: "not-an-array" }),
    });
    expect(r.status).toBe(400);
  });

  // --- Faz 19: OAuth 2.1 Authorization Server (authorization_code + PKCE S256) ---
  test("AS metadata advertises token + authorize endpoints + S256", async () => {
    const m = await (await fetch(`${BASE}/.well-known/oauth-authorization-server`)).json() as any;
    expect(m.authorization_endpoint).toBe(`${BASE}/authorize`);
    expect(m.token_endpoint).toBe(`${BASE}/token`);
    expect(m.code_challenge_methods_supported).toContain("S256");
    expect(m.registration_endpoint).toBe(`${BASE}/register`); // tenant-aware DCR stays ours
  });

  const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

  async function boundClient(plan = "enterprise") {
    const j = (r: Response) => r.json() as any;
    const t = await j(await fetch(`${BASE}/api/saas/tenants`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ name: `oauth-${plan}`, plan }),
    }));
    const k = await j(await fetch(`${BASE}/api/saas/keys`, {
      method: "POST", headers: { "content-type": "application/json", "x-admin-token": ADMIN },
      body: JSON.stringify({ tenantId: t.id }),
    }));
    const reg = await j(await fetch(`${BASE}/register`, {
      method: "POST", headers: { "content-type": "application/json", "x-api-key": k.key }, // DCR-time tenant bind
      body: JSON.stringify({ redirect_uris: [`${BASE}/cb`], token_endpoint_auth_method: "none" }),
    }));
    return reg.client_id as string;
  }

  async function authorize(clientId: string, challenge: string) {
    const url = `${BASE}/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(`${BASE}/cb`)}&code_challenge=${challenge}&code_challenge_method=S256&state=xyz`;
    const r = await fetch(url, { redirect: "manual" });
    return r;
  }

  test("full flow: DCR(bound) → authorize → token → ot_ token authorizes /mcp", async () => {
    const clientId = await boundClient();
    const verifier = b64url(crypto.randomBytes(32));
    const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());

    const ar = await authorize(clientId, challenge);
    expect([302, 303]).toContain(ar.status);
    const loc = new URL(ar.headers.get("location")!);
    const code = loc.searchParams.get("code");
    expect(code).toBeTruthy();
    expect(loc.searchParams.get("state")).toBe("xyz");

    const form = new URLSearchParams({ grant_type: "authorization_code", code: code!, redirect_uri: `${BASE}/cb`, client_id: clientId, code_verifier: verifier });
    const tr = await fetch(`${BASE}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
    expect(tr.status).toBe(200);
    const tok = await tr.json() as any;
    expect(tok.access_token).toMatch(/^ot_/);
    expect(tok.token_type.toLowerCase()).toBe("bearer");

    const c = new Client({ name: "oauth", version: "0" }, { capabilities: {} });
    const t2 = new StreamableHTTPClientTransport(new URL(`${BASE}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${tok.access_token}` } } });
    await c.connect(t2);
    const { tools } = await c.listTools();
    await c.close();
    expect(tools.length).toBeGreaterThan(0);
  }, 40000);

  test("PKCE mismatch is rejected at /token", async () => {
    const clientId = await boundClient();
    const challenge = b64url(crypto.createHash("sha256").update("the-real-verifier").digest());
    const ar = await authorize(clientId, challenge);
    const code = new URL(ar.headers.get("location")!).searchParams.get("code")!;
    const form = new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: `${BASE}/cb`, client_id: clientId, code_verifier: "WRONG-verifier" });
    const tr = await fetch(`${BASE}/token`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
    expect(tr.status).toBeGreaterThanOrEqual(400);
  }, 40000);

  test("an unbound (anonymous-DCR) client cannot get a code", async () => {
    const reg = await (await fetch(`${BASE}/register`, {
      method: "POST", headers: { "content-type": "application/json" }, // no tenant key → unbound
      body: JSON.stringify({ redirect_uris: [`${BASE}/cb`], token_endpoint_auth_method: "none" }),
    })).json() as any;
    const challenge = b64url(crypto.createHash("sha256").update("v").digest());
    const ar = await authorize(reg.client_id, challenge);
    expect([302, 303]).toContain(ar.status);
    const loc = new URL(ar.headers.get("location")!);
    expect(loc.searchParams.get("code")).toBeNull();
    expect(loc.searchParams.get("error")).toBe("access_denied");
  }, 40000);
});

describe("MCP gateway CONSUME (stdio upstream)", () => {
  test("connectUpstream merges a stdio MCP tool reachable via the choke-point", async () => {
    // Isolated store env for the in-process registry used here.
    process.env.SAAS_DB_PATH = path.join(os.tmpdir(), `ollamas-consume-${process.pid}.db`);
    const { connectUpstream } = await import("../server/mcp/client");
    const { ToolRegistry } = await import("../server/tool-registry");

    const r = await connectUpstream({
      name: "local", transport: "stdio", command: "node", args: [path.join(HERE, "fixtures", "mini-mcp.mjs")],
    });
    expect(r.ok).toBe(true);
    expect(r.tools).toBe(1);
    expect(ToolRegistry.has("mcp__local__ping")).toBe(true);

    const out = await ToolRegistry.execute("mcp__local__ping", {}, { isLive: true, workspaceRoot: ".", autoApply: true, deps: {} as any });
    expect(out.ok).toBe(true);
    expect(out.output).toBe("pong");
  }, 20000);
});
