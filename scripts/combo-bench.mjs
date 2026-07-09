#!/usr/bin/env node
// @ts-check
// combo-bench — measure which MULTI-MODEL COMBINATION maximizes correct-answer rate.
//
// agent-bench's 3 tasks saturate (every strong model 3/3) so they can't differentiate
// combinations. This uses a HARDER set (subtle bugs: precision, float, order, boundary)
// that produces a correctness SPREAD, then compares combination policies:
//   - single(model)     : one model's answer
//   - best-of-N (union) : correct if ANY model in the pool is correct (ensemble ceiling)
//   - majority-vote     : correct if a MAJORITY of the pool is correct (proxy: wrong
//                         answers are diverse, so a correct majority ⇒ the modal answer
//                         is the correct one — the realistic selectable policy)
//
// EFFICIENT: each (model,task) is dispatched ONCE (real ReAct, ground-truth on real
// tool output, demo rejected); every combination is computed from that cache. So the
// cost is |models|*|tasks| dispatches, not per-combination.
//
// Usage: node scripts/combo-bench.mjs [--models a,b,c] [--steps 6] [--json]
// Env:   OLLAMAS_URL (default :8090), OLLAMAS_TIMEOUT_MS (default 300000).

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = "/Users/emrecnyngmail.com/Desktop/ollamas";
const SCRATCH = `${process.env.HOME}/.llm-mission-control/agent-work/combo`;
const opt = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const JSON_OUT = process.argv.includes("--json");
const STEPS = opt("--steps", "6");
const TIMEOUT = Number(process.env.OLLAMAS_TIMEOUT_MS || "300000");
// Cloud-first pool: cloud models cost no local RAM (host is RAM-bound) and one is a
// known-weaker control (gpt-oss) to guarantee a correctness spread.
const POOL = opt("--models", "qwen3-coder:480b-cloud,qwen3:8b,gpt-oss:120b-cloud")
  .split(",").map((s) => s.trim()).filter(Boolean);

// Each task: write+run a program that prints ONLY the answer; correct iff the exact
// answer string appears in a real tool-step output. Chosen so weak models fail some.
const TASKS = [
  { id: "overflow.fib", answer: "12586269025",
    prompt: `Write ${SCRATCH}/fib.js: compute Fibonacci where fib(0)=0, fib(1)=1, and print ONLY fib(50) as a single integer with NO other text. Use an iterative loop with BigInt or numbers that stay exact. Then macos_terminal target=iterm2 run: node ${SCRATCH}/fib.js and show the exact stdout. Stop.` },
  { id: "float.round", answer: "0.30",
    prompt: `Write ${SCRATCH}/round.js: print ONLY the value of (0.1 + 0.2) rounded to exactly 2 decimal places, formatted as 0.30 (two decimals). No other text. Then macos_terminal target=iterm2 run: node ${SCRATCH}/round.js and show the exact stdout. Stop.` },
  { id: "dedupe.order", answer: "3,1,2",
    prompt: `Write ${SCRATCH}/dedupe.js: from the array [3,1,3,2,1], remove duplicates KEEPING first-seen order, then print ONLY the result comma-joined with no spaces (expected exactly: 3,1,2). No other text. Then macos_terminal target=iterm2 run: node ${SCRATCH}/dedupe.js and show the exact stdout. Stop.` },
  { id: "binsearch.miss", answer: "-1",
    prompt: `Write ${SCRATCH}/bs.js: binary-search for the value 7 in the sorted array [1,2,3,4,5]; it is absent so print ONLY -1 (it must not crash or throw). No other text. Then macos_terminal target=iterm2 run: node ${SCRATCH}/bs.js and show the exact stdout. Stop.` },
];

function dispatch(model, prompt) {
  const t0 = Date.now();
  let out = "";
  try {
    out = execFileSync("node", ["scripts/agent-dispatch.mjs", prompt,
      "--provider", "ollama-local", "--model", model, "--steps", STEPS, "--root", SCRATCH, "--json"],
      { cwd: REPO, encoding: "utf8", timeout: TIMEOUT, stdio: ["ignore", "pipe", "ignore"] });
  } catch (e) { out = e.stdout || ""; }
  let rep; try { rep = JSON.parse(out); } catch { rep = { steps: [] }; }
  const blob = (rep.steps || []).map((s) => String(s.out || "")).join("\n");
  return { ms: Date.now() - t0, demo: !!rep.demoSuspected, blob };
}

