#!/usr/bin/env tsx
/**
 * orchestration/bin/orchestra.ts — the autonomous local-model conductor daemon: the DEFAULT $0 self-healing
 * FSM loop (JUstdoit STEP 1-10 + Emre 4-step). Runs on Ollama alone; the opt-in escalation that hands a
 * requirement to a Claude Code session is claude-dispatch.ts (marker-gated) — this file is its $0 replacement.
 *
 * The thin IO shell around the pure FSM core (lib/orchestra-fsm.ts) — same split as conduct.ts (CLI) +
 * lib/conduct (pure). A LOCAL benchmark-picked model conducts; NO Claude Code, NO cloud API required. Each
 * tick: (1) health-gate the conductor → live joker failover (lib/joker), (2) OBSERVE read-only signals from
 * the existing tools (conduct/fleet-conduct), (3) run the current phase's bounded side-effect, (4) advance the
 * pure FSM, (5) persist resumable state to ~/.ollamas/orchestra.json. Never exits on a child failure — a
 * timed-out/ crashed child degrades to a neutral signal so the daemon stays alive (self-sustaining).
 *
 * Run:
 *   tsx orchestration/bin/orchestra.ts --once            # one FSM tick, print status, persist
 *   tsx orchestration/bin/orchestra.ts --watch 600       # persistent daemon, tick every 600s (never exits)
 *   tsx orchestration/bin/orchestra.ts "fix cli flag X"  # enqueue a task (FIFO) → REPAIR routes it to a model
 *   tsx orchestration/bin/orchestra.ts --status          # print current state, no tick
 *
 * Safety: DEPLOYMENT auto-apply/commit is OFF unless ORCHESTRA_APPLY=1 (outward-facing = operator decision).
 * Test seams (hermetic, honest): ORCHESTRA_DRY=1 skips all spawns/network; ORCHESTRA_FAKE_HEALTHY=0/1,
 * ORCHESTRA_FAKE_TIER=RED, ORCHESTRA_FAKE_CONVERGED=1, ORCHESTRA_FAKE_HEALTHY_MODELS=a,b force signals.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  emptyOrchestraState, normalizeState, nextPhase, bumpRetry, shouldResetRetry, pruneHistory,
  enqueueTask, dequeueTask, statusLine, isBlocking, type OrchestraState, type PhaseInput,
} from "./lib/orchestra-fsm";
import { resolveConductor, maybeFailover, DEFAULT_JOKER } from "./lib/joker";
import { chatOnce, listModels } from "./lib/ollama-client";
import type { Tier } from "./lib/conduct";
import { FOCUS, focusFile, groundedPrompt } from "./lib/fleet-prompt";
import { hasSearchReplace } from "./lib/search-replace";
import { orderStreams, proposalHeader, applyToken, ORCHESTRA_SLOT } from "./lib/orchestra-repair";
import { resolveTask, type Task } from "./lib/task-catalog";
import { nextPending, mark, summary, laneSummary, type Progress } from "./lib/task-progress";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const STATE_DIR = process.env.ORCHESTRA_STATE_DIR || join(homedir(), ".ollamas");
const STATE = join(STATE_DIR, "orchestra.json");
const LOG = join(STATE_DIR, "orchestra.log");
const TSX = join(REPO, "node_modules", ".bin", "tsx");
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";
const FLEET_WORK = join(homedir(), ".llm-mission-control", "fleet", "work"); // where fleet-apply triages proposals
const PROGRESS = join(STATE_DIR, "tasks-progress.json"); // completion ledger (iter-8)

const DRY = process.env.ORCHESTRA_DRY === "1";
// Autonomous gated apply (0-manual): the env flag OR the opt-in marker `.orchestra-apply-enabled` (mirrors
// claude-dispatch's `.claude-dispatch-enabled` safety pattern) — so the persistent daemon closes fixes
// without a per-invocation env. Still gated (tsc+tests, revert-on-red) and never auto-commits.
const APPLY = process.env.ORCHESTRA_APPLY === "1" || existsSync(join(ORCH_DIR, ".orchestra-apply-enabled"));
// Autonomous backlog-drain (iter-8): when idle, auto-pull the next PENDING catalog task so the daemon works
// through the whole project 0-manual. Opt-in marker (mirrors apply) — off by default → reactive to `ollamas do`.
const AUTODRAIN = process.env.ORCHESTRA_AUTODRAIN === "1" || existsSync(join(ORCH_DIR, ".orchestra-autodrain-enabled"));
const CHILD_MS = Number(process.env.ORCHESTRA_CHILD_MS || 25_000);
const PROBE_MS = Number(process.env.ORCHESTRA_PROBE_MS || 12_000);

// ── IO primitives (all tolerant — the loop must never die on a child/network failure) ────────────────
function readJson(p: string): unknown { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }

function log(line: string): void {
  const stamped = `[${new Date().toISOString()}] ${line}`;
  try { mkdirSync(STATE_DIR, { recursive: true }); appendFileSync(LOG, stamped + "\n"); } catch { /* best-effort */ }
  process.stdout.write(stamped + "\n");
}

