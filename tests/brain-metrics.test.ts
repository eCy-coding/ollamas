// S21 brain-metrics: brain gauges must appear on the EXISTING /metrics scrape,
// sourced lazily (stats at scrape; self-hit from the last maintain-log line — the
// drift probe embeds, so it must never run at scrape time). In-process HTTP against
// the exported app (brain-panel.test.ts technique) with a tmp db + fake embedder.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http, { type Server } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseLastMaintain } from "../server/brain-metrics";

const MAINTAIN_LOG = [
  "shell-init: error retrieving current directory: getcwd", // launchd noise
  "(node:1) ExperimentalWarning: SQLite is an experimental feature",
  '{"event":"brain.backup","memories":10,"facts":2}',
  '{"event":"brain.maintain","selfHitRate":0.5,"exitCode":3,"drift":true}',
  "{broken json",
  '{"event":"brain.maintain","selfHitRate":1,"exitCode":0,"drift":false}',
].join("\n");

describe("parseLastMaintain (pure)", () => {
  test("last brain.maintain line wins; noise and bad JSON are skipped", () => {
    expect(parseLastMaintain(MAINTAIN_LOG)).toEqual({ selfHitRate: 1, exitCode: 0 });
  });
  test("empty / maintain-free log → nulls", () => {
    expect(parseLastMaintain("")).toEqual({ selfHitRate: null, exitCode: null });
    expect(parseLastMaintain('{"event":"brain.backup"}')).toEqual({ selfHitRate: null, exitCode: null });
  });
  test("non-numeric fields → nulls (no NaN gauges)", () => {
    expect(parseLastMaintain('{"event":"brain.maintain","selfHitRate":"x"}')).toEqual({
      selfHitRate: null,
      exitCode: null,
    });
  });
});

describe("brain gauges on /metrics (in-process app)", () => {
  let server: Server;
  let base = "";
  let dir: string;

  beforeAll(async () => {
    process.env.OLLAMAS_NO_AUTOBOOT = "1";
    dir = mkdtempSync(join(tmpdir(), "brain-metrics-"));
    process.env.BRAIN_DB_PATH = join(dir, "brain.db");
    process.env.BRAIN_EMBED_FAKE = "1";
    process.env.BRAIN_MAINTAIN_LOG = join(dir, "maintain.log");
    writeFileSync(process.env.BRAIN_MAINTAIN_LOG, MAINTAIN_LOG);
    const { app } = await import("../server");
    server = http.createServer(app as unknown as http.RequestListener);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    // Seed real rows through the public choke-point so tier/fact gauges have data.
    for (const [id, tier] of [["m1", "episodic"], ["m2", "episodic"], ["m3", "learned"]] as const) {
      const res = await fetch(`${base}/api/brain/remember`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, tier, content: `metrics seed ${id}` }),
      });
      expect(res.status).toBe(200);
    }
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    delete process.env.BRAIN_DB_PATH;
    delete process.env.BRAIN_EMBED_FAKE;
    delete process.env.BRAIN_MAINTAIN_LOG;
    rmSync(dir, { recursive: true, force: true });
  });

  test("scrape exposes tier counts, fact status, db size, maintain health", async () => {
    const res = await fetch(`${base}/metrics`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toMatch(/ollamas_brain_memories\{tier="episodic"\} 2/);
    expect(body).toMatch(/ollamas_brain_memories\{tier="learned"\} 1/);
    expect(body).toMatch(/ollamas_brain_facts\{status="live"\} 0/);
    expect(body).toMatch(/ollamas_brain_db_bytes \d+/);
    expect(body).toMatch(/ollamas_brain_self_hit_rate 1/);
    expect(body).toMatch(/ollamas_brain_last_maintain_exit 0/);
  });

  // 30s budget: under the fully-parallel gate this file shares the machine with
  // ~330 suites — recall+scrape exceeded the 5s default on a loaded box (observed
  // 5.3s), which is load, not a hang.
  test("recall latency histogram fills through the brainRecall choke-point", async () => {
    const { brainRecall } = await import("../server/brain");
    await brainRecall("metrics seed", { k: 2 });
    const body = await (await fetch(`${base}/metrics`)).text();
    expect(body).toMatch(/ollamas_brain_recall_ms_count [1-9]/);
  }, 30_000);
});
