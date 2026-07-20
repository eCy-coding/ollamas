// G7 — brain-loop.ts is a separate `tsx` process each launchd tick, so it can never see
// this server's in-process llmActive() by importing it directly (fresh module copy every
// tick, always idle). It polls this route instead. Driven against the real exported app
// (health-master-key.test.ts pattern) — proves the route actually exists and answers,
// not just that gpu-coordinator's own unit works.
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

describe("GET /api/brain/gpu-status (G7)", () => {
  test("answers 200 with a boolean active flag", async () => {
    const res = await fetch(base + "/api/brain/gpu-status");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.active).toBe("boolean");
  });

  test("idle in a fresh test process — no generation has run", async () => {
    const res = await fetch(base + "/api/brain/gpu-status");
    const body = await res.json();
    expect(body.active).toBe(false);
  });
});
