// BRAIN surface (G3): module-top-level routes — the /org lesson says panel/API routes
// inside initializeServer are dead to OLLAMAS_NO_AUTOBOOT in-process tests. Real HTTP
// against the exported app (org-status.test.ts technique); brain store isolated to a
// tmp db with the deterministic fake embedder.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http, { type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let server: Server;
let base = "";
let dir: string;

beforeAll(async () => {
  process.env.OLLAMAS_NO_AUTOBOOT = "1";
  dir = mkdtempSync(join(tmpdir(), "brain-panel-"));
  process.env.BRAIN_DB_PATH = join(dir, "brain.db");
  process.env.BRAIN_EMBED_FAKE = "1";
  const { app } = await import("../server");
  server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  delete process.env.BRAIN_DB_PATH;
  delete process.env.BRAIN_EMBED_FAKE;
  rmSync(dir, { recursive: true, force: true });
});

describe("BRAIN routes (in-process app)", () => {
  test("POST /api/brain/remember → 200, explicit id upsert; bad tier → 400", async () => {
    const res = await fetch(`${base}/api/brain/remember`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "t-1", tier: "episodic", content: "panel test memory", ns: "org", createdAt: 1784300000000 }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("t-1");
    const bad = await fetch(`${base}/api/brain/remember`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier: "nope", content: "x" }),
    });
    expect(bad.status).toBe(400);
  });

  test("GET /api/brain/overview + /graph → 200 with expected shape", async () => {
    const o = await (await fetch(`${base}/api/brain/overview?recent=5`)).json();
    expect(o.stats.memories).toHaveProperty("episodic");
    expect(o.health).toHaveProperty("selfHitRate");
    const g = await (await fetch(`${base}/api/brain/graph?limit=10`)).json();
    expect(Array.isArray(g.nodes)).toBe(true);
    expect(Array.isArray(g.edges)).toBe(true);
  });

  test("GET /brain → 200 html panel wired to the brain APIs", async () => {
    const res = await fetch(`${base}/brain`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("BRAIN");
    expect(html).toContain("/api/brain/overview");
    expect(html).toContain("/api/brain/graph");
  });
});
