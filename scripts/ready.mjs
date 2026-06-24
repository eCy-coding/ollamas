#!/usr/bin/env node
// ready — fresh-session "instant-on" gate. Detects prerequisites, SAFELY auto-fixes
// the cheap/local ones (deps, .env, local model), then defers to doctor.mjs for the
// authoritative service audit. Idempotent: a second run is an all-green no-op.
//
//   node scripts/ready.mjs            -> readiness table + verdict
//   node scripts/ready.mjs --no-pull  -> never download the model (report instead)
//   node scripts/ready.mjs --json     -> machine-readable
//
// Exit 0 = prerequisites ready (start + dispatch); 1 = a blocking prerequisite remains.
// Network touched is intentional only: npm registry (npm ci), the model pull, and
// localhost health — never speculative web fetches.

import { existsSync, copyFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const NO_PULL = process.argv.includes("--no-pull");
const JSON_OUT = process.argv.includes("--json");
const OLLAMA = (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/$/, "");
const MODEL = process.env.READY_MODEL || "qwen3:8b";
const PORT = process.env.PORT || "3000";

const steps = [];
const add = (name, status, detail = "", hint = "") => steps.push({ name, status, detail, hint });

function have(bin) {
  return (process.env.PATH || "").split(":").some((d) => { try { return d && existsSync(join(d, bin)); } catch { return false; } });
}
async function httpOk(url) {
  try { const r = await fetch(url, { signal: AbortSignal.timeout(2500) }); return r.ok; } catch { return false; }
}
function sh(cmd, args) {
  // inherit stdio so long installs / pulls stream their own progress; throws on non-zero.
  execFileSync(cmd, args, { cwd: REPO, stdio: "inherit" });
}

// 1) node_modules — auto-fix: npm ci
if (existsSync(join(REPO, "node_modules"))) add("node_modules", "ok", "installed");
else {
  try { console.error("→ node_modules missing — running `npm ci`…"); sh("npm", ["ci"]); add("node_modules", "fixed", "npm ci"); }
  catch { add("node_modules", "BLOCK", "npm ci failed", "run `npm ci` manually, then re-run"); }
}

// 2) .env — auto-fix: copy from .env.example (keys filled later; local works keyless)
if (existsSync(join(REPO, ".env"))) add(".env", "ok", "present");
else if (existsSync(join(REPO, ".env.example"))) {
  copyFileSync(join(REPO, ".env.example"), join(REPO, ".env"));
  add(".env", "fixed", "copied from .env.example", "fill keys via ./setup-keys.sh (optional)");
} else add(".env", "warn", "no .env.example");

// 3) ollama daemon reachable — needed to pull/run the local model
const ollamaUp = await httpOk(`${OLLAMA}/api/tags`);
if (ollamaUp) add("ollama-up", "ok", OLLAMA);
else add("ollama-up", "BLOCK", `unreachable ${OLLAMA}`, have("ollama") ? "start it: `ollama serve`" : "install ollama (https://ollama.com), then `ollama serve`");

// 4) model present — auto-fix: ollama pull (only when daemon up + allowed + cli present)
if (ollamaUp) {
  let present = false;
  try {
    const r = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2500) });
    const j = await r.json();
    present = (j.models || []).some((m) => m.name === MODEL || m.name?.startsWith(MODEL));
  } catch { /* treat as missing */ }
  if (present) add("model", "ok", MODEL);
  else if (NO_PULL || !have("ollama")) add("model", "BLOCK", `${MODEL} missing`, `run \`ollama pull ${MODEL}\``);
  else {
    try { console.error(`→ ${MODEL} missing — pulling (one-time, large download)…`); sh("ollama", ["pull", MODEL]); add("model", "fixed", `pulled ${MODEL}`); }
    catch { add("model", "BLOCK", "pull failed", `run \`ollama pull ${MODEL}\` manually`); }
  }
} else add("model", "skip", "ollama down");

// 5) app/agent server — not auto-started (heavy); report the one command to launch
const appUp = await httpOk(`http://127.0.0.1:${PORT}/api/health`);
add("app-server", appUp ? "ok" : "start", appUp ? `:${PORT}` : "not running", appUp ? "" : "start it: `npm run dev`  (or full stack: `make up`)");

// 5b) agent endpoint — what agent-dispatch.mjs actually posts to (OLLAMAS_URL/api/agent/chat,
// default :8090). The SaaS gateway on :PORT is auth-guarded and is NOT the agent endpoint, so a
// green app-server alone does not prove dispatch works. A non-error response (even 400 on an
// empty body) = reachable; connection refused = down.
const AGENT_URL = (process.env.OLLAMAS_URL || "http://127.0.0.1:8090").replace(/\/$/, "");
let agentUp = false;
try { await fetch(`${AGENT_URL}/api/agent/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(2500) }); agentUp = true; } catch { /* unreachable */ }
add("agent-endpoint", agentUp ? "ok" : "start", agentUp ? AGENT_URL : `unreachable ${AGENT_URL}`, agentUp ? "" : "start the agent server: `npm run dev`");

// 6) authoritative deep audit — reuse doctor.mjs (do NOT re-implement its checks)
let doctor = null;
try {
  const r = spawnSync("node", [join("bin", "host-bridge", "doctor.mjs"), "--json"], { cwd: REPO, encoding: "utf8", timeout: 30000 });
  if (r.stdout) doctor = JSON.parse(r.stdout);
} catch { /* doctor optional — the prerequisite verdict still stands without it */ }

const blocking = steps.filter((s) => s.status === "BLOCK");
const ready = blocking.length === 0;

if (JSON_OUT) {
  console.log(JSON.stringify({ ready, steps, doctorOk: doctor?.ok ?? null }, null, 2));
  process.exit(ready ? 0 : 1);
}

const mark = { ok: " ok  ", fixed: "fixed", start: "start", warn: "warn ", skip: "skip ", BLOCK: "BLOCK" };
console.log("\nollamas readiness\n─────────────────");
for (const s of steps) console.log(`[${mark[s.status] || s.status}] ${s.name.padEnd(12)} ${s.detail}${s.hint ? `  → ${s.hint}` : ""}`);
if (doctor) console.log(`\ndoctor (deep audit): ${doctor.ok ? "all critical checks OK" : "warnings/criticals — run `make doctor` for detail"}`);

console.log(ready
  ? `\n✓ prerequisites ready.${agentUp ? "  agent endpoint up — dispatch: npm run agent -- \"<task>\"" : "  Now start the server: npm run dev   (or make up)"}`
  : `\n✗ ${blocking.length} blocking item(s) above — resolve them, then re-run \`npm run ready\`.`);
process.exit(ready ? 0 : 1);