// dispatch each (model,task) ONCE → cache {correct, ms, demo}
const cache = {}; // model -> task.id -> {correct, ms, demo}
for (const model of POOL) {
  cache[model] = {};
  for (const t of TASKS) {
    process.stderr.write(`  combo: ${model} / ${t.id} ...\n`);
    const r = dispatch(model, t.prompt);
    cache[model][t.id] = { correct: r.blob.includes(t.answer), ms: r.ms, demo: r.demo };
  }
}

const N = POOL.length;
const need = Math.floor(N / 2) + 1; // majority
const rate = (fn) => TASKS.filter(fn).length / TASKS.length;
const correctCount = (t) => POOL.filter((m) => cache[m][t.id].correct).length;
const sumMs = (models, t) => models.reduce((a, m) => a + cache[m][t.id].ms, 0);

// per-combination rate + cost (calls) + latency (total ms across the set)
const combos = [];
for (const m of POOL) {
  combos.push({ policy: `single:${m}`, kind: "single", models: [m],
    rate: rate((t) => cache[m][t.id].correct), calls: TASKS.length,
    ms: TASKS.reduce((a, t) => a + cache[m][t.id].ms, 0) });
}
combos.push({ policy: "best-of-N (union)", kind: "bestOfN", models: POOL,
  rate: rate((t) => correctCount(t) >= 1), calls: N * TASKS.length,
  ms: TASKS.reduce((a, t) => a + sumMs(POOL, t), 0) });
combos.push({ policy: "majority-vote", kind: "vote", models: POOL,
  rate: rate((t) => correctCount(t) >= need), calls: N * TASKS.length,
  ms: TASKS.reduce((a, t) => a + sumMs(POOL, t), 0) });

// winner: highest rate, tie-break fewest calls then lowest latency (optimize.ts rule)
const winner = [...combos].sort((a, b) => (b.rate - a.rate) || (a.calls - b.calls) || (a.ms - b.ms))[0];

const result = {
  ts: new Date().toISOString(), pool: POOL, tasks: TASKS.map((t) => t.id),
  grid: Object.fromEntries(POOL.map((m) => [m, Object.fromEntries(TASKS.map((t) =>
    [t.id, cache[m][t.id]]))])),
  combos, winner: { policy: winner.policy, kind: winner.kind, models: winner.models, rate: winner.rate },
};

const durFile = path.join(os.homedir(), ".llm-mission-control", "combo-bench.json");
try { fs.writeFileSync(durFile, JSON.stringify(result, null, 2) + "\n"); } catch { /* best-effort */ }

if (JSON_OUT) { console.log(JSON.stringify(result, null, 2)); process.exit(0); }

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n── combo-bench (correct-answer rate) ──  pool: ${POOL.join(", ")}`);
console.log(`  ${pad("model", 24)}${TASKS.map((t) => pad(t.id, 16)).join("")}rate`);
for (const m of POOL) {
  const cells = TASKS.map((t) => pad(`${cache[m][t.id].correct ? "✓" : (cache[m][t.id].demo ? "D" : "✗")} ${(cache[m][t.id].ms / 1000).toFixed(0)}s`, 16));
  console.log(`  ${pad(m, 24)}${cells.join("")}${(rate((t) => cache[m][t.id].correct) * 100).toFixed(0)}%`);
}
console.log(`\n  combinations (rate · calls · total s):`);
for (const c of combos) console.log(`    ${pad(c.policy, 26)} ${(c.rate * 100).toFixed(0).padStart(3)}%  · ${String(c.calls).padStart(2)} calls · ${(c.ms / 1000).toFixed(0)}s`);
console.log(`\n  WINNER: ${winner.policy}  (${(winner.rate * 100).toFixed(0)}% correct, ${winner.calls} calls)`);
console.log(`  persisted → ${durFile}`);
