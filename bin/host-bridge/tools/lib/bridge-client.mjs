// @ts-check
// Shared client for the macOS terminal bridge. Centralizes token reading,
// HTTP boilerplate, client-side timeout, a single retry, and consistent
// error shaping so every tool behaves the same (clig.dev machine-readable +
// reliable exit codes).
import { readFileSync } from "node:fs";
import os from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordEvent, buildEvent } from "../../lib/events.mjs";

// Process start ≈ tool invocation start; every bridge tool flows through emit()/
// main(), so recording here auto-instruments the whole toolkit (v8 observability).
const T0 = Date.now();
const TOOL = basename(process.argv[1] || "unknown", ".mjs");

// Repo root the host tools cd into (docker compose / git live here). Derived from
// this file's location (.../bin/host-bridge/tools/lib -> 4 up = root) so it is
// portable across machines/checkouts; OLLAMAS_REPO overrides for split deploys
// where the running stack lives elsewhere. (ERR-SCR-003: no hardcoded home path.)
export const REPO = process.env.OLLAMAS_REPO || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const BASE = process.env.BRIDGE_URL || "http://127.0.0.1:7345";

export function readToken() {
  try {
    return readFileSync(join(os.homedir(), ".llm-mission-control", "bridge.token"), "utf8").trim();
  } catch {
    return ""; // bridge may run without a token in dev
  }
}

/** @param {string} path @param {{method?:string, body?:any, timeoutMs?:number}} [opts] */
async function call(path, { method = "GET", body, timeoutMs = 30000 } = {}) {
  const token = readToken();
  const headers = { "Content-Type": "application/json", ...(token ? { "X-Bridge-Token": token } : {}) };
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs + 4000),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`bridge ${res.status}: ${json.error || res.statusText}`);
      return json;
    } catch (e) {
      lastErr = e;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 400)); // single retry
    }
  }
  throw lastErr;
}

// Run a command in a visible macOS terminal (mutex-serialized, watchdog-guarded).
export function bridgeRun(command, { target = "terminal", timeoutMs = 30000 } = {}) {
  return call("/run", { method: "POST", body: { target, command, timeoutMs }, timeoutMs });
}

// Run a command directly on the host (no terminal, no mutex).
export function bridgeExec(command, { timeoutMs = 60000 } = {}) {
  return call("/exec", { method: "POST", body: { command, timeoutMs }, timeoutMs });
}

// Snapshot a terminal's visible buffer.
export function bridgeRead(target = "terminal") {
  return call(`/read?target=${encodeURIComponent(target)}`, { timeoutMs: 12000 });
}

// Print a result object as pretty JSON and exit with the right code.
export function emit(obj, okField = "ok") {
  const failed = obj[okField] === false;
  recordEvent(buildEvent({ tool: TOOL, durationMs: Date.now() - T0, status: failed ? "error" : "ok", exit: failed ? 1 : 0 }));
  console.log(JSON.stringify(obj, null, 2));
  process.exit(failed ? 1 : 0);
}

// Wrap a tool's main() so any throw becomes a clean JSON error + exit 1.
export async function main(fn) {
  try {
    await fn();
  } catch (e) {
    recordEvent(buildEvent({ tool: TOOL, durationMs: Date.now() - T0, status: "error", exit: 1, attributes: { error: String(e?.message || e) } }));
    console.error(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    process.exit(1);
  }
}
