// µ1 — OpenAPI coverage for kept routes (route-triage.md v1.27.3: KEEP-PUBLIC + PRIVILEGED-KEEP).
// The gateway serves its own spec at /api/openapi.json (→ /api/docs Swagger UI). This asserts the
// routes we documented in this drop actually appear in the SERVED spec, and that the doc surface is
// reachable — via in-process HTTP against the real exported app (no port fixed, no vite/store boot,
// OLLAMAS_NO_AUTOBOOT=1). Same technique supertest uses internally (http.createServer + listen(0)).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";

let server: Server;
let base = "";
let spec: any;

beforeAll(async () => {
  process.env.OLLAMAS_NO_AUTOBOOT = "1";
  const { app } = await import("../server");
  server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
  const res = await fetch(base + "/api/openapi.json");
  expect(res.status).toBe(200);
  spec = await res.json();
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

// [path, method] pairs newly documented in v1.27.4 µ1.
const PUBLIC_ROUTES: Array<[string, string]> = [
  ["/.well-known/mcp.json", "get"],
  ["/api/openapi.json", "get"],
  ["/api/docs", "get"],
  ["/api/ai/models", "get"],
  ["/api/ai/transcribe", "post"],
];
const PRIVILEGED_ROUTES: Array<[string, string]> = [
  ["/api/saas/self/keys/{id}/revoke", "post"],
  ["/api/saas/upstreams/status", "get"],
  ["/api/saas/webhooks/deliveries", "get"],
];

// v1.29.4 — newly documented local-owner facade routes (no ApiKey: loopback owner surface,
// 403 only under SAAS_ENFORCE=1). Grown one batch at a time.
const LOCAL_OWNER_ROUTES: Array<[string, string]> = [
  // batch1 — inference facade
  ["/api/generate", "post"],
  ["/api/ai/generate", "post"],
  ["/api/models/{provider}", "get"],
  ["/api/orchestra", "get"],
  ["/api/pipeline", "post"],
  // batch2 — ReAct agent chat + session lifecycle
  ["/api/agent/chat", "post"],
  ["/api/agent/sessions", "get"],
  ["/api/agent/sessions", "post"],
  ["/api/agent/sessions/{id}", "get"],
  ["/api/agent/sessions/{id}", "delete"],
  ["/api/agent/sessions/{id}/events", "get"],
];
// v1.29.4 — newly documented tenant-authenticated routes (ApiKey + 401 contract).
const TENANT_AUTH_ROUTES: Array<[string, string]> = [
];

describe("OpenAPI — kept routes are documented in the served spec", () => {
  test("/api/openapi.json is a well-formed OpenAPI 3.1 document", () => {
    expect(spec.openapi).toMatch(/^3\.1/);
    expect(spec.paths).toBeTruthy();
  });

  test("KEEP-PUBLIC routes appear with the right method + a summary", () => {
    for (const [p, m] of PUBLIC_ROUTES) {
      const op = spec.paths?.[p]?.[m];
      expect(op, `${m.toUpperCase()} ${p} missing from openapi.json`).toBeTruthy();
      expect(typeof op.summary).toBe("string");
      expect(op.summary.length).toBeGreaterThan(0);
    }
  });

  test("PRIVILEGED routes appear AND declare the ApiKey auth (401 contract)", () => {
    for (const [p, m] of PRIVILEGED_ROUTES) {
      const op = spec.paths?.[p]?.[m];
      expect(op, `${m.toUpperCase()} ${p} missing from openapi.json`).toBeTruthy();
      expect(op.security, `${m.toUpperCase()} ${p} must declare security`).toBeTruthy();
      const usesApiKey = op.security.some((s: Record<string, unknown>) => "ApiKey" in s);
      expect(usesApiKey, `${m.toUpperCase()} ${p} must require ApiKey`).toBe(true);
      expect(op.responses?.["401"], `${m.toUpperCase()} ${p} must document 401`).toBeTruthy();
    }
  });

  test("v1.29.4 local-owner facade routes appear with the right method + a summary", () => {
    for (const [p, m] of LOCAL_OWNER_ROUTES) {
      const op = spec.paths?.[p]?.[m];
      expect(op, `${m.toUpperCase()} ${p} missing from openapi.json`).toBeTruthy();
      expect(typeof op.summary).toBe("string");
      expect(op.summary.length).toBeGreaterThan(0);
    }
  });

  test("v1.29.4 tenant-authenticated routes appear AND declare ApiKey + 401", () => {
    for (const [p, m] of TENANT_AUTH_ROUTES) {
      const op = spec.paths?.[p]?.[m];
      expect(op, `${m.toUpperCase()} ${p} missing from openapi.json`).toBeTruthy();
      expect(op.security, `${m.toUpperCase()} ${p} must declare security`).toBeTruthy();
      const usesApiKey = op.security.some((s: Record<string, unknown>) => "ApiKey" in s);
      expect(usesApiKey, `${m.toUpperCase()} ${p} must require ApiKey`).toBe(true);
      expect(op.responses?.["401"], `${m.toUpperCase()} ${p} must document 401`).toBeTruthy();
    }
  });

  test("Swagger UI (/api/docs) is reachable — 200 HTML", async () => {
    const res = await fetch(base + "/api/docs/", { redirect: "follow" });
    expect(res.status).toBe(200);
    expect((res.headers.get("content-type") || "")).toMatch(/html/);
  });
});
