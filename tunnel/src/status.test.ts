import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendDecision,
  readDecisions,
  renderStatusTable,
  sparkline,
  statusReport,
} from "./status.ts";
import type { DecisionRecord } from "./switch.ts";

function rec(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    ts: 1000,
    winner: "lan",
    switched: false,
    reason: "hold active lan (best)",
    scores: [
      { name: "lan", priority: 10, healthy: true, latencyMs: 20, breaker: "closed", score: 120 },
      { name: "mesh", priority: 20, healthy: true, latencyMs: 40, breaker: "closed", score: 240 },
    ],
    ...over,
  };
}

test("statusReport folds last decision + per-transport history", () => {
  const r = statusReport([rec({ ts: 1 }), rec({ ts: 2, winner: "mesh" })]);
  assert.equal(r.active, "mesh");
  assert.equal(r.ts, 2);
  assert.equal(r.transports.length, 2);
  assert.deepEqual(r.history.lan, [20, 20]); // two rounds
  assert.deepEqual(r.history.mesh, [40, 40]);
});

test("statusReport empty → no active, no throw", () => {
  const r = statusReport([], { now: 99 });
  assert.equal(r.active, null);
  assert.equal(r.ts, 99);
  assert.equal(r.transports.length, 0);
});

test("statusReport excludes non-finite latency from history", () => {
  const r = statusReport([
    rec({ scores: [{ name: "lan", priority: 10, healthy: false, latencyMs: Infinity, breaker: "open", score: Infinity }] }),
  ]);
  assert.equal(r.history.lan, undefined); // nothing finite to chart
});

test("sparkline: empty → '', equal → flat, ascending → rising", () => {
  assert.equal(sparkline([]), "");
  assert.equal(sparkline([5, 5, 5]), "▁▁▁");
  const s = sparkline([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(s.length, 8);
  assert.equal(s[0], "▁");
  assert.equal(s.at(-1), "█");
});

test("sparkline ignores non-finite samples", () => {
  assert.equal(sparkline([1, Infinity, 8]).length, 2);
});

test("renderStatusTable marks active + sorts by score; empty handled", () => {
  assert.match(renderStatusTable(statusReport([])), /no active transport/);
  const table = renderStatusTable(statusReport([rec()]));
  assert.match(table, /► lan/); // active marked
  assert.match(table, /active: lan/);
  const lanIdx = table.indexOf("lan");
  const meshIdx = table.indexOf("mesh");
  assert.ok(lanIdx < meshIdx); // better score (lan) first
});

test("status output is secret-free (only safe fields)", () => {
  const table = renderStatusTable(statusReport([rec()]));
  assert.doesNotMatch(table, /key|secret|preauth|PrivateKey/i);
});

test("appendDecision + readDecisions round-trip; bad lines skipped; limit honored", () => {
  const dir = mkdtempSync(join(tmpdir(), "tunnel-status-"));
  try {
    const p = join(dir, "decisions.jsonl");
    appendDecision(p, rec({ ts: 1 }));
    appendDecision(p, rec({ ts: 2 }));
    writeFileSync(p, `${readFileSync(p, "utf8")}{bad json line\n`); // corrupt trailing line
    appendDecision(p, rec({ ts: 3 }));
    const all = readDecisions(p);
    assert.deepEqual(all.map((d) => d.ts), [1, 2, 3]); // bad line skipped
    const last2 = readDecisions(p, { limit: 2 });
    assert.equal(last2.length, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("readDecisions on missing file → [] (graceful)", () => {
  assert.deepEqual(readDecisions("/nonexistent/path/decisions.jsonl"), []);
});

// ---------- vT14: gateway surface in status ----------
test("statusReport threads gateway through (pure passthrough)", () => {
  const r = statusReport([rec()], { gateway: { running: true, publicUrl: "https://x.trycloudflare.com" } });
  assert.deepEqual(r.gateway, { running: true, publicUrl: "https://x.trycloudflare.com" });
});

test("renderStatusTable shows public URL when gateway present", () => {
  const r = statusReport([rec()], { gateway: { running: true, publicUrl: "https://x.trycloudflare.com" } });
  assert.match(renderStatusTable(r), /public: https:\/\/x\.trycloudflare\.com/);
});

test("renderStatusTable shows gateway DOWN when running=false", () => {
  const r = statusReport([rec()], { gateway: { running: false, publicUrl: null } });
  assert.match(renderStatusTable(r), /gateway: DOWN/);
});

test("renderStatusTable omits gateway line when absent", () => {
  const r = statusReport([rec()]);
  assert.ok(!renderStatusTable(r).includes("gateway:"));
  assert.ok(!renderStatusTable(r).includes("public:"));
});
