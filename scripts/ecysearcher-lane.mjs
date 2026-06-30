#!/usr/bin/env node
// scripts/ecysearcher-lane.mjs — run the eCySearcher threat-intel platform as a managed SUBSYSTEM
// under ollamas. ollamas is the control plane: it brings the eCySearcher docker stack up/down and
// reports its health, CONCURRENT with the main :3000 stack (which it NEVER touches).
//
// eCySearcher is a separate Flask + Postgres + Redis + Celery + Nginx project (its own repo). Its
// full stack is `docker compose` in ECYSEARCHER_DIR → Postgres 5432 · Redis 6379 · Flask 5000 ·
// Nginx 8080. This lane just orchestrates that compose project + polls the Flask health.
//
//   node scripts/ecysearcher-lane.mjs up      # docker compose up -d, wait for health
//   node scripts/ecysearcher-lane.mjs down    # docker compose down
//   node scripts/ecysearcher-lane.mjs health  # probe + print
//   node scripts/ecysearcher-lane.mjs up --dry # print the plan, run nothing (operator-gated boot)
import { spawn } from "node:child_process";

const DEFAULT_DIR = "/Users/emrecnyngmail.com/projem/eCySearcher";

// ── pure helpers (unit-tested) ───────────────────────────────────────────────────────────────
/** The eCySearcher compose project directory. */
export function ecyDir(env = process.env) {
  return env.ECYSEARCHER_DIR || DEFAULT_DIR;
}
/** Base URL of the eCySearcher Flask API (host port 5000 by default). */
export function ecyBaseUrl(env = process.env) {
  return env.ECYSEARCHER_URL || "http://localhost:5000";
}
/** Liveness URL — the Flask app root returns {service:"eCySearcher API", version}. */
export function ecyHealthUrl(env = process.env) {
  return `${ecyBaseUrl(env)}/`;
}
/** `docker compose` argv for an action. v2 syntax (`docker compose …`), the current standard. */
export function composeArgs(action) {
  if (action === "up") return ["compose", "up", "-d"];
  if (action === "down") return ["compose", "down"];
  if (action === "ps") return ["compose", "ps"];
  throw new Error(`unknown compose action: ${action}`);
}
/** Parse the lane CLI argv → { action, dry, json }. Pure. */
export function parseLaneArgs(argv) {
  const a = { action: "status", dry: false, json: false };
  for (const t of argv) {
    if (t === "--dry") a.dry = true;
    else if (t === "--json") a.json = true;
    else if (["up", "down", "status", "health", "ps"].includes(t)) a.action = t;
  }
  return a;
}

// ── thin IO ──────────────────────────────────────────────────────────────────────────────────
/** Probe eCySearcher health. Returns { reachable, status?, body? } — never throws. */
export async function probeEcy(env = process.env, timeoutMs = 2500) {
  try {
    const res = await fetch(ecyHealthUrl(env), { signal: AbortSignal.timeout(timeoutMs) });
    const body = await res.json().catch(() => ({}));
    return { reachable: res.ok, status: res.status, body };
  } catch (e) {
    return { reachable: false, error: String(e?.message || e) };
  }
}

function runCompose(action, dir) {
  return new Promise((resolve) => {
    const child = spawn("docker", composeArgs(action), { cwd: dir, stdio: "inherit" });
    child.on("error", (e) => { console.error(`[ecysearcher-lane] docker not available: ${e?.message || e}`); resolve(127); });
    child.on("exit", (c) => resolve(c ?? 0));
  });
}

async function waitHealthy(env) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const p = await probeEcy(env);
    if (p.reachable) {
      console.error(`[ecysearcher-lane] READY → ${ecyBaseUrl(env)}  (service=${p.body?.service ?? "?"} v${p.body?.version ?? "?"})`);
      return true;
    }
  }
  console.error(`[ecysearcher-lane] WARN: eCySearcher health did not come up in 60s — check 'docker compose logs'.`);
  return false;
}

async function main() {
  const { action, dry, json } = parseLaneArgs(process.argv.slice(2));
  const dir = ecyDir();
  const env = process.env;

  if (action === "health" || action === "status") {
    const p = await probeEcy(env);
    if (json) { process.stdout.write(JSON.stringify({ action, dir, url: ecyBaseUrl(env), ...p }) + "\n"); return; }
    console.error(`[ecysearcher-lane] ${ecyBaseUrl(env)} → ${p.reachable ? `UP (${p.body?.service ?? "ok"} v${p.body?.version ?? "?"})` : `DOWN (${p.error || p.status})`}`);
    return;
  }

  if (dry) {
    console.error(`[ecysearcher-lane] DRY — would run: (cd ${dir} && docker ${composeArgs(action).join(" ")})`);
    console.error(`[ecysearcher-lane] then poll ${ecyHealthUrl(env)} until healthy.`);
    return;
  }

  console.error(`[ecysearcher-lane] ${action} — (cd ${dir} && docker ${composeArgs(action).join(" ")})  [main :3000 untouched]`);
  const code = await runCompose(action, dir);
  if (code !== 0) { console.error(`[ecysearcher-lane] docker compose ${action} exited ${code}`); process.exit(code); }
  if (action === "up") await waitHealthy(env);
}

// Only run main when invoked directly (not when imported by a test).
const invokedDirectly = process.argv[1] && process.argv[1].endsWith("ecysearcher-lane.mjs");
if (invokedDirectly) main();
