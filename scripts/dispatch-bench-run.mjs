#!/usr/bin/env node
// @ts-check
// dispatch-bench-run — the PRODUCER of ~/.llm-mission-control/dispatch-bench.json.
//
// Runs real measured dispatches across working-principle VARIANTS × fleet MACHINES, drives
// each through /api/agent/chat (SSE), measures {correct, steps, dupTools, latencyMs, tokS},
// and writes the bench file that orchestration/bin/dispatchbench.ts consumes → DISPATCH_SELECTION
// → reconcile advances REBENCH→DISPATCH. Closes the autonomous benchmark loop.
//
// Honest: NO fabrication. If the server/fleet is unreachable it skips-with-loud-warn (writes
// nothing) rather than inventing numbers — the evidence law. tok/s comes from the server's
// `done` event (server.ts surfaces result.tokensPerSec); 0 when the server build lacks it.
//
// Usage:
//   node scripts/dispatch-bench-run.mjs [--runs 2] [--max-steps 6] [--machines mac]
//                                       [--task "<prompt>"] [--json]
// Env: OLLAMAS_URL (mac gateway, default http://127.0.0.1:8090), DISPATCH_BENCH_TIMEOUT_MS (90000).

import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const opt = (f, d) => { const i = args.indexOf(f); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const RUNS = Number(opt("--runs", "2"));
const MAX_STEPS = Number(opt("--max-steps", "6"));
const TIMEOUT = Number(process.env.DISPATCH_BENCH_TIMEOUT_MS || "90000");
const JSON_OUT = args.includes("--json");
const MAC_URL = process.env.OLLAMAS_URL || "http://127.0.0.1:8090";

// A small, deterministically-verifiable coding task (correctness = the agent reaches VERDICT: DONE
// after writing + running the file and observing the expected stdout).
const TASK = opt("--task",
  "Write factorial.py with a factorial(n) function and print(factorial(5)), then run it with python3 and confirm the output is exactly 120. Emit VERDICT: DONE only after you SEE 120 in the real terminal output.");

// ── Working-principle VARIANTS (the dimension dispatchbench selects over) ─────────────
// Each returns the STANDARDS block prepended to the task. Mirrors agent-dispatch.mjs STANDARDS,
// perturbed per variant — the "test the working principles and pick the best" space.
const VARIANTS = {
  "ecypro-base": (root) => [
    "[ollamas sub-agent — eCyPro standards]",
    "- Minimize steps. Do NOT call the same tool twice with the same args.",
    `- The ONLY writable root is ${root} — absolute paths.`,
    "- Fresh file: write_host_file then immediately macos_terminal to RUN it and show stdout.",
    "- Evidence over assertion: show the real terminal stdout; never fabricate.",
    "- When verified, STOP and emit exactly: VERDICT: DONE <proof>  (or VERDICT: BLOCKED <reason>).",
  ].join("\n"),
  "ecypro-strict": (root) => [
    "[ollamas sub-agent — eCyPro STRICT: fail-fast, minimal]",
    `- Writable root ONLY ${root}. Take the SHORTEST path: write the file, run it, verify, stop.`,
    "- NO exploration, NO reads unless the task references existing code. NO tool repeats.",
    "- On the FIRST tool error, report it and STOP (no retries).",
    "- Emit exactly one final line: VERDICT: DONE <proof>  (or VERDICT: BLOCKED <reason>).",
  ].join("\n"),
};

// ── Machines: mac gateway (inference-offload) + any remote pool gateways ──────────────
function loadMachines(filter) {
  const machines = [{ name: "mac", url: MAC_URL }];
  try {
    const pool = JSON.parse(readFileSync(join(homedir(), ".ollamas", "backends.json"), "utf8"));
    for (const b of Array.isArray(pool) ? pool : []) {
      if (b && b.name && b.name !== "mac" && typeof b.url === "string") {
        // pool urls are ollama (:11434); dispatch needs the ollamas gateway (:8090) on that host.
        const host = b.url.replace(/^https?:\/\//, "").replace(/:.*$/, "");
        machines.push({ name: b.name, url: `http://${host}:8090` });
      }
    }
  } catch { /* no pool → mac only */ }
  return filter ? machines.filter((m) => filter.split(",").includes(m.name)) : machines;
}

// ── PURE: dedup (tool,args) pairs → count of repeats; metric fold from events ─────────
export function countDupTools(steps) {
  const seen = new Map();
  let dup = 0;
  for (const s of steps) {
    const key = `${s.tool}|${canonArgs(s.args)}`;
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    if (n > 1) dup++;
  }
  return dup;
}

// Canonicalize args (sort object keys) so two semantically-equal calls with reordered
// fields produce the SAME key — otherwise countDupTools under-counts duplicates.
function canonArgs(args) {
  let v;
  try { v = typeof args === "string" ? JSON.parse(args) : args; } catch { return String(args); }
  if (v && typeof v === "object" && !Array.isArray(v)) {
    return JSON.stringify(Object.keys(v).sort().reduce((o, k) => { o[k] = v[k]; return o; }, {}));
  }
  return JSON.stringify(v);
}

// latencyMs enables a wall-clock tok/s estimate when the server omits a real rate (degraded
// ollama → done.tokensPerSec=0). Estimate = model-generated chars / 4 (≈tokens) ÷ seconds.
export function foldMetrics(events, latencyMs = 0) {
  const steps = [];
  const messages = [];
  const errors = [];
  let tokS = 0;
  let genChars = 0; // model-generated text: assistant messages + tool-call args it emitted
  for (const ev of Array.isArray(events) ? events : []) {
    if (!ev || typeof ev !== "object") continue;
    if (ev.type === "step") {
      steps.push({ tool: ev.tool, args: JSON.stringify(ev.args ?? null), ok: ev.ok });
      genChars += (ev.tool ? String(ev.tool).length : 0) + JSON.stringify(ev.args ?? "").length;
    }
    else if (ev.type === "message") { if (ev.text) { messages.push(ev.text); genChars += ev.text.length; } }
    else if (ev.type === "done") { if (ev.text) { messages.push(ev.text); genChars += ev.text.length; } if (typeof ev.tokensPerSec === "number") tokS = ev.tokensPerSec; }
    else if (ev.type === "error") errors.push(ev.message || "err");
  }
  const demoSuspected = steps.length === 0 && messages.length > 0 && errors.length === 0;
  const final = messages[messages.length - 1] || "";
  const verdict = /VERDICT:\s*DONE/i.test(final) ? "DONE" : /VERDICT:\s*BLOCKED/i.test(final) ? "BLOCKED"
    : (steps.length > 0 && steps.every((s) => s.ok) && errors.length === 0 && !demoSuspected) ? "OK" : "INCOMPLETE";
  const correct = (verdict === "DONE" || verdict === "OK") && !demoSuspected;
  // Server value is ground-truth; estimate only fills the 0 gap (honestly flagged).
  let tokSEstimated = false;
  if (!(tokS > 0) && latencyMs > 0 && genChars > 0) {
    tokS = Math.round(((genChars / 4) / (latencyMs / 1000)) * 10) / 10;
    tokSEstimated = true;
  }
  return { steps: steps.length, dupTools: countDupTools(steps), correct, tokS, tokSEstimated, verdict };
}

// ── thin IO: one dispatch → events ───────────────────────────────────────────────────
async function dispatchOnce(url, content) {
  const body = JSON.stringify({ provider: "ollama-local", model: "qwen3:8b", autoApply: true, maxSteps: MAX_STEPS, messages: [{ role: "user", content }] });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT);
  const events = [];
  try {
    const res = await fetch(`${url}/api/agent/chat`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "text/event-stream" }, body, signal: ac.signal });
    if (!res.ok || !res.body) { events.push({ type: "error", message: `HTTP ${res.status}` }); return events; }
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n"); buf = lines.pop() || "";
      for (const line of lines) { const s = line.trim(); if (!s.startsWith("data:")) continue; try { events.push(JSON.parse(s.slice(5).trim())); } catch { /* skip */ } }
    }
  } catch (e) { events.push({ type: "error", message: ac.signal.aborted ? `timeout ${TIMEOUT}ms` : (e?.message || String(e)) }); }
  finally { clearTimeout(timer); }
  return events;
}

