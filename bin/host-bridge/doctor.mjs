#!/usr/bin/env node
// doctor — one-command M4 preflight: "is my ollamas host setup e2e ready?" (v18).
// Aggregates install invariants (node, registry drift) + runtime/service checks
// (ollama, bridge, LaunchAgent loaded, token, benchmark). Each failure prints an
// actionable hint. CRITICAL fail → exit 1; WARN-only → exit 0 (env-dependent, no
// false-alarm). Standalone operator command (like gate.mjs) — not a host tool.
//   node doctor.mjs            -> readiness table
//   node doctor.mjs --json     -> machine-readable verdict
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeVersionOk, parseLaunchctlLoaded, evaluate } from "./lib/doctor.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.OLLAMAS_REPO || join(HERE, "..", "..");
const STATE = join(os.homedir(), ".llm-mission-control");
const LABEL = "com.missioncontrol.terminalbridge";
const JSON_OUT = process.argv.includes("--json");

function have(bin) {
  return (process.env.PATH || "").split(":").some((d) => { try { return d && existsSync(join(d, bin)); } catch { return false; } });
}
async function httpOk(url, headers = {}) {
  try { const r = await fetch(url, { headers, signal: AbortSignal.timeout(2000) }); return r.ok; } catch { return false; }
}
function token() {
  try { return readFileSync(join(STATE, "bridge.token"), "utf8").trim(); } catch { return ""; }
}

const tok = token();
const bridgeHeaders = tok ? { "X-Bridge-Token": tok } : {};

// --- gather live checks ---
const driftExit = spawnSync("node", [join(HERE, "drift-check.mjs")], { cwd: REPO, stdio: "ignore" }).status;
const lc = spawnSync("launchctl", ["print", `gui/${process.getuid?.() ?? ""}/${LABEL}`], { stdio: ["ignore", "pipe", "ignore"] });

const checks = [
  { name: "node>=24", level: "critical", ok: nodeVersionOk(process.version, 24), detail: process.version, hint: "install Node 24+ (brew install node)" },
  { name: "registry-drift", level: "critical", ok: driftExit === 0, detail: driftExit === 0 ? "aligned" : "DRIFT", hint: "node bin/host-bridge/drift-check.mjs" },
  { name: "ollama-cli", level: "warn", ok: have("ollama"), hint: "install ollama (https://ollama.com)" },
  { name: "ollama-up", level: "warn", ok: await httpOk("http://127.0.0.1:11434/api/tags"), hint: "ollama serve" },
  { name: "bridge.token", level: "warn", ok: !!tok, hint: "make install-agent  (or bash bin/host-bridge/start-bridge.sh)" },
  { name: "launchagent-loaded", level: "warn", ok: have("launchctl") ? parseLaunchctlLoaded({ exitCode: lc.status, stdout: lc.stdout?.toString() || "" }, LABEL) : true, hint: "make install-agent" },
  { name: "bridge-health", level: "warn", ok: await httpOk("http://127.0.0.1:7345/health", bridgeHeaders), hint: "bash bin/host-bridge/start-bridge.sh  (or make install-agent)" },
  { name: "app-health", level: "warn", ok: await httpOk("http://127.0.0.1:3000/api/health"), hint: "bash install.sh  (docker compose up)" },
  { name: "benchmark.json", level: "warn", ok: existsSync(join(STATE, "benchmark.json")), hint: "node bin/host-bridge/benchmark.mjs" },
];

const verdict = evaluate(checks);

if (JSON_OUT) {
  console.log(JSON.stringify(verdict, null, 2));
  process.exit(verdict.ok ? 0 : 1);
}

console.log("──────────── ollamas doctor (M4 preflight) ────────────");
for (const c of verdict.checks) {
  const tag = c.ok ? "PASS" : c.level === "critical" ? "FAIL" : "WARN";
  const line = `  ${tag}  ${c.name.padEnd(20)}${c.detail ? " " + c.detail : ""}`;
  console.log(line + (!c.ok && c.hint ? `\n        ↳ ${c.hint}` : ""));
}
console.log("────────────────────────────────────────────────────────");
console.log(verdict.ready ? "[+] READY — fully set up and running" : verdict.ok ? "[~] OK (invariants pass) — some services not running (see WARN hints)" : `[!] NOT READY — critical: ${verdict.criticalFailed.join(", ")}`);
process.exit(verdict.ok ? 0 : 1);
