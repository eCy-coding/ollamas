#!/usr/bin/env tsx
/**
 * orchestration/bin/fleet-agent.ts — a PERSISTENT, living per-tab worker (never a one-shot).
 *
 * Each Terminal.app / iTerm2 tab runs `fleet-agent.ts <stream> <slot>`. It keeps the tab ALIVE and
 * followable: claim → (local: GPU mutex) → PROPOSE dispatch with ESCALATING budget (steps 8→12→16 and
 * a narrowed single-file scope on retry) → self-gate → on success/BLOCKED it drops into an idle loop
 * that keeps printing a heartbeat so the tab never closes (operator watches live). This fixes the
 * "tab opened then vanished" bug (one-shot wrappers exited → shell closed the window) and gives the
 * hard streams enough budget to actually finish (6/6 completion goal).
 *
 * Reads its model/runtime from FLEET_PLAN.json (single source of truth). Reports to the conductor via
 * ~/.llm-mission-control/fleet/reports/<stream>.<slot>.json (+ live .log). Never touches the repo tree.
 *
 * Run (usually via fleet-launch --go):  tsx orchestration/bin/fleet-agent.ts typescript-core terminal
 */
import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { pullTicket, tryTurn, releaseTurn } from "./lib/gpu-lock";
import { fullJitterDelay, isTransient } from "./lib/backoff";
import { providerFor } from "./lib/chrome-probe";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const TSX = join(REPO, "node_modules", ".bin", "tsx");
const FLEET_HOME = join(homedir(), ".llm-mission-control", "fleet");
const OLLAMAS_URL = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";

const [stream, slot] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!stream || !slot) { console.error("usage: fleet-agent.ts <stream> <slot>"); process.exit(2); }

// Narrowed single-file focus per stream for retry (from docs/CODE_PLAN.md P1 items) — small scope = weak
// models finish. The first attempt is lane-wide; retries focus here so the ReAct loop doesn't wander.
const FOCUS: Record<string, string> = {
  "typescript-core": "server/analyzer.ts — fix tool-implementation validation (entryPoint existence check)",
  "errors-resilience": "server/agent-events.ts — add SSE stream error handling + timeout",
  "concurrency-safety": "server/host-bridge.ts — guard concurrent MCP client connections",
  "mjs-migration": "scripts/agent-dispatch.mjs — add a .ts type-def / migration shim",
  "shell-harden": "start.sh — add set -euo pipefail + required-env guard",
  "test-coverage": "cli/lib/client.ts — add a unit test for HTTP request handling",
};

const reportF = join(FLEET_HOME, "reports", `${stream}.${slot}.json`);
const logF = join(FLEET_HOME, "logs", `${stream}.${slot}.log`);
const root = join(FLEET_HOME, "work", `${stream}.${slot}`);
for (const d of [dirname(reportF), dirname(logF), root]) mkdirSync(d, { recursive: true });
process.env.ORCH_TAB = `fleet-${stream}-${slot}`;

