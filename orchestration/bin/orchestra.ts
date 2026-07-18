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
import { nextPending, mark, summary, laneSummary, statusOf, type Progress } from "./lib/task-progress";
import { assignRole, consultErrors, faultsAsRules, recordOutcome, type TaskSpec } from "./lib/organization";
import { loadOrgChart, loadPreventionRules, nextErrorSeq, proposeErrorEntry } from "./lib/org-io";
import { remember, recall } from "./lib/brain-ledger";
import { statsFromPolicy, type OrgPolicy } from "./lib/org-learn";
import { emitEvent, resetRun } from "./lib/tracker-io";
import type { ItemStatus } from "./lib/task-tracker";

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
// Marker/flag resolution: an explicit env var (0 or 1) WINS both directions (so tests are hermetic regardless
// of the on-disk marker); absent env → fall back to the opt-in marker file. (Prev: `env==='1' || marker` let a
// real marker leak into env=0 test runs.)
const flagOn = (env: string | undefined, markerFile: string): boolean =>
  env != null ? env === "1" : existsSync(join(ORCH_DIR, markerFile));
const APPLY = flagOn(process.env.ORCHESTRA_APPLY, ".orchestra-apply-enabled");
// Autonomous backlog-drain (iter-8): when idle, auto-pull the next PENDING catalog task so the daemon works
// through the whole project 0-manual. Opt-in marker (mirrors apply) — off by default → reactive to `ollamas do`.
const AUTODRAIN = flagOn(process.env.ORCHESTRA_AUTODRAIN, ".orchestra-autodrain-enabled");
const CHILD_MS = Number(process.env.ORCHESTRA_CHILD_MS || 25_000);   // bounded read-only child scripts (conduct/fleet-conduct)
const PROBE_MS = Number(process.env.ORCHESTRA_PROBE_MS || 45_000);   // health probe / warm (1-token) — a 30b COLD-loads >12s between ticks; too-short = false-down → failover thrash
const REPAIR_MS = Number(process.env.ORCHESTRA_REPAIR_MS || 120_000); // REPAIR model GENERATION (grounded SEARCH/REPLACE — a 30b needs >25s)

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
/**
 * Conductor health = the ollama daemon is REACHABLE (models listed) AND the conductor model is INSTALLED.
 * We deliberately do NOT require a live generation: a slow/cold-loading model is not "down", and a REPAIR
 * generation that times out is handled by the bounded retry — NOT a conductor death. Requiring a 1-token
 * generation here caused chronic false-down failover thrash under load (server + ollama + daemon competing).
 * Failover now fires only on a REAL failure: ollama unreachable (empty list) or the model uninstalled/OOM-evicted.
 */
