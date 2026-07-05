#!/usr/bin/env tsx
/**
 * orchestration/bin/orchestra.ts — the Claude-Code-FREE $0 conductor loop (JUstdoit STEP 1-10 + Emre 4-step).
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

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const STATE_DIR = process.env.ORCHESTRA_STATE_DIR || join(homedir(), ".ollamas");
const STATE = join(STATE_DIR, "orchestra.json");
const LOG = join(STATE_DIR, "orchestra.log");
const TSX = join(REPO, "node_modules", ".bin", "tsx");
const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://127.0.0.1:11434";

const DRY = process.env.ORCHESTRA_DRY === "1";
const APPLY = process.env.ORCHESTRA_APPLY === "1";
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
async function repairPropose(state: OrchestraState): Promise<void> {
  const task = state.current_task || "resolve the top conduct.ts finding (root cause, minimal diff)";
  if (DRY) { log(`  ↳ REPAIR (dry): would dispatch "${task}" → ${state.conductor_model}`); return; }
  try {
    const sys = "You are the ollamas repair conductor. Output ONLY a concrete minimal fix plan: root cause + the exact file(s)/diff sketch. No prose, no greetings.";
    const r = await chatOnce(state.conductor_model, sys, task, { host: OLLAMA_HOST, timeoutMs: CHILD_MS, num_ctx: 8192 });
    const dir = join(STATE_DIR, "orchestra-proposals");
    mkdirSync(dir, { recursive: true });
    const f = join(dir, `${new Date().toISOString().replace(/[:.]/g, "-")}.md`);
    writeFileSync(f, `# REPAIR proposal (${state.conductor_model})\n\ntask: ${task}\n\n${r.text}\n`);
    log(`  ↳ REPAIR: ${state.conductor_model} proposed (${r.tokS.toFixed(0)} tok/s) → ${f}`);
  } catch (e) { log(`  ↳ REPAIR: dispatch failed (${(e as Error).message.slice(0, 80)}) — will retry`); }
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
async function tick(): Promise<OrchestraState> {
  const modelSelection = readJson(join(ORCH_DIR, "MODEL_SELECTION.json"));
  const roster = readJson(join(ORCH_DIR, "COUNCIL_ROSTER.json"));
  const conductor = resolveConductor(modelSelection);
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
  const next = nextPhase(input);
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
  const conductor = resolveConductor(readJson(join(ORCH_DIR, "MODEL_SELECTION.json")));
  const state = enqueueTask(loadState(conductor), task);
  saveState(state);
  log(`＋ enqueued: "${task}" (queue=${state.pending_actions.length})`);
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.includes("--status")) {
    const conductor = resolveConductor(readJson(join(ORCH_DIR, "MODEL_SELECTION.json")));
    process.stdout.write(statusLine(loadState(conductor)) + "\n");
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