/** Atomic state persist (tmp + rename) so a crash mid-write never corrupts orchestra.json. */
function saveState(state: OrchestraState): void {
  mkdirSync(STATE_DIR, { recursive: true });
  const tmp = STATE + ".tmp";
  writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  renameSync(tmp, STATE);
}

function loadState(conductor: string): OrchestraState {
  if (!existsSync(STATE)) return emptyOrchestraState(conductor);
  return normalizeState(readJson(STATE), conductor);
}

/** Run a sibling orchestration script with --json, bounded; return parsed JSON or null on ANY failure. */
function runChildJson(script: string, args: string[], timeoutMs = CHILD_MS): unknown {
  if (DRY) return null;
  try {
    const out = execFileSync(TSX, [join(HERE, script), ...args], {
      encoding: "utf8", timeout: timeoutMs, stdio: ["ignore", "pipe", "ignore"], cwd: REPO,
    });
    try { return JSON.parse(out); } catch { /* fall through to brace-slice */ }
    const a = out.indexOf("{"), b = out.lastIndexOf("}");
    return a >= 0 && b > a ? JSON.parse(out.slice(a, b + 1)) : null;
  } catch { return null; } // ETIMEDOUT / non-zero exit / unparseable → neutral signal (stay alive)
}

// ── Health + observation ─────────────────────────────────────────────────────────────────────────────
/** Live conductor health: model present in `ollama list` AND answers a 1-token turn within PROBE_MS. */
async function probeHealth(model: string): Promise<{ healthy: boolean; healthyModels: string[] }> {
  if (DRY || process.env.ORCHESTRA_FAKE_HEALTHY != null) {
    const healthy = process.env.ORCHESTRA_FAKE_HEALTHY !== "0";
    const raw = process.env.ORCHESTRA_FAKE_HEALTHY_MODELS; // "" (present) means "no healthy models", NOT unset
    const hm = (raw != null ? raw : healthy ? model : DEFAULT_JOKER).split(",").map((s) => s.trim()).filter(Boolean);
    return { healthy, healthyModels: hm };
  }
  const models = await listModels(OLLAMA_HOST);
  if (!models.includes(model)) return { healthy: false, healthyModels: models };
  try {
    const r = await chatOnce(model, "", "ok", { host: OLLAMA_HOST, timeoutMs: PROBE_MS, num_ctx: 512 });
    return { healthy: r.text.trim().length > 0, healthyModels: models };
  } catch { return { healthy: false, healthyModels: models }; }
}

function fakeOr<T>(env: string, real: T, map: (v: string) => T): T {
  const v = process.env[env];
  return v != null ? map(v) : real;
}

