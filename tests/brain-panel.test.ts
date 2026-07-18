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

  test("POST /api/brain/recall (S39) → ranked hits; missing query → 400", async () => {
    const res = await fetch(`${base}/api/brain/recall`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "panel test memory", k: 2, ns: "org" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.hits[0]?.id).toBe("t-1");
    const bad = await fetch(`${base}/api/brain/recall`, {
      method: "POST", headers: { "content-type": "application/json" }, body: "{}",
    });
    expect(bad.status).toBe(400);
  });

  test("cross-ns recall (S49) is double-locked: env flag off → 403; on+loopback → merged hits", async () => {
    const xns = (body: object) => fetch(`${base}/api/brain/recall`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    const denied = await xns({ query: "panel test memory", ns: "*" });
    expect(denied.status).toBe(403);
    process.env.BRAIN_ADMIN_XNS = "1";
    try {
      const res = await xns({ query: "panel test memory", ns: "*", k: 3 });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.crossNs).toBe(true);
      expect(body.hits.some((h: { ns: string }) => h.ns === "org")).toBe(true);
    } finally {
      delete process.env.BRAIN_ADMIN_XNS;
    }
  });

  test("GET /api/brain/facts (S40) + /api/brain/session/:id (S42)", async () => {
    const fr = await fetch(`${base}/api/brain/facts?subject=nothing-here`);
    expect(fr.status).toBe(200);
    expect((await fr.json()).facts).toEqual([]);
    const noSubject = await fetch(`${base}/api/brain/facts`);
    expect(noSubject.status).toBe(400);
    const sr = await fetch(`${base}/api/brain/session/some-session`);
    expect(sr.status).toBe(200);
    expect((await sr.json()).memories).toEqual([]);
  });

  test("GET /brain → 200 html panel wired to the brain APIs", async () => {
    const res = await fetch(`${base}/brain`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("BRAIN");
    expect(html).toContain("/api/brain/overview");
    expect(html).toContain("/api/brain/graph");
    // Panel v2: live search (recall), audit ledger and last-known-health surfaces.
    expect(html).toContain("/api/brain/recall");
    expect(html).toContain("/api/brain/audit");
    expect(html).toContain("Audit Ledger");
    expect(html).toContain("Canlı Arama");
    expect(html).toContain("abstention");
  });

  test("GET /api/brain/audit → 200 with append-only entries (B3 surface)", async () => {
    await fetch(`${base}/api/brain/remember`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "audit-probe", tier: "working", content: "audit probe row" }),
    });
    const res = await fetch(`${base}/api/brain/audit?limit=10`);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(Array.isArray(j.entries)).toBe(true);
    expect(j.entries.some((e: any) => e.action === "remember")).toBe(true);
  });

  test("POST /api/brain/forget → loopback purge with count (B4 surface)", async () => {
    const res = await fetch(`${base}/api/brain/forget`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contains: "audit probe row" }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).forgotten).toBeGreaterThanOrEqual(1);
  });
});
