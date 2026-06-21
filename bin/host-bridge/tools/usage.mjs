#!/usr/bin/env node
// usage (scripts lane, v11) — Scripts-as-SaaS metering dashboard over the host
// seyir event stream: per-tool call counts, tier-weighted billable units, est.
// cost, and a budget gate. HOST-LOCAL cost telemetry only (tenant billing is the
// integrations lane via server execute()→store→Stripe; host events carry no
// tenant, so no double-count). Read-only observer: emits no event of its own
// (would pollute the stream it measures), like seyir_stats.
//   node usage.mjs                      -> terminal report (all time)
//   node usage.mjs --json               -> machine-readable meter
//   node usage.mjs --month 2026-06 --rate 0.01 --budget 5   -> period + budget gate (exit 1 over budget)
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { meter, filterPeriod } from "../lib/metering.mjs";
import { eventsPath } from "../lib/events.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const INVENTORY = join(HERE, "..", "..", "..", "scripts", "inventory.json");

function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : def;
}
const JSON_OUT = process.argv.includes("--json");
const MONTH = arg("--month", null);
const RATE = Number(arg("--rate", 0));
const BUDGET = process.argv.includes("--budget") ? Number(arg("--budget", 0)) : null;

// tool -> tier map from the manifest (single source of truth).
function toolTierMap() {
  try {
    const inv = JSON.parse(readFileSync(INVENTORY, "utf8"));
    return Object.fromEntries((inv.tools || []).map((t) => [t.name, t.tier]));
  } catch {
    return {};
  }
}

async function readEvents(path) {
  if (!existsSync(path)) return [];
  const events = [];
  const rl = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try { events.push(JSON.parse(t)); } catch { /* skip malformed */ }
  }
  return events;
}

const all = await readEvents(eventsPath());
const events = filterPeriod(all, MONTH);
const m = meter(events, { toolTier: toolTierMap(), rate: RATE, budget: BUDGET, period: MONTH });

if (JSON_OUT) {
  console.log(JSON.stringify({ source: eventsPath(), meter: m }, null, 2));
  process.exit(m.overBudget ? 1 : 0);
}

const money = (n) => `$${Number(n).toFixed(2)}`;
console.log("──────────── usage / metering (scripts) ────────────");
console.log(`period     : ${MONTH || "all-time"}   rate ${money(RATE)}/unit`);
console.log(`calls      : ${m.totals.calls}   errors ${m.totals.errors}`);
console.log(`units      : ${m.totals.billableUnits}   est. cost ${money(m.totals.estCost)}`);
if (m.totals.calls) {
  console.log("per-tool   :");
  for (const [tool, b] of Object.entries(m.byTool).sort((a, c) => c[1].billableUnits - a[1].billableUnits)) {
    console.log(`  ${tool.padEnd(16)} ${String(b.count).padStart(5)} calls  ${b.tier.padEnd(10)} ${String(b.billableUnits).padStart(5)} units  ${money(b.estCost)}`);
  }
}
if (BUDGET != null) {
  console.log(`budget     : ${money(BUDGET)} → ${m.overBudget ? "⚠️ OVER BUDGET" : "ok"}`);
}
console.log("────────────────────────────────────────────────────");
process.exit(m.overBudget ? 1 : 0);
