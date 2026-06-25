#!/usr/bin/env node
// ops — the single coordinated entry point (Tier-1 conductor) tying the whole
// 3-tier system together into ONE e2e command: fastest, safest, most correct.
//
//   Tier 1  Claude Code / this conductor — decides, cross-checks, reports
//     └─ Tier 2  agent-fleet.mjs (ollamas-claude lead)  [only when needed]
//          └─ Tier 3  agent-dispatch.mjs sub-agents (workers)
//
// FAST   : deterministic system-monitor runs FIRST (~3s, no LLM). "Silence = Success"
//          — when everything passes, NO model is ever called.
// SAFE   : the deterministic monitor is the ground-truth gate; LLM workers only run on
//          a real failure, and their claims are cross-checked back against it.
// CORRECT: every escalated worker finding must match ground-truth evidence (hallucination
//          is caught and flagged).
//
// Usage:
//   node scripts/ops.mjs           # fast path: monitor → escalate to fleet only on FAIL
//   node scripts/ops.mjs --deep    # always run the fleet (continuous-inspection mode)
//   node scripts/ops.mjs --json    # machine-readable
//
// Exit 0 = healthy (or escalation resolved with all-pass workers); 1 = unresolved problem.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
const pexec = promisify(execFile);

const REPO = "/Users/emrecnyngmail.com/Desktop/ollamas";
const DEEP = process.argv.includes("--deep");
const JSON_OUT = process.argv.includes("--json");
const node = process.execPath;

async function run(script, args = []) {
  try { const r = await pexec(node, [`scripts/${script}`, ...args], { cwd: REPO, timeout: 180000, maxBuffer: 8 * 1024 * 1024 });
    return { code: 0, out: r.stdout }; }
  catch (e) { return { code: e.code ?? 1, out: (e.stdout || "") + (e.stderr || "") }; }
}

// --- Tier-1 step 1: deterministic ground truth (FAST, no LLM) + ledger (learning) ---
const mon = await run("system-monitor.mjs", ["--heartbeat", "--json"]).then(() => run("system-monitor.mjs", ["--json"]));
let monitor, monitorParseOk = true;
try { monitor = JSON.parse(mon.out); } catch { monitor = { summary: { pass: 0, fail: -1, skip: 0 }, results: [] }; monitorParseOk = false; }
const fails = (monitor.results || []).filter((r) => r.status === "FAIL");
// FAIL-CLOSED: an unparseable monitor (crashed/truncated) is NOT health — the ground-truth
// gate must not pass just because results[] defaulted to empty.
const healthy = monitorParseOk && fails.length === 0;

// --- Tier-1 step 2: escalate to the fleet only when needed (or forced with --deep) ---
let fleet = null, fleetParseOk = true;
if (!healthy || DEEP) {
  const f = await run("agent-fleet.mjs", ["--json"]);
  try { fleet = JSON.parse(f.out); } catch { fleet = { workers: [] }; fleetParseOk = false; }
  // Cross-check: a worker is trustworthy only if it reported verified evidence (pass).
  // (agent-fleet already gates pass on a ground-truth regex appearing in real tool output.)
}

const report = {
  ts: new Date().toISOString(),
  mode: DEEP ? "deep" : "fast",
  healthy,
  monitor: monitor.summary,
  failing: fails.map((f) => ({ name: f.name, sev: f.sev, detail: f.detail })),
  fleet: fleet ? { ran: true, workers: fleet.workers.map((w) => ({ slice: w.id, worker: `${w.provider}/${w.model}`, verified: w.pass, evidence: w.evidence })) } : { ran: false, reason: "healthy fast-path — no LLM needed" },
};
// FAIL-CLOSED: a fleet that ran but produced unparseable or empty output is NOT a pass
// (every() over an empty array is vacuously true → it used to pass open).
const fleetOk = !fleet || (fleetParseOk && fleet.workers.length > 0 && fleet.workers.every((w) => w.pass));
const exit = healthy ? (fleetOk ? 0 : 1) : 1;

if (JSON_OUT) { console.log(JSON.stringify({ ...report, exit }, null, 2)); process.exit(exit); }

console.log(`\n══ ops (Tier-1 conductor · mode=${report.mode}) ══`);
console.log(`  ground truth: ${report.monitor.pass} PASS · ${report.monitor.fail} FAIL · ${report.monitor.skip} SKIP`);
if (healthy && !DEEP) console.log(`  ✓ HEALTHY — fast path, no LLM called ("Silence = Success").`);
if (fails.length) { console.log(`  ✗ PROBLEMS:`); for (const f of fails) console.log(`      [${f.sev}] ${f.name}: ${f.detail}`); }
if (report.fleet.ran) {
  console.log(`  fleet (Tier-2 → ${report.fleet.workers.length} Tier-3 workers):`);
  for (const w of report.fleet.workers) console.log(`      ${w.verified ? "✓" : "✗"} ${w.slice.padEnd(14)} ${w.worker.padEnd(22)} ${String(w.evidence).replace(/\n/g, " ").slice(0, 60)}`);
  const ok = report.fleet.workers.filter((w) => w.verified).length;
  console.log(`      ${ok}/${report.fleet.workers.length} workers cross-checked against ground truth`);
}
console.log(`  VERDICT: ${exit === 0 ? "OK" : "ATTENTION NEEDED"}`);
process.exit(exit);
