#!/usr/bin/env node
// health_probe + log_stream — aggregate health of the whole stack and snapshot
// a live terminal buffer. Bridge-integrated critical observability tool.
//   node health_probe.mjs            -> JSON health report
//   node health_probe.mjs --raw      -> include full terminal buffer
import { readFileSync } from "fs";
import os from "os";
import { join } from "path";

const TOKEN = (() => {
  try { return readFileSync(join(os.homedir(), ".llm-mission-control", "bridge.token"), "utf8").trim(); }
  catch { return ""; }
})();
const H = TOKEN ? { "X-Bridge-Token": TOKEN } : {};

async function probe(label, url, opts = {}) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(8000), ...opts });
    return { ok: r.ok, status: r.status, body: await r.json().catch(() => null) };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

const raw = process.argv.includes("--raw");

const bridge = await probe("bridge", "http://127.0.0.1:7345/health", { headers: H });
const app = await probe("app", "http://127.0.0.1:3000/api/health");
const term = await probe("term", "http://127.0.0.1:7345/read?target=terminal", { headers: H });

const buf = term.body?.contents || "";
const report = {
  ts: new Date().toISOString(),
  healthy: !!(bridge.ok && app.ok),
  bridge: bridge.ok ? { ok: true, terminals: bridge.body?.terminals } : { ok: false, error: bridge.error },
  app: app.ok
    ? { mode: app.body?.mode, ollama: app.body?.metrics?.ollamaVersion, models: (app.body?.metrics?.loadedModels || []).map((m) => m.name) }
    : { ok: false, error: app.error },
  logStream: { target: "terminal", chars: buf.length, tail: raw ? buf : buf.replace(/\s+/g, " ").trim().slice(-80) },
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.healthy ? 0 : 1);