/** OBSERVE read-only signals from the existing conductor tools. Bounded + tolerant. */
function observe(): { actionTier: Tier | null; converged: boolean } {
  const conduct = runChildJson("conduct.ts", ["--json"]) as { action?: { tier?: string } | null } | null;
  const fleet = runChildJson("fleet-conduct.ts", ["--json"], 15_000) as { converged?: boolean } | null;
  const actionTier = fakeOr<Tier | null>("ORCHESTRA_FAKE_TIER",
    (conduct?.action?.tier as Tier | undefined) ?? null, (v) => (v ? (v as Tier) : null));
  const converged = fakeOr<boolean>("ORCHESTRA_FAKE_CONVERGED", Boolean(fleet?.converged), (v) => v === "1");
  return { actionTier, converged };
}

// ── Phase side-effects (bounded, best-effort; the local model does the work — $0, no Claude Code) ─────
/**
 * REPAIR (JUstdoit STEP 4, surgical): the conductor acts as a fleet worker. Ground the local model on a
 * stream's focus file → get a SEARCH/REPLACE proposal → write it to the fleet work-dir as an ordinary
 * `<stream>.orchestra/PROPOSAL.md`. With ORCHESTRA_APPLY=1 it is then gated + applied via `fleet-apply.ts
 * --apply` (tsc + tests; reverted on red — the tree is never left broken). $0, local, no Claude Code.
 */
/** Load the task catalog (TASKS.json, count-agnostic; legacy TASKS_100.json fallback). Empty on failure. */
function loadCatalog(): Task[] {
  const c = readJson(join(ORCH_DIR, "TASKS.json")) ?? readJson(join(ORCH_DIR, "TASKS_100.json"));
  return Array.isArray(c) ? (c as Task[]) : [];
}

/** Completion ledger IO (iter-8). Malformed → empty (every task defaults to pending). */
function loadProgress(): Progress {
  const p = readJson(PROGRESS);
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Progress) : {};
}
function saveProgress(p: Progress): void {
  try { mkdirSync(STATE_DIR, { recursive: true }); writeFileSync(PROGRESS, JSON.stringify(p, null, 2) + "\n"); } catch { /* best-effort */ }
}