async function main() {
  const machines = loadMachines(opt("--machines", null));
  // Reachability gate (honest): if the mac gateway isn't live, skip — do not fabricate.
  try {
    const h = await fetch(`${MAC_URL}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!h.ok) throw new Error("not ok");
  } catch {
    console.error(`[dispatch-bench] SKIP — mac gateway ${MAC_URL} unreachable. Boot it (npm run dev) then re-run. No bench written (evidence law: no fabrication).`);
    process.exit(3);
  }

  const records = [];
  const root = `${process.env.HOME}/.llm-mission-control/agent-work/bench`;
  for (const [variant, build] of Object.entries(VARIANTS)) {
    for (const m of machines) {
      for (let r = 0; r < RUNS; r++) {
        const content = `${build(`${root}/${variant}-${m.name}-${r}`)}\n\nTASK:\n${TASK}`;
        const t0 = Date.now();
        const events = await dispatchOnce(m.url, content);
        const latencyMs = Date.now() - t0;
        const met = foldMetrics(events, latencyMs);
        records.push({ variant, machine: m.name, correct: met.correct, steps: met.steps, dupTools: met.dupTools, latencyMs, tokS: met.tokS, tokSEstimated: met.tokSEstimated });
        console.error(`[dispatch-bench] ${variant} × ${m.name} run ${r + 1}/${RUNS}: ${met.verdict} · ${met.steps} steps · ${met.dupTools} dup · ${latencyMs}ms · ${met.tokS}${met.tokSEstimated ? "~" : ""} tok/s`);
      }
    }
  }

  const out = { ts: new Date().toISOString(), records };
  if (JSON_OUT) { console.log(JSON.stringify(out, null, 2)); return; }
  const dir = join(homedir(), ".llm-mission-control");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "dispatch-bench.json"), JSON.stringify(out, null, 2) + "\n");
  const ok = records.filter((x) => x.correct).length;
  console.error(`[dispatch-bench] wrote ${records.length} records (${ok} correct) → ~/.llm-mission-control/dispatch-bench.json. Next: tsx orchestration/bin/dispatchbench.ts → reconcile.`);
}

// Run only as a script (allow importing the pure helpers in tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error("[dispatch-bench] error:", e?.message ?? e); process.exit(1); });
}
