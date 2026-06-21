// Structured seyir event writer (scripts lane, v8). Appends one OTel-style JSON
// line per tool run to <DATA_DIR>/seyir-defteri-scripts.jsonl. Zero-dep (node
// builtins only, mirrors logbook.mjs); best-effort — a write failure must NEVER
// break the tool. Opt out with SEYIR_EVENTS=0.
//
// Field names follow open-telemetry/semantic-conventions (Apache, SDK-free):
//   tool, duration_ms, status ("ok"|"error"), exit, attributes.
import { appendFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";

export const EVENTS_FILE = "seyir-defteri-scripts.jsonl";

function dataDir() {
  return process.env.MISSION_CONTROL_DATA_DIR || join(os.homedir(), ".llm-mission-control");
}

let _device;
export function device() {
  if (!_device) {
    const cpus = os.cpus();
    _device = { host: os.hostname(), arch: os.arch(), platform: os.platform(), ncpu: cpus.length, cpu: cpus[0]?.model };
  }
  return _device;
}

// Pure: build the event object. `now` injectable for tests.
export function buildEvent({ tool, durationMs = 0, status = "ok", exit = 0, attributes = {}, now = Date.now() }) {
  return {
    ts: new Date(now).toISOString(),
    ts_ms: now,
    tool: tool || "unknown",
    duration_ms: Math.max(0, Math.round(durationMs)),
    status: status === "error" || exit !== 0 ? "error" : "ok",
    exit,
    device: device(),
    attributes,
  };
}

// Append one event line. Best-effort: never throws, honors SEYIR_EVENTS=0.
export function recordEvent(event) {
  if (process.env.SEYIR_EVENTS === "0") return false;
  try {
    const dir = dataDir();
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, EVENTS_FILE), JSON.stringify(event) + "\n");
    return true;
  } catch {
    return false; // observability must not break the tool it observes
  }
}

export function eventsPath() {
  return join(dataDir(), EVENTS_FILE);
}