function log(msg: string): void {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`;
  process.stdout.write(line + "\n");
  try { appendFileSync(logF, line + "\n"); } catch { /* best-effort */ }
}
function planFor(): { model: string; runtime: string } | null {
  try {
    const p = JSON.parse(readFileSync(join(ORCH_DIR, "FLEET_PLAN.json"), "utf8"))?.plan;
    const a = (p?.assignments ?? []).find((x: any) => x.stream === stream && x.slot === slot);
    return a?.model ? { model: a.model, runtime: a.runtime } : null;
  } catch { return null; }
}
function claim(lane: string, version: string): boolean {
  try { execFileSync(TSX, [join(HERE, "claim.ts"), lane, version], { stdio: "ignore", timeout: 10000 }); return true; }
  catch { return false; }
}
function releaseClaim(lane: string, version: string): void {
  try { execFileSync(TSX, [join(HERE, "claim.ts"), "--done", lane, version], { stdio: "ignore", timeout: 10000 }); } catch { /* ignore */ }
}
function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

function taskPrompt(attempt: number): string {
  const focus = attempt > 0 && FOCUS[stream] ? `\nFOCUS (narrow scope, attempt ${attempt + 1}): ${FOCUS[stream]}\nRead ONLY that file, then propose.` : "";
  return [
    `You are a PROPOSE-only worker for the ollamas project, stream "${stream}". Repo: ${REPO}. Do NOT edit repo files.${focus}`,
    `Read AT MOST 2 files, then STOP reading. Your FINAL MESSAGE must BE the proposal in this exact shape:`,
    `## Plan: <detect what THIS stream needs, then a 1-line plan of the change you will propose>`,
    `## Change: <one concrete high-value change>`,
    `## Diff: <a short unified diff>`,
    `## Test: <the test that proves it>`,
    `## Next: <precompute — the 1-line NEXT step for this stream after this change lands>`,
    `Then end with: VERDICT: DONE. Plan BEFORE proposing, precompute Next AFTER. Keep under 28 lines. Evidence over prose.`,
  ].join("\n");
}

