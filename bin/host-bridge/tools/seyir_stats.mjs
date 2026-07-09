#!/usr/bin/env node
// @ts-check
// seyir_stats (scripts lane, v8) — read the structured seyir event stream and
// render an observability dashboard: counts, error-rate, p50/p95/p99 latency,
// per-tool breakdown, and an SLO burn-rate (error-budget). Exits 1 on SLO alert
// so it can gate CI / launchd checks.
//   node seyir_stats.mjs              -> terminal dashboard
//   node seyir_stats.mjs --json       -> machine-readable summary
//   node seyir_stats.mjs --window 3600000 --slo 0.99
//
// Read-only observer: it does NOT emit its own event (would pollute the stream
// it measures), so it bypasses bridge-client and prints directly.
import { createReadStream, existsSync } from "node:fs";
import { createInterface } from "node:readline";
import { summarize, sloCheck } from "../lib/stats.mjs";
import { eventsPath } from "../lib/events.mjs";

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const JSON_OUT = process.argv.includes("--json");
const WINDOW_MS = Number(arg("--window", 3600000));
const SLO = Number(arg("--slo", 0.99));

// Robust ndjson read (skip blank/partial lines).
async function readEvents(path) {
  if (!existsSync(path)) return [];
  const events = [];
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); } catch { /* skip malformed line */ }
  }
  return events;
}

const ms = (n) => `${Math.round(n)}ms`;
const pct = (n) => `${(n * 100).toFixed(2)}%`;

const events = await readEvents(eventsPath());
const s = summarize(events);
const slo = sloCheck(events, { target: SLO, windowMs: WINDOW_MS, now: Date.now() });

if (JSON_OUT) {
  console.log(JSON.stringify({ source: eventsPath(), summary: s, slo }, null, 2));
  process.exit(slo.alert ? 1 : 0);
}

console.log("──────────── seyir-defteri (scripts) ────────────");
console.log(`events     : ${s.total}`);
if (s.total) {
  console.log(`error-rate : ${pct(s.errorRate)} (${s.errors} err)`);
  console.log(`latency    : p50 ${ms(s.p50)} · p95 ${ms(s.p95)} · p99 ${ms(s.p99)} · avg ${ms(s.avg)}`);
  console.log("per-tool   :");
  for (const [tool, b] of Object.entries(s.byTool).sort((a, c) => c[1].count - a[1].count)) {
    console.log(`  ${tool.padEnd(16)} ${String(b.count).padStart(5)} runs  ${b.errors} err`);
  }
  console.log(`SLO (${pct(SLO)}) : sli ${pct(slo.sli)} · budget left ${pct(slo.errorBudgetRemaining)} · burn ${slo.burnRate.toFixed(2)}x` + (slo.alert ? "  ⚠️ ALERT" : ""));
} else {
  console.log("(no events yet — run some tools)");
}
console.log("─────────────────────────────────────────────────");
process.exit(slo.alert ? 1 : 0);
