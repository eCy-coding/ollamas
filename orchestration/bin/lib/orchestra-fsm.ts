/**
 * orchestration/bin/lib/orchestra-fsm.ts — autonomous-orchestra state machine (PURE, zero-dep).
 *
 * The Claude-Code-free conductor loop (orchestra.ts) is a thin IO shell around this pure core,
 * mirroring the conduct.ts (pure lib) + conduct CLI split. No IO here → fully unit-testable.
 *
 * FSM (maps 1:1 to JUstdoit.md STEP flow + Emre's 4-step spec):
 *   BOOTSTRAPPING → COUNCIL_DEBATE → BENCHMARK_VALIDATION → { DEPLOYMENT | REPAIR } → MONITORING
 *   REPAIR loops back to BENCHMARK_VALIDATION until RETRY_MAX, then ESCALATE (daemon stays open).
 *
 * Token minimalism (STEP 8): history is pruned to the last N entries; only compact keys flow.
 */

import { TIERS, type Tier } from "./conduct";

export const PHASES = [
  "BOOTSTRAPPING",
  "COUNCIL_DEBATE",
  "BENCHMARK_VALIDATION",
  "REPAIR",
  "DEPLOYMENT",
  "MONITORING",
  "ESCALATE",
] as const;
export type Phase = (typeof PHASES)[number];

/** Max self-repair attempts on the SAME broken gate before escalating (JUstdoit STEP 7, N=3). */
export const RETRY_MAX = 3;

/** History cap — aggressive prune keeps token/context small (STEP 8). */
export const HISTORY_MAX = 20;

/** Tiers that mean "something is broken" → route to REPAIR, not normal COUNCIL work. */
export const BLOCKING_TIERS: readonly Tier[] = ["RED", "SECURITY", "CONTRACT", "REGRESSION"];

export interface HistoryEntry {
  ts: string;
  phase: Phase;
  note: string; // compact: e.g. "action=RED:cli" or "[FAILOVER] qwen3:8b→joker"
}

/** Shared, resumable orchestra state. Persisted atomically to ~/.ollamas/orchestra.json. */
export interface OrchestraState {
  phase: Phase;
  current_task: string | null;
  conductor_model: string;
  active_agents: string[];
  pending_actions: string[];
  retry_count: number;
  failover_count: number;
  history: HistoryEntry[];
}

export function emptyOrchestraState(conductorModel: string): OrchestraState {
  return {
    phase: "BOOTSTRAPPING",
    current_task: null,
    conductor_model: conductorModel,
    active_agents: [],
    pending_actions: [],
    retry_count: 0,
    failover_count: 0,
    history: [],
  };
}

/** Validate/normalize a parsed blob (corrupt → fresh). Keeps the loader from crashing on garbage. */
export function normalizeState(raw: unknown, conductorModel: string): OrchestraState {
  const d = emptyOrchestraState(conductorModel);
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  return {
    phase: (PHASES as readonly string[]).includes(o.phase as string) ? (o.phase as Phase) : d.phase,
    current_task: typeof o.current_task === "string" ? o.current_task : null,
    conductor_model: typeof o.conductor_model === "string" && o.conductor_model ? o.conductor_model : conductorModel,
    active_agents: Array.isArray(o.active_agents) ? (o.active_agents as string[]).filter((x) => typeof x === "string") : [],
    pending_actions: Array.isArray(o.pending_actions) ? (o.pending_actions as string[]).filter((x) => typeof x === "string") : [],
    retry_count: Number.isFinite(o.retry_count as number) ? Math.max(0, Math.floor(o.retry_count as number)) : 0,
    failover_count: Number.isFinite(o.failover_count as number) ? Math.max(0, Math.floor(o.failover_count as number)) : 0,
    history: Array.isArray(o.history)
      ? (o.history as HistoryEntry[]).filter((h) => h && typeof h.ts === "string" && typeof h.note === "string").slice(-HISTORY_MAX)
      : [],
  };
}

