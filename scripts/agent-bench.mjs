#!/usr/bin/env node
// agent-bench — benchmark local ollama models on system-monitoring/coding task classes,
// so each agent can be ROUTED to the job it actually passes. Scoring is objective: the
// ground-truth string MUST appear in a REAL tool-step output (not the model's prose), so
// a confident-but-wrong model cannot pass. Prints a routing table + per-class winner.
//
// Usage: node scripts/agent-bench.mjs [--models qwen3:8b,qwen3:4b,qwen3-coder:30b] [--steps 6]
// Env:   OLLAMAS_TIMEOUT_MS (per-run, default 200000), OLLAMAS_URL.

import { execFileSync } from "node:child_process";

const opt = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const REPO = "/Users/emrecnyngmail.com/Desktop/ollamas";
const MODELS = opt("--models", "qwen3:8b,qwen3:4b,qwen3-coder:30b").split(",").map((s) => s.trim()).filter(Boolean);
const STEPS = opt("--steps", "6");
const SCRATCH = `${process.env.HOME}/.llm-mission-control/agent-work/bench`;

// Each task: ground-truth `expect` regex that must appear in a real tool-step output.
const TASKS = [
  { id: "code.sum",     desc: "write+run sum 1..100",        expect: /\b5050\b/,
    prompt: `Write ${SCRATCH}/sumto.js with write_host_file: a Node program that sums 1..100 and prints ONLY the number. Then macos_terminal target=iterm2 run: node ${SCRATCH}/sumto.js and show stdout. Stop.` },
  { id: "code.fact",    desc: "write+run factorial(5)",      expect: /\b120\b/,
    prompt: `Write ${SCRATCH}/fact.js with write_host_file: a Node program that prints factorial of 5 (only the number). Then macos_terminal target=iterm2 run: node ${SCRATCH}/fact.js and show stdout. Stop.` },
  { id: "monitor.run",  desc: "run system-monitor, report",  expect: /SUMMARY:.*PASS/,
    prompt: `Use macos_terminal target=iterm2 to run exactly: cd ${REPO} && node scripts/system-monitor.mjs . Read the output and report the final SUMMARY line verbatim. Stop. Do not write any file.` },
];

const runOne = (model, task) => {
  const t0 = Date.now();
  let out = "";
  try {
    out = execFileSync("node", ["scripts/agent-dispatch.mjs", task.prompt,
      "--provider", "ollama-local", "--model", model, "--steps", STEPS, "--root", SCRATCH, "--json"],
      { cwd: REPO, encoding: "utf8", timeout: Number(process.env.OLLAMAS_TIMEOUT_MS || 200000), stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) { out = e.stdout || ""; } // dispatch exits 1 on non-allOk; still capture report
  const ms = Date.now() - t0;
  let rep; try { rep = JSON.parse(out); } catch { rep = { steps: [] }; }
  const blob = (rep.steps || []).map((s) => String(s.out || "")).join("\n");
  const pass = task.expect.test(blob);
  const demo = !!rep.demoSuspected;
  return { pass, demo, ms, steps: (rep.steps || []).length, verdict: rep.verdict };
};

const grid = {}; // model -> task.id -> result
for (const model of MODELS) {
  grid[model] = {};
  for (const task of TASKS) {
    process.stderr.write(`  bench: ${model} / ${task.id} ...\n`);
    grid[model][task.id] = runOne(model, task);
  }
}

// Routing table
const pad = (s, n) => String(s).padEnd(n);
console.log(`\n── agent-bench routing table ──  (✓=correct real output · ✗=wrong/none · D=demo)`);
console.log(`  ${pad("model", 20)}${TASKS.map((t) => pad(t.id, 16)).join("")}score`);
for (const model of MODELS) {
  let score = 0;
  const cells = TASKS.map((t) => { const r = grid[model][t.id]; if (r.pass) score++; const mark = r.pass ? "✓" : (r.demo ? "D" : "✗"); return pad(`${mark} ${(r.ms / 1000).toFixed(0)}s`, 16); });
  console.log(`  ${pad(model, 20)}${cells.join("")}${score}/${TASKS.length}`);
}
// Per-class winner = fastest correct
console.log(`\n  per-class winner (fastest correct):`);
for (const task of TASKS) {
  const winners = MODELS.map((m) => ({ m, ...grid[m][task.id] })).filter((r) => r.pass).sort((a, b) => a.ms - b.ms);
  console.log(`    ${pad(task.id, 16)} ${task.desc.padEnd(28)} -> ${winners.length ? `${winners[0].m} (${(winners[0].ms / 1000).toFixed(0)}s)` : "NONE PASSED"}`);
}
// Overall monitor-agent recommendation = best on monitor.run, tiebreak by total score
const monWinners = MODELS.map((m) => ({ m, mon: grid[m]["monitor.run"], total: TASKS.filter((t) => grid[m][t.id].pass).length }))
  .filter((r) => r.mon.pass).sort((a, b) => (b.total - a.total) || (a.mon.ms - b.mon.ms));
console.log(`\n  RECOMMENDED monitor-agent: ${monWinners.length ? `${monWinners[0].m} (passed monitor.run in ${(monWinners[0].mon.ms / 1000).toFixed(0)}s, total ${monWinners[0].total}/${TASKS.length})` : "none passed monitor.run — fall back to deterministic scripts/system-monitor.mjs"}`);
