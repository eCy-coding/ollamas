// µ2 — T4 route hardening (TDD). Kept routes (route-triage.md, v1.27.3) whose error path
// returned a bare human string get a stable machine-readable `code` so the frontend can branch
// on the failure kind. Malformed input MUST short-circuit to a structured `{ error, code }` with
// a 4xx status — deterministically, before any network fetch. Reverting the hardening (dropping
// `code`) makes these fail → regression guard.
//
// In-process HTTP against the REAL exported app (server.ts) — no port fixed, no boot of vite/store
// (OLLAMAS_NO_AUTOBOOT=1). Same technique supertest uses under the hood (http.createServer + :0).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";

let server: Server;
let base = "";

beforeAll(async () => {
  process.env.OLLAMAS_NO_AUTOBOOT = "1";
  const { app } = await import("../server");
  server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

async function call(pathAndQuery: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(base + pathAndQuery, init);
  return { status: res.status, body: await res.json() };
}

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("T4 route hardening — structured { error, code } on malformed input", () => {
  test("GET /api/github/search without q → 400 { error, code: MISSING_QUERY }", async () => {
    const { status, body } = await call("/api/github/search");
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
    expect(body.code).toBe("MISSING_QUERY");
  });

  test("GET /api/github/actions/runs without repo → 400 { error, code: INVALID_REPO }", async () => {
    const { status, body } = await call("/api/github/actions/runs");
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
    expect(body.code).toBe("INVALID_REPO");
  });

  test("POST /api/github/actions/dispatch with no repo → 400 { error, code: INVALID_REPO }", async () => {
    const { status, body } = await call("/api/github/actions/dispatch", postJson({}));
    expect(status).toBe(400);
    expect(typeof body.error).toBe("string");
    expect(body.code).toBe("INVALID_REPO");
  });
});
