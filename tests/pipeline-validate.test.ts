// M-004 (GAP-003) — /api/pipeline validate-order regression, enabled by the M-050
// boot-harness. The multi-agent pipeline switches the response to an SSE event-stream;
// once those headers are sent a bad request can no longer return a clean 4xx — it would
// stream `undefined`. So an empty/missing prompt MUST short-circuit to a 400 JSON BEFORE
// any `text/event-stream` header. Reverting that ordering makes these fail → regression guard.
//
// In-process HTTP against the REAL exported app (server.ts) — no fixed port, no boot of
// vite/store (OLLAMAS_NO_AUTOBOOT=1). The route is registered at module top-level (M-050)
// so it is reachable without booting the full stack. Same technique as routes-hardening.test.ts.
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

const postJson = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("M-004 /api/pipeline — validate before switching to SSE", () => {
  test("missing prompt → 400 JSON, not an event-stream", async () => {
    const res = await fetch(base + "/api/pipeline", postJson({}));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type") || "").not.toContain("text/event-stream");
    const body = await res.json();
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  test("empty-string prompt → 400 JSON", async () => {
    const res = await fetch(base + "/api/pipeline", postJson({ prompt: "" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type") || "").not.toContain("text/event-stream");
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  test("whitespace-only prompt → 400 JSON", async () => {
    const res = await fetch(base + "/api/pipeline", postJson({ prompt: "   \n\t" }));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type") || "").not.toContain("text/event-stream");
  });

  test("non-string prompt → 400 JSON", async () => {
    const res = await fetch(base + "/api/pipeline", postJson({ prompt: 42 }));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type") || "").not.toContain("text/event-stream");
  });
});