// Parse a --json report string into {verdict, proposal, steps}. The proposal is the Change/Diff/Test text
// from the model's messages (a PROPOSE run may make ZERO tool steps — the proposal lives in the message).
function parseReport(out: string): { verdict: string; proposal: string; steps: number } {
  const j = JSON.parse(out);
  const msgs = Array.isArray(j.messages) ? j.messages.map(String).join("\n") : "";
  const i = msgs.search(/##\s*Change/i);
  const proposal = i >= 0 ? msgs.slice(i).trim() : "";
  return { verdict: j.verdict ?? "?", proposal, steps: (j.steps ?? []).length };
}

function dispatch(model: string, prompt: string, steps: number, provider: string): { verdict: string; proposal: string; steps: number; err?: string } {
  try {
    const out = execFileSync("node", [
      join(REPO, "scripts", "agent-dispatch.mjs"), prompt,
      "--provider", provider, "--model", model, "--steps", String(steps), "--root", root, "--json",
    ], { encoding: "utf8", timeout: 300_000, env: { ...process.env, OLLAMAS_URL }, maxBuffer: 8 * 1024 * 1024 });
    writeFileSync(reportF, out);
    return parseReport(out);
  } catch (e: any) {
    // ROOT-FIX (vO39): agent-dispatch EXITS 1 whenever the run isn't fully allOk — including a valid DONE
    // run that made ZERO tool steps (a PROPOSE answer is text, not tool calls). execFileSync throws on that
    // non-zero exit, but the JSON report is still on stdout. Parse it before discarding as ERROR.
    const stdout = typeof e?.stdout === "string" ? e.stdout : "";
    if (stdout) {
      try { const r = parseReport(stdout); writeFileSync(reportF, stdout); return r; } catch { /* not JSON → real failure */ }
    }
    const err = String(e?.message ?? e).slice(0, 200);
    try { writeFileSync(reportF, JSON.stringify({ model, verdict: "ERROR", steps: [], error: err })); } catch { /* ignore */ }
    return { verdict: "ERROR", proposal: "", steps: 0, err };
  }
}

// skip-done idempotency: if the sibling slot already produced a gated proposal, this stream is DONE →
// don't grind the GPU redundantly (proven: idempotency + don't over-subscribe). Reads sibling report.
function streamAlreadyGated(): boolean {
  const sib = slot === "terminal" ? "iterm2" : "terminal";
  const f = join(FLEET_HOME, "reports", `${stream}.${sib}.json`);
  if (!existsSync(f)) return false;
  try {
    const j = JSON.parse(readFileSync(f, "utf8"));
    const msgs = Array.isArray(j.messages) ? j.messages.map(String).join("\n") : "";
    return (j.verdict === "DONE" || j.verdict === "OK") && /##\s*Change/i.test(msgs);
  } catch { return false; }
}

async function main(): Promise<void> {
  const p = planFor();
  writeFileSync(logF, "");
  log(`🛰 fleet-agent START · ${stream}/${slot} · ${p?.model ?? "?"} (${p?.runtime ?? "?"})`);
  if (!p) { log("⚠️ no plan assignment — standing by"); return idle("NO-PLAN"); }
  const isLocal = p.runtime === "local";
  const GPU_DIR = join(ORCH_DIR, "seyir");
  const GPU_TTL = 20 * 60 * 1000; // dead-holder liveness (> any single dispatch's 300s)
  const STEPS = [8, 12, 16];
  let status = "PENDING";
  for (let attempt = 0; attempt < STEPS.length; attempt++) {
    // skip-done idempotency: sibling already produced a gated proposal → this stream is DONE, don't grind
    if (streamAlreadyGated()) { log("✅ sibling already gated this stream — skip (no redundant GPU grind)"); status = "DONE-SIBLING"; break; }
    claim(stream, slot); // dedup marker (best-effort)
    // FAIR FIFO GPU access (ticket-lock / bakery) — replaces the unfair claim-retry mutex that starved
    let ticket = -1;
    if (isLocal) {
      ticket = pullTicket(GPU_DIR);
      log(`… GPU queue: ticket ${ticket} (FIFO, starvation-free)`);
      while (!tryTurn(GPU_DIR, ticket, process.env.ORCH_TAB!, Date.now(), GPU_TTL)) {
        if (streamAlreadyGated()) { releaseTurn(GPU_DIR, ticket); log("✅ sibling gated while queued — leave queue"); status = "DONE-SIBLING"; break; }
        await sleep(3000);
      }
      if (status === "DONE-SIBLING") { releaseClaim(stream, slot); break; }
      log(`🔓 GPU acquired (ticket ${ticket})`);
    }
    log(`▶ attempt ${attempt + 1}/${STEPS.length} · ${p.model} · steps ${STEPS[attempt]}${attempt > 0 ? " · narrowed scope" : ""}`);
    // ROOT-FIX (vO39): route by the model's provider — a cloud tag (…-cloud) MUST use ollama-cloud, not the
    // hardcoded ollama-local (which the local daemon can't serve → every cloud slot silently ERROR'd).
    const r = dispatch(p.model, taskPrompt(attempt), STEPS[attempt], providerFor(p.model));
    if (isLocal) releaseTurn(GPU_DIR, ticket);
    releaseClaim(stream, slot);
    const gated = (r.verdict === "DONE" || r.verdict === "OK") && /##\s*Change/i.test(r.proposal);
    log(`↳ verdict=${r.verdict} steps=${r.steps} proposal=${r.proposal ? r.proposal.length + "c" : "none"} → ${gated ? "✅ GATED" : "not gated"}`);
    if (gated) { status = "DONE"; break; }
    if (attempt === STEPS.length - 1) { status = "BLOCKED"; break; }
    // PROVEN backoff: on a transient error, wait full-jitter delay before retry (let server recover, no herd)
    if (r.verdict === "ERROR" && isTransient(r.err)) {
      const d = fullJitterDelay(attempt, 2000, 60_000);
      log(`transient error → backoff ${(d / 1000).toFixed(1)}s (full-jitter) then retry`);
      await sleep(d);
    } else { log("retry with more budget + narrower scope…"); await sleep(1500); }
  }
  log(status.startsWith("DONE") ? "✅ STREAM COMPLETE — standing by (live)" : "⚠️ BLOCKED after escalation — standing by (live)");
  return idle(status);
}

/** Never exit: keep the tab alive + followable with a periodic heartbeat. */
async function idle(status: string): Promise<void> {
  const HB = Math.max(10, Number(process.env.FLEET_AGENT_HEARTBEAT_SEC || 30)) * 1000;
  // eslint-disable-next-line no-constant-condition
  while (true) { log(`💤 ${stream}/${slot} ${status} · standing by (conductor may re-task) · tail: ${logF}`); await sleep(HB); }
}

main();
