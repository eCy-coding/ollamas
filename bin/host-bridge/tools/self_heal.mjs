#!/usr/bin/env node
// self_heal (scripts lane, v7) — detect bridge failure and repair it.
//   node self_heal.mjs            -> DRY: print the remediation plan, change nothing
//   node self_heal.mjs --apply    -> execute the plan (kill hung 7345 node, restart)
//
// Repairs the bridge, so it must NOT depend on the bridge: it talks to the host
// directly via child_process (lsof/ps/kill/launchctl/start-bridge.sh), never
// bridge-client. Safe-kill: only a *node* process LISTENING on 7345 is killed.
import { readFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { planRemediation, retryWithBackoff } from "../lib/remediation.mjs";
import { recordEvent, buildEvent } from "../lib/events.mjs";

const T0 = Date.now();
const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.BRIDGE_PORT || 7345);
const BRIDGE_URL = process.env.BRIDGE_URL || `http://127.0.0.1:${PORT}`;
const LABEL = "com.missioncontrol.terminalbridge";
const STATE = join(os.homedir(), ".llm-mission-control");
const PID_FILE = join(STATE, "bridge.pid");
const TOKEN_FILE = join(STATE, "bridge.token");
const START_BRIDGE = join(HERE, "..", "start-bridge.sh");

const APPLY = process.argv.includes("--apply");

// --- probes (all best-effort; never throw) ---------------------------------
function sh(cmd, args) {
  try { return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}

async function probeBridge() {
  let headers = {};
  try { const t = readFileSync(TOKEN_FILE, "utf8").trim(); if (t) headers = { "X-Bridge-Token": t }; } catch {}
  try {
    // Health probe fails FAST (1500ms « the 5000ms test timeout) — a dead/unreachable bridge must not
    // hang near the caller's timeout (that collision made self-heal.test.ts flaky under load).
    const r = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(1500), headers });
    return { ok: r.ok };
  } catch { return { ok: false }; }
}

async function probeApp() {
  try {
    // loopback-only health probe; the local app speaks plain HTTP on 127.0.0.1 (same pattern as health_probe.mjs).
    const r = await fetch("http://127.0.0.1:3000/api/health", { signal: AbortSignal.timeout(1500) }); // nosemgrep: typescript.react.security.react-insecure-request.react-insecure-request — fail-fast « test timeout
    return { ok: r.ok };
  } catch { return { ok: false }; }
}

function probePidFile() {
  if (!existsSync(PID_FILE)) return { exists: false, alive: false };
  const pid = Number(readFileSync(PID_FILE, "utf8").trim());
  if (!pid) return { exists: true, alive: false };
  try { process.kill(pid, 0); return { exists: true, alive: true, pid }; } // signal 0 = liveness check
  catch { return { exists: true, alive: false, pid }; }
}

function portHolders() {
  const out = sh("lsof", ["-ti", `tcp:${PORT}`, "-sTCP:LISTEN"]);
  return out ? out.split("\n").filter(Boolean).map(Number) : [];
}

function probePort7345() {
  const pids = portHolders();
  if (!pids.length) return { occupied: false, byNode: false, pids: [] };
  const byNode = pids.every((p) => sh("ps", ["-p", String(p), "-o", "comm="]).includes("node"));
  return { occupied: true, byNode, pids };
}

function probeLaunchd() {
  try { execFileSync("launchctl", ["print", `gui/${process.getuid()}/${LABEL}`], { stdio: "ignore" }); return true; }
  catch { return false; }
}

// --- executors (only when --apply) -----------------------------------------
function execAction(id) {
  switch (id) {
    case "clean_pid":
      rmSync(PID_FILE, { force: true });
      return "removed stale bridge.pid";
    case "kill_7345_node": {
      const killed = [];
      for (const p of portHolders()) {
        if (sh("ps", ["-p", String(p), "-o", "comm="]).includes("node")) { sh("kill", ["-TERM", String(p)]); killed.push(p); }
      }
      return `killed node pids: ${killed.join(",") || "none"}`;
    }
    case "restart_bridge":
      return sh("bash", [START_BRIDGE]) || "start-bridge.sh invoked";
    case "plist_kickstart":
      sh("launchctl", ["kickstart", "-k", `gui/${process.getuid()}/${LABEL}`]);
      return "launchctl kickstart -k issued";
    default:
      return "(no-op)";
  }
}

// --- main ------------------------------------------------------------------
const bridge = await probeBridge();
const health = {
  bridge,
  app: await probeApp(),
  pidFile: probePidFile(),
  port7345: probePort7345(),
  launchdManaged: probeLaunchd(),
};
const actions = planRemediation(health);

const result = {
  ts: new Date().toISOString(),
  applied: APPLY,
  healthyBefore: !!bridge.ok,
  launchdManaged: health.launchdManaged,
  actions: actions.map((a) => ({ id: a.id, reason: a.reason, cmd: a.cmd })),
};

if (!APPLY) {
  for (const a of actions) if (a.sideEffect) process.stderr.write(`[DRY] would run (${a.id}): ${a.cmd}\n`);
  result.ok = true;
  result.healthyAfter = !!bridge.ok;
  recordEvent(buildEvent({ tool: "self_heal", durationMs: Date.now() - T0, status: "ok", exit: 0, attributes: { applied: false, healthyBefore: result.healthyBefore, actions: actions.length } }));
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

// apply: run side-effecting actions, then re-check the bridge with backoff
const done = [];
for (const a of actions) if (a.sideEffect) done.push({ id: a.id, outcome: execAction(a.id) });
result.executed = done;

let healthyAfter = false;
try {
  await retryWithBackoff(async () => {
    const r = await fetch(`${BRIDGE_URL}/health`, { signal: AbortSignal.timeout(5000) }).catch(() => null);
    if (!r?.ok) throw new Error("bridge still down");
    return true;
  }, { retries: 4, minTimeout: 500 });
  healthyAfter = true;
} catch { healthyAfter = false; }

result.healthyAfter = healthyAfter;
result.ok = healthyAfter || actions.length === 0;
recordEvent(buildEvent({ tool: "self_heal", durationMs: Date.now() - T0, status: result.ok ? "ok" : "error", exit: result.ok ? 0 : 1, attributes: { applied: true, healthyBefore: result.healthyBefore, healthyAfter, actions: actions.length } }));
console.log(JSON.stringify(result, null, 2));
process.exit(result.ok ? 0 : 1);