async function probeHealth(model: string): Promise<{ healthy: boolean; healthyModels: string[] }> {
  if (DRY || process.env.ORCHESTRA_FAKE_HEALTHY != null) {
    const healthy = process.env.ORCHESTRA_FAKE_HEALTHY !== "0";
    const raw = process.env.ORCHESTRA_FAKE_HEALTHY_MODELS; // "" (present) means "no healthy models", NOT unset
    const hm = (raw != null ? raw : healthy ? model : DEFAULT_JOKER).split(",").map((s) => s.trim()).filter(Boolean);
    return { healthy, healthyModels: hm };
  }
  const models = await listModels(OLLAMA_HOST); // GET /api/tags, 10s — cheap, no generation
  return { healthy: models.length > 0 && models.includes(model), healthyModels: models };
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

/**
 * Management ritual glue (ORGANIZATION.md §3) — every dispatch/outcome is remembered in the brain
 * ledger; a HARD failure additionally produces an ERR-ORG registry-append PROPOSAL. Fully tolerant:
 * the management layer is advisory on this path and must never kill or block the loop.
 */
function orgRecordOutcome(taskId: string, ok: boolean, summaryText: string, error?: string): void {
  try {
    const ts = new Date().toISOString();
    const rec = recordOutcome({ taskId, actorId: "conductor", ok, summary: summaryText, ts, error },
      { rulesApplied: [], nextErrorSeq: nextErrorSeq(ORCH_DIR) });
    remember(rec.ledger.tier, `${rec.ledger.type} ${taskId}: ${summaryText}`,
      { ok, actorId: "conductor", taskId, ...(rec.ledger.sig ? { sig: rec.ledger.sig } : {}) }, ts);
    if (rec.registryAppend) proposeErrorEntry(rec.registryAppend, ORCH_DIR);
  } catch { /* best-effort */ }
}

/**
 * consult-errors → assign → brief: returns the NEVER-REPEAT suffix for the grounded prompt and records
 * the dispatch (episodic). Empty suffix on any management-layer failure (plain dispatch degrades fine).
 */
function orgBrief(state: OrchestraState, slot: string, goalText: string, target: string): string {
  try {
    const chart = loadOrgChart(ORCH_DIR);
    const task: TaskSpec = { id: slot, goal: goalText, cls: "repair", tags: [target] };
    // v3 learned policy (advisory): trained weights bias the pick inside the cheapest band only.
    const policy = readJson(join(ORCH_DIR, "ORG_POLICY.json")) as OrgPolicy | null;
    const a = assignRole(chart, task, policy ? { stats: statsFromPolicy(policy) } : undefined);
    const hits = consultErrors([...loadPreventionRules(), ...faultsAsRules(a)], task);
    remember("episodic", `dispatch ${slot} → ${a.actorId} (${state.conductor_model})`,
      { rules: hits.map((h) => h.id), target });
    const lessons = recall(goalText, 3); // memory is a dispatch INPUT (MAPE-K Knowledge), not an archive
    const memory = lessons.length ? `\n\n## RELEVANT MEMORY (brain ledger)\n${lessons.map((l) => `- ${l.fact}`).join("\n")}` : "";
    return (hits.length
      ? `\n\n## NEVER REPEAT (prevention rules — violating any of these is a defect)\n${hits.map((r) => `- [${r.id}] ${r.rule}`).join("\n")}`
      : "") + memory;
  } catch { return ""; }
}

// ── Live task tracker (Claude-Code-style progress UX — lib/task-tracker + `ollamas follow`) ──────
// Every helper is fully tolerant: a tracker failure must never touch the FSM loop.
const FSM_ITEMS = [
  { id: "COUNCIL_DEBATE", label: "Konsey değerlendirmesi" },
  { id: "BENCHMARK_VALIDATION", label: "Benchmark doğrulaması" },
  { id: "REPAIR", label: "REPAIR — grounded proposal üretimi" },
  { id: "GATE", label: "Gate (tsc+test) + kayıt" },
];

/** Deterministic run id per task — every producer working on the same task stamps the same run, so
 *  concurrent producers (daemon tick vs manual --once vs tests) can never cross-pollute runs. */
const runIdForTask = (task: string): string => `ollamas:${task}`;

function trkStart(task: string): void {
  try {
    resetRun();
    emitEvent({
      type: "start", ts: new Date().toISOString(), runId: runIdForTask(task),
      title: `"${task}" işleniyor`, source: "ollamas",
      items: [{ id: `task:${task}`, label: `Görev: ${task}` }, ...FSM_ITEMS],
    });
  } catch { /* best-effort */ }
}

function trkPhase(phase: string, note: string, task?: string | null): void {
  try {
    const ts = new Date().toISOString();
    const runId = task ? runIdForTask(task) : undefined;
    const idx = FSM_ITEMS.findIndex((f) => f.id === phase);
    if (idx >= 0) {
      for (let i = 0; i < idx; i++) emitEvent({ type: "item", ts, runId, id: FSM_ITEMS[i].id, status: "done" as ItemStatus });
      emitEvent({ type: "item", ts, runId, id: phase, status: "active" as ItemStatus });
    }
    emitEvent({ type: "note", ts, runId, note, phase });
  } catch { /* best-effort */ }
}

function trkEvent(
  ev: { type: "item"; id: string; status: ItemStatus } | { type: "tokens"; n: number } | { type: "note"; note: string } | { type: "finish" },
  task?: string | null,
): void {
  try {
    const runId = task ? runIdForTask(task) : undefined;
    emitEvent({ ...ev, ts: new Date().toISOString(), ...(runId ? { runId } : {}) } as Parameters<typeof emitEvent>[0]);
  } catch { /* best-effort */ }
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

  trkPhase("REPAIR", `${slot} için ${state.conductor_model} grounded proposal üretiyor`, slot);
  try {
    const prompt = groundedPrompt(goalText + orgBrief(state, slot, goalText, target), target, content);
    const r = await chatOnce(state.conductor_model, "", prompt, { host: OLLAMA_HOST, timeoutMs: REPAIR_MS, num_ctx: 8192 });
    trkEvent({ type: "tokens", n: Math.round((r.tokS * r.ms) / 1000) || Math.round(r.text.length / 4) }, slot);
    if (!hasSearchReplace(r.text)) {
      log(`  ↳ REPAIR: ${state.conductor_model} → no actionable SEARCH/REPLACE (retry next tick)`);
      try { remember("episodic", `outcome ${slot}: no actionable SEARCH/REPLACE (transient, retry)`, { ok: false }); } catch { /* best-effort */ }
      return;
    }
    const dir = join(FLEET_WORK, `${slot}.${ORCHESTRA_SLOT}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "PROPOSAL.md"), `${proposalHeader(slot, state.conductor_model)}\n\n${r.text}\n`);
    if (catalogId) saveProgress(mark(loadProgress(), catalogId, "proposed"));
    log(`  ↳ REPAIR: ${state.conductor_model} → ${slot}.${ORCHESTRA_SLOT} PROPOSAL (${r.tokS.toFixed(0)} tok/s)`);
    orgRecordOutcome(slot, true, `PROPOSAL written by ${state.conductor_model}`);
    trkEvent({ type: "item", id: "REPAIR", status: "done" }, slot);
    trkEvent({ type: "note", note: `${slot} PROPOSAL hazır${APPLY ? " — gate koşuyor" : " (apply kapalı)"}` }, slot);
    if (APPLY) {
      try {
        const out = execFileSync(TSX, [join(HERE, "fleet-apply.ts"), "--apply", applyToken(slot)], { encoding: "utf8", timeout: CHILD_MS * 4, cwd: REPO, stdio: ["ignore", "pipe", "pipe"] });
        if (catalogId) saveProgress(mark(loadProgress(), catalogId, "done")); // gated apply landed green → done
        log(`  ↳ fleet-apply: ${(out.trim().split("\n").pop() || "applied").slice(0, 100)}`);
        orgRecordOutcome(slot, true, "gated apply landed green");
        trkEvent({ type: "item", id: "GATE", status: "done" }, slot);
      } catch (e) {
        log(`  ↳ fleet-apply: gate red → reverted (${(e as Error).message.slice(0, 60)})`);
        orgRecordOutcome(slot, false, "gate red → reverted", (e as Error).message.slice(0, 160));
        trkEvent({ type: "item", id: "GATE", status: "failed" }, slot);
      }
    }
  } catch (e) {
    log(`  ↳ REPAIR: dispatch failed (${(e as Error).message.slice(0, 80)}) — will retry`);
    try { remember("episodic", `outcome ${slot}: dispatch failed (transient, retry) — ${(e as Error).message.slice(0, 120)}`, { ok: false }); } catch { /* best-effort */ }
  }
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
  // Return-to-preferred: after a transient failover the state pins the joker (possibly a cloud model). When the
  // benchmark-preferred $0-local conductor is installed again, switch back — the joker is a fallback, not a home.
  // Skip this tick's failover after returning (the probe above was for the OLD model; next tick re-probes cleanly).
  let returnedToPreferred = false;
  if (state.conductor_model !== conductor && healthyModels.includes(conductor)) {
    log(`↩ return to preferred conductor: ${state.conductor_model} → ${conductor} (local $0)`);
    state = { ...state, conductor_model: conductor };
    returnedToPreferred = true;
  }
  if (!returnedToPreferred) {
    const fo = maybeFailover(state, healthy, healthyModels, ts, roster);
    state = fo.state;
    if (fo.swapped) log(`⚠ FAILOVER: conductor down → joker=${fo.joker} (failover #${state.failover_count})`);
  }

  // 2) OBSERVE read-only signals.
  const { actionTier, converged } = observe();
  // A current_task whose catalog id is already proposed/done is NOT active work — else the loop re-proposes it
  // forever (hasTask stuck true) and the autonomous drain can never advance. Treat it as complete → clear it.
  const curTask = state.current_task ? resolveTask(state.current_task, loadCatalog()) : null;
  const curDone = !!curTask && statusOf(loadProgress(), curTask.id) !== "pending";
  const hasTask = state.pending_actions.length > 0 || (!!state.current_task && !curDone);

  // 3) SIDE-EFFECT for the current phase (bounded, best-effort).
  await runPhaseSideEffect(state);

  // 4) ADVANCE the pure FSM. Retry is bumped on each REPAIR re-entry; reset on deploy/new-council.
  let retryExceeded = false;
  if (state.phase === "REPAIR") { const b = bumpRetry(state.retry_count); state.retry_count = b.retry_count; retryExceeded = b.exceeded; }
  const input: PhaseInput = { phase: state.phase, actionTier, hasTask, converged, retryExceeded };
  let next = nextPhase(input);
  // Clear a completed current_task (proposed/done) so the loop advances (drain picks the next pending below).
  if (curDone) {
    log(`  ↳ görev tamam: ${curTask!.id} (${statusOf(loadProgress(), curTask!.id)}) → sıradaki`);
    trkEvent({ type: "item", id: `task:${state.current_task}`, status: "done" }, state.current_task);
    trkEvent({ type: "finish" }, state.current_task);
    state = { ...state, current_task: null };
  }
  // G2 (STEP 2 wiring): leaving COUNCIL_DEBATE with an explicit council HOLD and nothing forcing work
  // (no queued task, no blocking signal) → hold at MONITORING instead of burning a repair on no-consensus.
  if (state.phase === "COUNCIL_DEBATE" && !hasTask && !isBlocking(actionTier) && councilDecision() === "HOLD") {
    log(`  ↳ council HOLD (uzlaşı yok) → MONITORING (repair yakma)`);
    try { remember("episodic", "council verdict HOLD (no consensus) → MONITORING", { phase: state.phase }, ts); } catch { /* best-effort */ }
    next = "MONITORING";
  }
  // I2 (iter-8): autonomous backlog-drain — idle + AUTODRAIN marker → pull the next PENDING catalog task so the
  // daemon works through the whole project 0-manual. Reopens the loop this same tick (dequeued below).
  if (next === "MONITORING" && !hasTask && AUTODRAIN) {
    const cat = loadCatalog();
    const t = nextPending(cat, loadProgress());
    if (t) { state = enqueueTask(state, t.id); next = "COUNCIL_DEBATE"; const s = summary(cat, loadProgress()); trkStart(t.id); log(`↻ auto-drain: ${t.id} (done ${s.done}/${s.total})`); }
  }
  if (shouldResetRetry(next)) state.retry_count = 0;
  if (next === "COUNCIL_DEBATE" || next === "BENCHMARK_VALIDATION") {
    trkPhase(next, next === "COUNCIL_DEBATE" ? "Konsey görevi değerlendiriyor" : "Benchmark sinyalleri doğrulanıyor", state.current_task ?? state.pending_actions[0]);
  }
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
  trkStart(task); // live progress UX: `ollamas follow` picks this run up immediately
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