export interface PhaseInput {
  phase: Phase;
  actionTier: Tier | null; // top conduct.ts finding tier (null = clean)
  hasTask: boolean; // a pending/current task exists → real work to route
  converged: boolean; // fleet-conduct convergence (all streams gated-DONE, no live claims)
  retryExceeded: boolean; // retry_count >= RETRY_MAX after the latest bump
}

/** Is the current top signal a "broken" one that must be surgically repaired first? */
export function isBlocking(tier: Tier | null): boolean {
  return tier != null && BLOCKING_TIERS.includes(tier);
}

/**
 * Pure FSM transition. Deterministic — no clock, no IO. Given where we are + the freshly observed
 * signals, return the next phase. The gate (BENCHMARK_VALIDATION) is the only branch point that can
 * fork into REPAIR; everything else is a linear walk with a MONITORING idle-hold.
 */
export function nextPhase(i: PhaseInput): Phase {
  switch (i.phase) {
    case "BOOTSTRAPPING":
      return "COUNCIL_DEBATE";
    case "COUNCIL_DEBATE":
      return "BENCHMARK_VALIDATION";
    case "BENCHMARK_VALIDATION":
      // Gate: converged AND nothing broken AND no explicit task → ship. An explicit pending/current task
      // (from `ollamas do` or the auto-drain) is real work → route to REPAIR to EXECUTE it before shipping.
      return i.converged && !isBlocking(i.actionTier) && !i.hasTask ? "DEPLOYMENT" : "REPAIR";
    case "REPAIR":
      return i.retryExceeded ? "ESCALATE" : "BENCHMARK_VALIDATION";
    case "DEPLOYMENT":
      return "MONITORING";
    case "MONITORING":
      // New task OR a freshly-broken signal reopens the loop; otherwise hold (stable).
      return i.hasTask || isBlocking(i.actionTier) ? "COUNCIL_DEBATE" : "MONITORING";
    case "ESCALATE":
      // Only a new task (or an operator clearing it) restarts the loop; else stay parked.
      return i.hasTask ? "COUNCIL_DEBATE" : "ESCALATE";
    default:
      return "MONITORING";
  }
}

/** Bump retry on (re)entering REPAIR; returns new count + whether the cap was hit. */
export function bumpRetry(retryCount: number): { retry_count: number; exceeded: boolean } {
  const n = retryCount + 1;
  return { retry_count: n, exceeded: n >= RETRY_MAX };
}

/** Retry resets whenever we successfully deploy or take on a brand-new task. */
export function shouldResetRetry(phase: Phase): boolean {
  return phase === "DEPLOYMENT" || phase === "COUNCIL_DEBATE";
}

/** Append + prune to HISTORY_MAX (token minimalism). Pure — returns a new array. */
export function pruneHistory(history: HistoryEntry[], entry?: HistoryEntry, max = HISTORY_MAX): HistoryEntry[] {
  const next = entry ? [...history, entry] : [...history];
  return next.slice(-max);
}

/** Enqueue a user task (`ollamas <task>`); dedupe consecutive identical enqueues. */
export function enqueueTask(state: OrchestraState, task: string): OrchestraState {
  const t = task.trim();
  if (!t) return state;
  const last = state.pending_actions[state.pending_actions.length - 1];
  if (last === t) return state; // idempotent double-submit guard
  return { ...state, pending_actions: [...state.pending_actions, t] };
}

/** Pop the oldest pending task into current_task (FIFO). No-op when queue empty. */
export function dequeueTask(state: OrchestraState): OrchestraState {
  if (!state.pending_actions.length) return state;
  const [head, ...rest] = state.pending_actions;
  return { ...state, current_task: head, pending_actions: rest };
}

/** Compact one-line status for delta-only stdout (no noise, STEP 8). */
export function statusLine(state: OrchestraState): string {
  return (
    `🎼 ${state.phase} · model=${state.conductor_model}` +
    (state.current_task ? ` · task="${state.current_task.slice(0, 40)}"` : "") +
    ` · queue=${state.pending_actions.length} · retry=${state.retry_count}/${RETRY_MAX} · failover=${state.failover_count}`
  );
}

/** Re-export the tier vocabulary so callers don't reach past this lib for the enum. */
export { TIERS };
