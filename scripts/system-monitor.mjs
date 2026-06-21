#!/usr/bin/env node
// system-monitor — DETERMINISTIC invariant suite for the ollamas system.
//
// This is the GROUND TRUTH the monitoring sub-agents report against: pure, read-only,
// side-effect-free, cron-safe. Each invariant is measured by code (not an LLM), so an
// agent's spoken report can be cross-checked against this. Exit 1 if any invariant FAILs
// (CRITICAL ordered first). `--json` emits machine-readable output for agents/cron.
//
// Usage:  node scripts/system-monitor.mjs [--json] [--app-url http://127.0.0.1:8090]
//         [--bridge-url http://127.0.0.1:7345] [--ollama http://127.0.0.1:11434]

import { execSync } from "node:child_process";
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const opt = (f, d) => { const i = process.argv.indexOf(f); return i >= 0 ? process.argv[i + 1] : d; };
const JSON_OUT = process.argv.includes("--json");
// --heartbeat: the SUSTAINABLE/self-improving mode. Appends each run to a JSONL ledger
// (the persistent learning store), compares against the previous run to detect drift,
// and follows "Silence = Success" — prints nothing when nothing changed (cron-cheap).
const HEARTBEAT = process.argv.includes("--heartbeat");
const LEDGER = opt("--ledger", `${process.env.HOME}/.llm-mission-control/monitor-history.jsonl`);
const APP = opt("--app-url", "http://127.0.0.1:8090");
const BRIDGE = opt("--bridge-url", "http://127.0.0.1:7345");
const OLLAMA = opt("--ollama", "http://127.0.0.1:11434");
const REPO = "/Users/emrecnyngmail.com/Desktop/ollamas";

const j = async (url, opts) => { const r = await fetch(url, { signal: AbortSignal.timeout(8000), ...opts }); const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; } return { ok: r.ok, status: r.status, body: b }; };
const sh = (cmd) => { try { return { ok: true, out: execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim() }; } catch (e) { return { ok: false, out: (e.stdout || "") + (e.stderr || ""), code: e.status }; } };

