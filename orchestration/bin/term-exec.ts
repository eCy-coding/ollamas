#!/usr/bin/env tsx
/**
 * orchestration/bin/term-exec.ts — run a bash / Apple-terminal command in a REAL, visible Terminal.app or
 * iTerm2 window on the host and capture its output + exit code, via the ollamas host bridge (/run). This is
 * the operator's first-class, deterministic "run this in a terminal" entry — the capability the privileged
 * macos_terminal tool exposes to models, made directly usable on any request + self-verifying (--check).
 *
 * Auth: the bridge's own token (~/.llm-mission-control/bridge.token → x-bridge-token). Bridge binds loopback
 * only. Operator running commands on their OWN Mac — not a new attack surface. Kill the bridge to revoke.
 *
 * Run:  tsx orchestration/bin/term-exec.ts "<command>" [--target iterm2|terminal] [--json]
 *       tsx orchestration/bin/term-exec.ts --check            # verify the capability end-to-end
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { buildRunRequest, parseRunResult, classifyCapability, type TermTarget, type RunResult } from "./lib/term-exec";

const argv = process.argv.slice(2);
const flag = (n: string, d?: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const JSON_OUT = argv.includes("--json");
const DRY = argv.includes("--dry");
const CHECK = argv.includes("--check");
const TARGET = (flag("--target", "iterm2") as TermTarget);
const TIMEOUT = Number(flag("--timeout", "60000"));
const command = argv.find((a, i) => !a.startsWith("--") && (i === 0 || !argv[i - 1].startsWith("--")));

const STATE = join(homedir(), ".llm-mission-control");
const TOKEN_FILE = join(STATE, "bridge.token");
const BRIDGE_CANDIDATES = [process.env.HOST_BRIDGE_URL, "http://127.0.0.1:7345"].filter(Boolean) as string[];

function token(): string {
  try { return existsSync(TOKEN_FILE) ? readFileSync(TOKEN_FILE, "utf8").trim() : ""; } catch { return ""; }
}

/** Find the reachable bridge base (GET /health). Returns {base, health} or null when unreachable. */
async function resolveBridge(): Promise<{ base: string; health: any } | null> {
  for (const base of BRIDGE_CANDIDATES) {
    try {
      const res = await fetch(`${base.replace(/\/+$/, "")}/health`, { signal: AbortSignal.timeout(2500) });
      if (res.ok) return { base: base.replace(/\/+$/, ""), health: await res.json() };
    } catch { /* try next */ }
  }
  return null;
}

/** POST /run and parse the result (never throws). */
async function run(base: string, cmd: string, target: TermTarget, timeoutMs: number): Promise<RunResult> {
  const req = buildRunRequest(base, token(), cmd, target, timeoutMs);
  try {
    const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(timeoutMs + 8000) });
    return parseRunResult(await res.text());
  } catch (e: any) {
    return parseRunResult(JSON.stringify({ ok: false, error: `bridge request failed: ${(e?.message ?? e).toString().slice(0, 80)}` }));
  }
}

async function main(): Promise<void> {
  const bridge = await resolveBridge();
  if (!bridge) {
    console.error(`term-exec: host bridge unreachable (${BRIDGE_CANDIDATES.join(", ")}). Start it: bash bin/host-bridge/start-bridge.sh`);
    process.exit(3);
  }

  if (CHECK) {
    const probe = DRY ? null : await run(bridge.base, 'echo ollamas-term-ok; whoami; sw_vers -productVersion', TARGET, 20000);
    const cap = classifyCapability(bridge.health, probe);
    if (JSON_OUT) { console.log(JSON.stringify({ base: bridge.base, health: bridge.health, probe, cap }, null, 2)); process.exit(cap.granted ? 0 : 1); }
    console.log(`TERMINAL-EXEC YETKİSİ — ${cap.granted ? "✅ GRANTED (ollamas terminal/bash komutu koşabilir)" : "⚠️ NOT GRANTED"}`);
    console.log(`  terminals: iterm2=${cap.iterm2 ? "✅" : "—"} terminal=${cap.terminal ? "✅" : "—"} · ${cap.detail}`);
    if (probe) console.log(`  probe: exit ${probe.exitCode} · ${probe.durationMs}ms\n  ── output ──\n${probe.output.trim().split("\n").map((l) => "  " + l).join("\n")}`);
    process.exit(cap.granted ? 0 : 1);
  }

  if (!command) {
    console.error('usage: term-exec "<command>" [--target iterm2|terminal] [--json] | term-exec --check');
    process.exit(2);
  }

  if (DRY) { console.log(`[dry] would run in ${TARGET}: ${command}`); return; }

  const r = await run(bridge.base, command, TARGET, TIMEOUT);
  if (JSON_OUT) { console.log(JSON.stringify(r, null, 2)); process.exit(r.ok && r.exitCode === 0 ? 0 : 1); }
  if (r.error) { console.error(`✗ ${r.error}${r.hint ? ` (${r.hint})` : ""}`); process.exit(1); }
  process.stdout.write(r.output.endsWith("\n") || !r.output ? r.output : r.output + "\n");
  console.error(`── ${TARGET} · exit ${r.exitCode}${r.timedOut ? " (TIMED OUT)" : ""} · ${r.durationMs}ms`);
  process.exit(r.timedOut ? 124 : (r.exitCode ?? 1)); // mirror the command's exit code
}

main().catch((e) => { console.error(`term-exec: ${e?.message ?? e}`); process.exit(1); });
