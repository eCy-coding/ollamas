// ORG management-layer status surface (server/org-status.ts + /api/org/overview + /org panel).
// In-process HTTP against the REAL exported app (same technique as routes-hardening.test.ts):
// OLLAMAS_NO_AUTOBOOT=1 + http.createServer + :0. Plus unit coverage: orgOverview must be fully
// tolerant — missing/malformed sources never throw, they degrade to null/empty.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { orgOverview } from "../server/org-status";

describe("orgOverview (unit, tolerant)", () => {
  test("empty dirs → empty overview, no throw", () => {
    const dir = mkdtempSync(join(tmpdir(), "org-status-"));
    try {
      const o = orgOverview({ repoDir: dir, stateDir: dir });
      expect(o.actors).toEqual([]);
      expect(o.policyTrainedAt).toBeNull();
      expect(o.ledgerCounts.total).toBe(0);
      expect(o.sandboxVerdict).toBeNull();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("reads chart+policy+ledger+verdicts when present", () => {
    const dir = mkdtempSync(join(tmpdir(), "org-status-"));
    try {
      mkdirSync(join(dir, "orchestration"), { recursive: true });
      writeFileSync(join(dir, "orchestration", "ORG_CHART.json"), JSON.stringify({
        actors: [{ id: "conductor", kind: "model", role: "Conductor", costRank: 0 }],
      }));
      writeFileSync(join(dir, "orchestration", "ORG_POLICY.json"), JSON.stringify({
        trainedAt: "2026-07-18T00:00:00Z", samples: 9,
        authorities: { conductor: { level: "apply-gated", wilson: 0.7, n: 9, reason: "promoted" } },
      }));
      writeFileSync(join(dir, "orchestration", "SANDBOX-ORG.md"), "x\n**VERDICT: ALL GREEN ✅ (5-round clean streak = sustainability proof)**\ny\n");
      writeFileSync(join(dir, "brain-ledger.jsonl"),
        JSON.stringify({ ts: "t1", tier: "episodic", fact: "dispatch a" }) + "\n" +
        "not-json\n" +
        JSON.stringify({ ts: "t2", tier: "learned", fact: "lesson b" }) + "\n");
      const o = orgOverview({ repoDir: dir, stateDir: dir, recent: 10 });
      expect(o.actors[0]).toMatchObject({ id: "conductor", authority: "apply-gated", wilson: 0.7, n: 9 });
      expect(o.policySamples).toBe(9);
      expect(o.ledgerCounts).toEqual({ total: 2, episodic: 1, learned: 1 });
      expect(o.ledgerTail.map((r) => r.fact)).toEqual(["dispatch a", "lesson b"]);
      expect(o.sandboxVerdict).toContain("ALL GREEN");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("ORG routes (in-process app)", () => {
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

  test("GET /api/org/overview → 200 with actors + authorities shape", async () => {
    const res = await fetch(`${base}/api/org/overview?recent=5`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.actors)).toBe(true);
    expect(body.ledgerCounts).toHaveProperty("total");
    expect(body.actors.length).toBeGreaterThan(0); // real repo chart present
    expect(body.actors[0]).toHaveProperty("authority");
  });

  test("GET /org → 200 html panel", async () => {
    const res = await fetch(`${base}/org`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("ORG");
    expect(html).toContain("/api/org/overview");
  });
});