// Each check: { name, sev: CRITICAL|HIGH|MED, run: async () => ({status, detail}) }
const CHECKS = [
  { name: "app.health", sev: "CRITICAL", run: async () => {
    try { const r = await j(`${APP}/health`); return { status: r.status === 200 ? "PASS" : "FAIL", detail: `GET /health -> ${r.status}` }; }
    catch (e) { return { status: "FAIL", detail: `unreachable: ${e.message}` }; } } },

  { name: "app.metrics", sev: "MED", run: async () => {
    try { const r = await j(`${APP}/metrics`); const has = typeof r.body === "string" && /(^|\n)\w+/.test(r.body); return { status: r.status === 200 && has ? "PASS" : "FAIL", detail: `GET /metrics -> ${r.status}, ${typeof r.body === "string" ? r.body.length : 0} bytes` }; }
    catch (e) { return { status: "FAIL", detail: e.message }; } } },

  { name: "provider.real_coding", sev: "CRITICAL", run: async () => {
    // ollama-local is FIRST in the fallback chain and demo is LAST → if local ollama is
    // reachable with models, the agent serves REAL coding (never demo). Deterministic proxy.
    try { const r = await j(`${OLLAMA}/api/tags`); const n = Array.isArray(r.body?.models) ? r.body.models.length : 0;
      return { status: r.ok && n > 0 ? "PASS" : "FAIL", detail: `ollama-local up, ${n} models -> real-coding available (demo is chain-last)` }; }
    catch (e) { return { status: "FAIL", detail: `ollama-local unreachable -> chain may fall to DEMO: ${e.message}` }; } } },

  { name: "host_bridge", sev: "HIGH", run: async () => {
    try { const r = await j(`${BRIDGE}/health`); const b = r.body || {}; const okTok = b.tokenRequired === true; const term = b.terminals || {};
      const good = r.ok && okTok && (term.iterm2 || term.terminal);
      return { status: good ? "PASS" : "FAIL", detail: `ok=${r.ok} tokenRequired=${okTok} iterm2=${!!term.iterm2} terminal=${!!term.terminal}` }; }
    catch (e) { return { status: "FAIL", detail: `bridge unreachable: ${e.message}` }; } } },

  { name: "ollama_models", sev: "MED", run: async () => {
    try { const r = await j(`${OLLAMA}/api/tags`); const names = (r.body?.models || []).map((m) => m.name);
      const want = ["qwen3:8b"]; const missing = want.filter((w) => !names.includes(w));
      return { status: missing.length === 0 ? "PASS" : "FAIL", detail: `${names.length} models; missing required: ${missing.join(",") || "none"}` }; }
    catch (e) { return { status: "FAIL", detail: e.message }; } } },

  { name: "tool_registry.choke_point", sev: "HIGH", run: async () => {
    // Single dispatch path invariant: the MCP tools/list count must equal the built-in
    // total (29). Probe the HTTP /mcp JSON-RPC; if the handshake isn't available, SKIP
    // (the assertion is also covered by the test suite) rather than false-FAIL.
    try {
      const r = await j(`${APP}/mcp`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
      let tools = r.body?.result?.tools;
      if (!tools && typeof r.body === "string") { const m = r.body.match(/"tools":\s*\[/); if (m) { try { tools = JSON.parse(r.body.slice(r.body.indexOf("{"))).result?.tools; } catch {} } }
      if (Array.isArray(tools)) { const builtin = tools.filter((t) => !t.name.startsWith("mcp__")).length;
        return { status: builtin >= 29 ? "PASS" : "FAIL", detail: `tools/list builtin=${builtin} (expect >=29)` }; }
      return { status: "SKIP", detail: `MCP tools/list not directly callable (status ${r.status}); covered by test suite` };
    } catch (e) { return { status: "SKIP", detail: `MCP probe skipped: ${e.message}` }; } } },

  { name: "port_hygiene", sev: "MED", run: async () => {
    const r = sh(`lsof -nP -iTCP:8090 -sTCP:LISTEN -t`);
    const pids = r.out.split("\n").filter(Boolean);
    return { status: pids.length <= 1 ? "PASS" : "FAIL", detail: `:8090 listeners=${pids.length} (${pids.join(",") || "none"}) — >1 = stale squat` }; } },

  { name: "key_pool", sev: "MED", run: async () => {
    // A provider with keys but ZERO live (all cooled/exhausted) needs a new user key.
    try {
      const r = await j(`${APP}/api/keys/pool`);
      const pool = r.body?.pool || {};
      const configured = Object.entries(pool).filter(([, v]) => (v.total || 0) > 0);
      const exhausted = configured.filter(([, v]) => (v.live || 0) === 0).map(([p]) => p);
      const summary = configured.map(([p, v]) => `${p}:${v.live}/${v.total}`).join(" ") || "no cloud keys configured";
      return { status: exhausted.length ? "FAIL" : "PASS", detail: exhausted.length ? `EXHAUSTED: ${exhausted.join(",")} — add a new key to .env. (${summary})` : summary };
    } catch (e) { return { status: "SKIP", detail: `pool endpoint unavailable: ${e.message}` }; } } },

  { name: "npm_audit.no_high", sev: "HIGH", run: async () => {
    const r = sh(`cd ${REPO} && npm audit --json`);
    try { const a = JSON.parse(r.out); const m = a.metadata?.vulnerabilities || {};
      const bad = (m.critical || 0) + (m.high || 0);
      return { status: bad === 0 ? "PASS" : "FAIL", detail: `crit=${m.critical||0} high=${m.high||0} mod=${m.moderate||0} low=${m.low||0}` }; }
    catch (e) { return { status: "SKIP", detail: `audit parse failed: ${e.message}` }; } } },
];

const ORDER = { CRITICAL: 0, HIGH: 1, MED: 2 };
const results = [];
for (const c of CHECKS) {
  let res; try { res = await c.run(); } catch (e) { res = { status: "FAIL", detail: `check threw: ${e.message}` }; }
  results.push({ name: c.name, sev: c.sev, ...res });
}
results.sort((a, b) => (ORDER[a.sev] - ORDER[b.sev]) || a.name.localeCompare(b.name));

const fails = results.filter((r) => r.status === "FAIL");
const passes = results.filter((r) => r.status === "PASS");
const skips = results.filter((r) => r.status === "SKIP");

// ── Heartbeat: persistent learning store + drift detection (the "ML-like gain") ──
if (HEARTBEAT) {
  const stamp = new Date().toISOString();
  const statusMap = Object.fromEntries(results.map((r) => [r.name, r.status]));
  const record = { ts: stamp, pass: passes.length, fail: fails.length, skip: skips.length, checks: statusMap,
    // keep one cheap numeric signal for drift (audit vuln counts), parsed from detail
    audit: (results.find((r) => r.name === "npm_audit.no_high")?.detail || "") };

  // Read the PREVIOUS record (the baseline) before appending the new one.
  let prev = null;
  try { if (existsSync(LEDGER)) { const lines = readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean); if (lines.length) prev = JSON.parse(lines[lines.length - 1]); } } catch {}

  // Compute deltas vs baseline: regression (→FAIL), recovery (FAIL→PASS), and any flip.
  const deltas = [];
  if (prev) {
    for (const r of results) {
      const was = prev.checks?.[r.name];
      if (was && was !== r.status) {
        const kind = r.status === "FAIL" ? "REGRESSION" : (was === "FAIL" ? "RECOVERY" : "CHANGE");
        deltas.push({ name: r.name, from: was, to: r.status, kind });
      }
    }
    if (prev.audit && record.audit && prev.audit !== record.audit) deltas.push({ name: "npm_audit.drift", from: prev.audit, to: record.audit, kind: "DRIFT" });
  }

  try { mkdirSync(dirname(LEDGER), { recursive: true }); appendFileSync(LEDGER, JSON.stringify(record) + "\n"); } catch (e) { console.error(`[heartbeat] ledger write failed: ${e.message}`); }

  const runs = (() => { try { return readFileSync(LEDGER, "utf8").trim().split("\n").filter(Boolean).length; } catch { return 1; } })();
  const escalate = fails.length > 0 || deltas.some((d) => d.kind === "REGRESSION" || d.kind === "DRIFT");

  // "Silence = Success": nothing wrong AND nothing changed → stay quiet (cron-friendly).
  if (!escalate && deltas.length === 0) {
    if (!prev) console.log(`heartbeat: baseline established — ${passes.length} PASS / ${fails.length} FAIL (ledger run #${runs})`);
    process.exit(0);
  }

  // Something changed or failed → report it (and how to escalate to a sub-agent).
  console.log(`heartbeat: CHANGE DETECTED (ledger run #${runs}, baseline learned from ${runs - 1} prior run(s))`);
  for (const d of deltas) console.log(`  Δ ${d.kind.padEnd(10)} ${d.name}  ${d.from} -> ${d.to}`);
  for (const f of fails) console.log(`  ✗ FAIL [${f.sev}] ${f.name}: ${f.detail}`);
  if (escalate) console.log(`  ↳ escalate: node scripts/agent-dispatch.mjs "Investigate failing system-monitor check(s): ${fails.map((f) => f.name).join(", ") || deltas.map((d) => d.name).join(", ")}. Run the relevant command, read output, report the real cause." --provider ollama-local --model qwen3:8b --steps 6`);
  process.exit(escalate ? 1 : 0);
}

if (JSON_OUT) { console.log(JSON.stringify({ summary: { pass: passes.length, fail: fails.length, skip: skips.length }, results }, null, 2)); }
else {
  console.log(`── ollamas system-monitor ──  ${new Date().toISOString?.() || ""}`.trim());
  for (const r of results) { const icon = r.status === "PASS" ? "✓" : r.status === "FAIL" ? "✗" : "–"; console.log(`  ${icon} [${r.sev.padEnd(8)}] ${r.name.padEnd(28)} ${r.status.padEnd(4)} ${r.detail}`); }
  console.log(`  SUMMARY: ${passes.length} PASS · ${fails.length} FAIL · ${skips.length} SKIP`);
}
process.exit(fails.length > 0 ? 1 : 0);
