#!/usr/bin/env node
// model_select (scripts lane, v17) — recommend the most efficient LOCAL model from
// the cached benchmark (~/.llm-mission-control/benchmark.json), without re-running
// the slow bench. Correct-first, then metric (tps|latency) + optional min-tok/s.
// Host-operator tool (reads host-local benchmark.json), read-only — emits no event
// of its own (seyir_stats pattern), not tenant-exposed.
//   node model_select.mjs                  -> terminal recommendation (latency)
//   node model_select.mjs --json           -> machine-readable {model,reason,ranked}
//   node model_select.mjs --metric tps --min-tps 50
import { readFileSync, existsSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { pickModel } from "../lib/model-select.mjs";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const JSON_OUT = process.argv.includes("--json");
const METRIC = arg("--metric", "latency") === "tps" ? "tps" : "latency";
const MIN_TPS = Number(arg("--min-tps", 0)) || 0;
const BENCH = join(os.homedir(), ".llm-mission-control", "benchmark.json");

if (!existsSync(BENCH)) {
  const msg = { ok: false, error: `no benchmark.json at ${BENCH} — run benchmark.mjs first` };
  console.log(JSON.stringify(msg, null, 2));
  process.exit(1);
}

let report = {};
try { report = JSON.parse(readFileSync(BENCH, "utf8")); } catch { report = {}; }
const results = Array.isArray(report.results) ? report.results : [];
const pick = pickModel(results, { metric: METRIC, minTokS: MIN_TPS });

if (JSON_OUT) {
  console.log(JSON.stringify({ ok: pick.model != null, source: BENCH, metric: METRIC, recommend: pick.model, reason: pick.reason, ranked: pick.ranked }, null, 2));
  process.exit(pick.model ? 0 : 1);
}

console.log("──────────── model-select (scripts) ────────────");
console.log(`source     : ${BENCH}`);
console.log(`metric     : ${METRIC}${MIN_TPS ? ` (min ${MIN_TPS} tok/s)` : ""}`);
console.log(`recommend  : ${pick.model ?? "(none)"}`);
console.log(`reason     : ${pick.reason}`);
if (pick.ranked.length) {
  console.log("ranked     :");
  pick.ranked.slice(0, 6).forEach((r, i) =>
    console.log(`  ${i + 1}. ${String(r.model).padEnd(24)} ${r.correct ? "✓" : "✗"} ${r.tok_s != null ? r.tok_s + " tok/s" : "-"} ${r.total_ms != null ? r.total_ms + "ms" : ""}`));
}
console.log("─────────────────────────────────────────────────");
process.exit(pick.model ? 0 : 1);
