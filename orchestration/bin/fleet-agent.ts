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
import { dispatchTarget } from "./lib/chrome-probe";
import { geminiArgs, parseGeminiJson, isGeminiOverload, isGeminiQuotaExhausted } from "./lib/gemini";
import { focusFile as focusFileFor, streamTaskPrompt, geminiGroundedPrompt } from "./lib/fleet-prompt";
import { guardQuota, noteOutcome } from "./lib/gemini-quota";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const TSX = join(REPO, "node_modules", ".bin", "tsx");
const FLEET_HOME = join(homedir(), ".llm-mission-control", "fleet");
const QUOTA_FILE = join(homedir(), ".llm-mission-control", "gemini-quota.json");
const OLLAMAS_URL = process.env.OLLAMAS_URL || "http://127.0.0.1:3000";

const [stream, slot] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
if (!stream || !slot) { console.error("usage: fleet-agent.ts <stream> <slot>"); process.exit(2); }

// FOCUS map + prompt shapes live in bin/lib/fleet-prompt.ts (shared with the gemini vendor path).

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

// Parse a --json report string into {verdict, proposal, steps}. The proposal is the Change/Diff/Test text
// from the model's messages (a PROPOSE run may make ZERO tool steps — the proposal lives in the message).
function parseReport(out: string): { verdict: string; proposal: string; steps: number } {
  const j = JSON.parse(out);
  const msgs = Array.isArray(j.messages) ? j.messages.map(String).join("\n") : "";
  const i = msgs.search(/##\s*Change/i);
  const proposal = i >= 0 ? msgs.slice(i).trim() : "";
  return { verdict: j.verdict ?? "?", proposal, steps: (j.steps ?? []).length };
}

/** Dispatch to the Gemini CLI (read-only `--approval-mode plan` → PROPOSE-safe). Retries transient 503/overload
 *  with backoff and falls back to `gemini-2.5-flash` (the requested model may be demand-throttled). Writes an
 *  agent-dispatch-compatible report so the conduct pipeline is unchanged. */
function geminiDispatch(model: string, prompt: string): { verdict: string; proposal: string; steps: number; err?: string } {
  const FLASH = "gemini-2.5-flash";
  // Grounded prompt: inline the focus file's content so Gemini copies EXACT lines into SEARCH (deterministic,
  // resolvable — proven to beat relying on the model's own read). Falls back to the read_file prompt.
  const target = focusFileFor(stream);
  let effective = prompt;
  try { const abs = join(REPO, target); if (target && existsSync(abs)) effective = geminiGroundedPrompt(stream, target, readFileSync(abs, "utf8")); } catch { /* keep prompt */ }
  // Pre-flight quota gate: skip the doomed call entirely when today's free-tier budget is spent.
  const guard = guardQuota(QUOTA_FILE);
  if (!guard.allowed) { try { writeFileSync(reportF, JSON.stringify({ model, verdict: "ERROR", steps: [], error: guard.msg })); } catch { /* ignore */ } return { verdict: "ERROR", proposal: "", steps: 0, err: guard.msg }; }
  let lastErr = "";
  for (let attempt = 0; attempt < 4; attempt++) {
    const m = attempt < 2 ? model : FLASH; // requested model first, then fall back to the available flash tier
    try {
      const out = execFileSync("gemini", geminiArgs(effective, m), {
        encoding: "utf8", timeout: 300_000, maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, GEMINI_CLI_TRUST_WORKSPACE: "true" },
      });
      const g = parseGeminiJson(out);
      if (g.ok) { noteOutcome(QUOTA_FILE, "success"); const j = JSON.stringify({ model: m, verdict: "DONE", messages: [g.text], steps: [] }); writeFileSync(reportF, j); return parseReport(j); }
      lastErr = "empty gemini response";
    } catch (e: any) {
      const blob = `${e?.stdout ?? ""}${e?.stderr ?? ""}${e?.message ?? ""}`;
      lastErr = blob.slice(0, 200);
      if (isGeminiQuotaExhausted(blob)) { noteOutcome(QUOTA_FILE, "exhausted"); break; } // latch the day
      if (!isGeminiOverload(blob)) break; // non-transient → stop
    }
    try { execFileSync("sleep", [String(Math.min(8, 2 ** attempt))]); } catch { /* best-effort backoff */ }
  }
  try { writeFileSync(reportF, JSON.stringify({ model, verdict: "ERROR", steps: [], error: lastErr })); } catch { /* ignore */ }
  return { verdict: "ERROR", proposal: "", steps: 0, err: lastErr };
}

function dispatch(model: string, prompt: string, steps: number, provider: string): { verdict: string; proposal: string; steps: number; err?: string } {
  if (provider === "gemini-cli") return geminiDispatch(model, prompt);
  try {
    const out = execFileSync("node", [
      join(REPO, "scripts", "agent-dispatch.mjs"), prompt,
      "--provider", provider, "--model", model, "--steps", String(steps), "--root", root, "--no-apply", "--json",
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
    // T2-F3: `provider::model` API workers dispatch with the BARE model + their catalog provider.
    const target = dispatchTarget(p.model);
    const r = dispatch(target.model, streamTaskPrompt(stream), STEPS[attempt], target.provider);
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
