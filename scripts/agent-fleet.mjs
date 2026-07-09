#!/usr/bin/env node
// @ts-check
// agent-fleet — Tier-2 coordinator in the 3-tier hierarchy:
//
//   Tier 1  Claude Code (orchestrates, cross-checks, reports to the human)
//     └─ Tier 2  THIS script (ollamas-claude lead — fans out, aggregates)
//          └─ Tier 3  agent-dispatch.mjs sub-agents (ollama-claude workers)
//
// Each Tier-3 worker is given ONE system slice to inspect via the real host tools
// and reports up. Workers are spread across models (ollama-local + gemini) so cloud
// keys give TRUE parallelism (local is one GPU). The deterministic system-monitor.mjs
// remains the ground truth Tier-1 cross-checks every worker claim against.
//
// Usage: node scripts/agent-fleet.mjs [--json]
// Env:   OLLAMAS_TIMEOUT_MS (per worker, default 120000)

import { execFile } from "node:child_process";
import { promisify } from "node:util";
const pexec = promisify(execFile);

const REPO = "/Users/emrecnyngmail.com/Desktop/ollamas";
const JSON_OUT = process.argv.includes("--json");
const ROOT = `${process.env.HOME}/.llm-mission-control/agent-work/fleet`;

// Tier-3 worker assignments: each = one system slice + the model that inspects it.
// The expect regex is the ground-truth string that MUST appear in a real tool output
// (Tier-1 cross-checks this) so a confident-but-wrong worker cannot pass.
const FLEET = [
  // NOTE: only ONE ollama-local worker runs concurrently — two would contend on the
  // single GPU and one wanders/times out. Cloud (gemini) workers parallelize freely.
  { id: "invariants", model: "gemini", provider: "gemini",
    task: `Run the system health check. Use macos_terminal target=iterm2 to run exactly: cd ${REPO} && node scripts/system-monitor.mjs . Report the SUMMARY line and any non-PASS check. Stop. No file writes.`,
    expect: /SUMMARY:\s*\d+\s*PASS/ },
  { id: "git-version", model: "gemini", provider: "gemini",
    task: `Report repo state. Use macos_terminal target=iterm2 to run exactly: cd ${REPO} && git rev-parse --short HEAD && node -e 'console.log(require("./package.json").version)' . Report the commit hash and version. Stop. No file writes.`,
    expect: /\b[0-9a-f]{7}\b/ },
  { id: "ollama-models", model: "qwen3:8b", provider: "ollama-local",
    task: `Report available local AI models. Use macos_terminal target=iterm2 to run exactly: curl -s http://127.0.0.1:11434/api/tags | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>console.log("models="+JSON.parse(d).models.length))' . Report the model count. Stop. No file writes.`,
    expect: /models=\d+/ },
  { id: "key-pool", model: "gemini", provider: "gemini",
    task: `Report API key pool health. Use macos_terminal target=iterm2 to run exactly: curl -s http://127.0.0.1:8090/api/keys/pool . Report which providers have live keys. NEVER print key values. Stop. No file writes.`,
    expect: /"live"\s*:\s*\d+/ },
];

const TIMEOUT = Number(process.env.OLLAMAS_TIMEOUT_MS || 120000);

async function runWorker(w) {
  const t0 = Date.now();
  let out = "";
  try {
    const r = await pexec("node", ["scripts/agent-dispatch.mjs", w.task,
      "--provider", w.provider, "--model", w.model, "--steps", "4", "--root", `${ROOT}/${w.id}`, "--json"],
      { cwd: REPO, timeout: TIMEOUT, maxBuffer: 4 * 1024 * 1024 });
    out = r.stdout;
  } catch (e) { out = (e.stdout || "") || ""; } // dispatch exits 1 on non-allOk; still capture
  const ms = Date.now() - t0;
  let rep; try { rep = JSON.parse(out); } catch { rep = { steps: [], provider: w.provider, model: w.model }; }
  const blob = (rep.steps || []).map((s) => String(s.out || "")).join("\n");
  const pass = w.expect.test(blob);
  return { id: w.id, provider: w.provider, model: w.model, ms, pass, demo: !!rep.demoSuspected,
    verdict: rep.verdict, steps: (rep.steps || []).length,
    evidence: (blob.match(w.expect) || [""])[0].slice(0, 80) };
}

// Tier-2 fan-out: all workers in parallel (local serializes on GPU; gemini is cloud).
const results = await Promise.all(FLEET.map(runWorker));

if (JSON_OUT) { console.log(JSON.stringify({ tier: "2", workers: results }, null, 2)); process.exit(results.every((r) => r.pass) ? 0 : 1); }

const pad = (s, n) => String(s).padEnd(n);
console.log(`\n── agent-fleet (Tier-2: ollamas-claude lead → ${FLEET.length} Tier-3 workers) ──`);
console.log(`  ${pad("slice", 14)}${pad("worker", 22)}${pad("result", 10)}evidence`);
for (const r of results) {
  const mark = r.pass ? "✓ pass" : (r.demo ? "D demo" : "✗ fail");
  console.log(`  ${pad(r.id, 14)}${pad(`${r.provider}/${r.model}`, 22)}${pad(`${mark} ${(r.ms / 1000).toFixed(0)}s`, 10)}${r.evidence.replace(/\n/g, " ")}`);
}
const ok = results.filter((r) => r.pass).length;
console.log(`  FLEET: ${ok}/${results.length} workers reported verified evidence`);
process.exit(ok === results.length ? 0 : 1);