async function repairPropose(state: OrchestraState): Promise<void> {
  // Resolve the target: (1) the 100-task catalog (task's OWN real target + goal), else (2) a FOCUS stream.
  let slot = "", target = "", content = "", goalText = "", catalogId = "";
  const task = resolveTask(state.current_task ?? "", loadCatalog());
  if (task && existsSync(join(REPO, task.target))) {
    slot = task.id; target = task.target; goalText = task.goal; content = readFileSync(join(REPO, task.target), "utf8");
    catalogId = task.id; // ledger only tracks catalog tasks (iter-8)
  } else {
    for (const s of orderStreams(state.current_task, Object.keys(FOCUS))) {
      const tf = focusFile(s), abs = join(REPO, tf);
      if (tf && existsSync(abs)) { slot = s; target = tf; goalText = FOCUS[s] ?? ""; content = readFileSync(abs, "utf8"); break; }
    }
  }
  if (!slot) { log("  ↳ REPAIR: no grounded target (catalog/FOCUS) — skip"); return; }
  if (DRY) { log(`  ↳ REPAIR (dry): would ground ${state.conductor_model} on ${slot} (${target})`); return; }

  try {
    const prompt = groundedPrompt(goalText, target, content);
    const r = await chatOnce(state.conductor_model, "", prompt, { host: OLLAMA_HOST, timeoutMs: CHILD_MS, num_ctx: 8192 });
    if (!hasSearchReplace(r.text)) { log(`  ↳ REPAIR: ${state.conductor_model} → no actionable SEARCH/REPLACE (retry next tick)`); return; }
    const dir = join(FLEET_WORK, `${slot}.${ORCHESTRA_SLOT}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "PROPOSAL.md"), `${proposalHeader(slot, state.conductor_model)}\n\n${r.text}\n`);
    if (catalogId) saveProgress(mark(loadProgress(), catalogId, "proposed"));
    log(`  ↳ REPAIR: ${state.conductor_model} → ${slot}.${ORCHESTRA_SLOT} PROPOSAL (${r.tokS.toFixed(0)} tok/s)`);
    if (APPLY) {
      try {
        const out = execFileSync(TSX, [join(HERE, "fleet-apply.ts"), "--apply", applyToken(slot)], { encoding: "utf8", timeout: CHILD_MS * 4, cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
        if (catalogId) saveProgress(mark(loadProgress(), catalogId, "done")); // gated apply landed green → done
        log(`  ↳ fleet-apply: ${(out.trim().split("\n").pop() || "applied").slice(0, 100)}`);
      } catch (e) { log(`  ↳ fleet-apply: gate red → reverted (${(e as Error).message.slice(0, 60)})`); }
    }
  } catch (e) { log(`  ↳ REPAIR: dispatch failed (${(e as Error).message.slice(0, 80)}) — will retry`); }
}

/** G2: last council verdict. Only an EXPLICIT HOLD holds; missing/EXECUTE → proceed (never stall the loop). */
function councilDecision(): "EXECUTE" | "HOLD" {
  const fake = process.env.ORCHESTRA_FAKE_DECISION;
  if (fake === "EXECUTE" || fake === "HOLD") return fake;
  const c = readJson(join(ORCH_DIR, "COUNCIL.json")) as { summary?: { decision?: string } } | null;
  return c?.summary?.decision === "HOLD" ? "HOLD" : "EXECUTE";
}

async function runPhaseSideEffect(state: OrchestraState): Promise<void> {
  switch (state.phase) {
    case "BOOTSTRAPPING":
      if (!DRY) await chatOnce(DEFAULT_JOKER, "", "ok", { host: OLLAMA_HOST, timeoutMs: PROBE_MS, num_ctx: 512 }).catch(() => {});
      break; // keep the joker warm for sub-second failover
    case "REPAIR":
      await repairPropose(state);
      break;
    case "DEPLOYMENT":
      if (APPLY && !DRY) { try { execFileSync(TSX, [join(HERE, "gate.ts")], { stdio: "ignore", timeout: CHILD_MS, cwd: REPO }); log("  ↳ DEPLOYMENT: gate ran (ORCHESTRA_APPLY=1)"); } catch { log("  ↳ DEPLOYMENT: gate failed — hold"); } }
      else log("  ↳ DEPLOYMENT: apply OFF (set ORCHESTRA_APPLY=1 to gate+commit)");
      break;
    default:
      break; // COUNCIL_DEBATE / BENCHMARK_VALIDATION are pure-observe; MONITORING/ESCALATE idle-hold
  }
}

// ── One FSM tick ──────────────────────────────────────────────────────────────────────────────────────
/** Conductor model: env override (test/pin seam) else the benchmark pick from MODEL_SELECTION.json. */
function conductorModel(): string {
  return process.env.ORCHESTRA_CONDUCTOR || resolveConductor(readJson(join(ORCH_DIR, "MODEL_SELECTION.json")));
}

async function tick(): Promise<OrchestraState> {
  const roster = readJson(join(ORCH_DIR, "COUNCIL_ROSTER.json"));
  const conductor = conductorModel();
  let state = loadState(conductor);
  const ts = new Date().toISOString();

  // 1) HEALTH GATE → live joker failover (JUstdoit STEP 5).
  const { healthy, healthyModels } = await probeHealth(state.conductor_model);
  const fo = maybeFailover(state, healthy, healthyModels, ts, roster);
  state = fo.state;
  if (fo.swapped) log(`⚠ FAILOVER: conductor down → joker=${fo.joker} (failover #${state.failover_count})`);

  // 2) OBSERVE read-only signals.
  const { actionTier, converged } = observe();
  const hasTask = state.pending_actions.length > 0 || !!state.current_task;

  // 3) SIDE-EFFECT for the current phase (bounded, best-effort).
  await runPhaseSideEffect(state);

  // 4) ADVANCE the pure FSM. Retry is bumped on each REPAIR re-entry; reset on deploy/new-council.
  let retryExceeded = false;
  if (state.phase === "REPAIR") { const b = bumpRetry(state.retry_count); state.retry_count = b.retry_count; retryExceeded = b.exceeded; }
  const input: PhaseInput = { phase: state.phase, actionTier, hasTask, converged, retryExceeded };
  let next = nextPhase(input);
  // G2 (STEP 2 wiring): leaving COUNCIL_DEBATE with an explicit council HOLD and nothing forcing work
  // (no queued task, no blocking signal) → hold at MONITORING instead of burning a repair on no-consensus.
  if (state.phase === "COUNCIL_DEBATE" && !hasTask && !isBlocking(actionTier) && councilDecision() === "HOLD") {
    log(`  ↳ council HOLD (uzlaşı yok) → MONITORING (repair yakma)`);
    next = "MONITORING";
  }
  // I2 (iter-8): autonomous backlog-drain — idle + AUTODRAIN marker → pull the next PENDING catalog task so the
  // daemon works through the whole project 0-manual. Reopens the loop this same tick (dequeued below).
  if (next === "MONITORING" && !hasTask && AUTODRAIN) {
    const cat = loadCatalog();
    const t = nextPending(cat, loadProgress());
    if (t) { state = enqueueTask(state, t.id); next = "COUNCIL_DEBATE"; const s = summary(cat, loadProgress()); log(`↻ auto-drain: ${t.id} (done ${s.done}/${s.total})`); }
  }
  if (shouldResetRetry(next)) state.retry_count = 0;
  if (next === "COUNCIL_DEBATE" && state.pending_actions.length) state = dequeueTask(state);
  state.history = pruneHistory(state.history, { ts, phase: next, note: `action=${actionTier ?? "clean"}${isBlocking(actionTier) ? "!" : ""} conv=${converged ? 1 : 0}` });
  state = { ...state, phase: next };

  // 5) PERSIST + report.
  saveState(state);
  log(statusLine(state));
  return state;
}

// ── CLI ───────────────────────────────────────────────────────────────────────────────────────────────
function enqueueCli(task: string): void {
  const state = enqueueTask(loadState(conductorModel()), task);
  saveState(state);
  log(`＋ enqueued: "${task}" (queue=${state.pending_actions.length})`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--status")) {
    process.stdout.write(statusLine(loadState(conductorModel())) + "\n");
    return;
  }
  if (argv.includes("--progress")) {
    const cat = loadCatalog(), prog = loadProgress(), s = summary(cat, prog);
    process.stdout.write(`📊 tamamlama: done ${s.done}/${s.total} · proposed ${s.proposed} · pending ${s.pending}\n`);
    for (const l of laneSummary(cat, prog)) process.stdout.write(`  ${l.lane.padEnd(14)} ${l.done}/${l.total}\n`);
    return;
  }
  if (argv.includes("--tasks")) {
    const cat = loadCatalog();
    process.stdout.write(`🗂  ${cat.length} kritik görev (ollamas do "<id>"):\n`);
    for (const t of cat) process.stdout.write(`  ${t.id.padEnd(34)} ${t.goal}\n`);
    return;
  }
  const watchIdx = argv.indexOf("--watch");
  const positional = argv.find((a) => !a.startsWith("--")) && !argv.includes("--once") && watchIdx < 0
    ? argv.filter((a) => !a.startsWith("--")).join(" ")
    : "";
  if (positional) { enqueueCli(positional); return; }

  if (watchIdx >= 0) {
    const sec = Number(argv[watchIdx + 1] || 600) || 600;
    log(`🎼 orchestra daemon açık (persistent) · her ${sec}s tick · Ctrl-C ile çık · state=${STATE}`);
    // never-exit loop: each tick is fully guarded, so a crash in one tick can't kill the daemon.
    for (;;) {
      try { await tick(); } catch (e) { log(`tick error (survived): ${(e as Error).message.slice(0, 120)}`); }
      await new Promise((r) => setTimeout(r, sec * 1000));
    }
  }

  // default / --once: single tick.
  await tick();
}

if (process.argv[1] && /orchestra\.ts$/.test(process.argv[1])) {
  main().catch((e) => { log(`fatal: ${(e as Error)?.message ?? e}`); process.exit(1); });
}
