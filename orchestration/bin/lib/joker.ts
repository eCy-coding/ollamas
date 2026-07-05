/**
 * orchestration/bin/lib/joker.ts — PURE joker/conductor resolution + failover transition (zero-dep, no IO).
 *
 * The live health-probe lives in orchestra.ts (IO shell). This lib decides, given the benchmark selection +
 * council roster + a snapshot of which models are currently healthy, WHO should conduct and WHO is the
 * standby joker, and applies the deterministic failover state-mutation. Fully unit-testable (no clock/socket).
 *
 * Failover policy (JUstdoit STEP 5): if the conductor model is unhealthy AND a distinct healthy joker exists,
 * swap conductor_model→joker, bump failover_count, log `[FAILOVER] <old>→<joker>`. Never swaps to itself and
 * never swaps when no healthy alternative exists (avoids thrash / infinite reroute when everything is down).
 */

import { pruneHistory, type OrchestraState } from "./orchestra-fsm";

/** Lightest known fallback — the benchmarked "cheapest 100%" champion (MODEL_SELECTION.champions.singleBest). */
export const DEFAULT_JOKER = "qwen3:8b";

/** Read the benchmark-picked conductor model from a parsed MODEL_SELECTION.json blob. Falls back safely. */
export function resolveConductor(modelSelection: unknown, fallback = "qwen3-coder:30b"): string {
  const sel = (modelSelection as { selection?: { model?: unknown } } | null)?.selection;
  const m = sel?.model;
  return typeof m === "string" && m.trim() ? m.trim() : fallback;
}

/** Model names present in a parsed COUNCIL_ROSTER.json (available seats only). */
export function rosterModels(roster: unknown): string[] {
  const seats = (roster as { seats?: unknown } | null)?.seats;
  if (!Array.isArray(seats)) return [];
  return seats
    .filter((s) => s && typeof s === "object" && (s as { available?: unknown }).available !== false)
    .map((s) => String((s as { model?: unknown }).model ?? ""))
    .filter(Boolean);
}

/**
 * Pick the standby joker: prefer DEFAULT_JOKER when it is healthy and distinct from the conductor; otherwise
 * the first healthy roster model that isn't the conductor; else "" (no viable joker → caller must not swap).
 */
export function resolveJoker(healthyModels: string[], conductor: string, roster?: unknown): string {
  const healthy = new Set(healthyModels.filter(Boolean));
  if (healthy.has(DEFAULT_JOKER) && DEFAULT_JOKER !== conductor) return DEFAULT_JOKER;
  const fromRoster = rosterModels(roster).find((m) => m !== conductor && healthy.has(m));
  if (fromRoster) return fromRoster;
  const anyHealthy = [...healthy].find((m) => m !== conductor);
  return anyHealthy ?? "";
}

/**
 * Should we fail over? Only when the conductor is NOT healthy and a distinct healthy joker exists.
 * `conductorHealthy` is the live probe result from orchestra.ts.
 */
export function shouldFailover(conductorHealthy: boolean, conductor: string, joker: string): boolean {
  return !conductorHealthy && !!joker && joker !== conductor;
}

/** Apply the failover: swap conductor→joker, bump counter, append a compact history entry. Pure. */
export function applyFailover(state: OrchestraState, joker: string, ts: string, reason = "health"): OrchestraState {
  const from = state.conductor_model;
  return {
    ...state,
    conductor_model: joker,
    failover_count: state.failover_count + 1,
    history: pruneHistory(state.history, { ts, phase: state.phase, note: `[FAILOVER] ${from}→${joker} (${reason})` }),
  };
}

/**
 * Full decide+apply convenience used by the IO shell each tick. Returns the (possibly) mutated state plus a
 * boolean telling the caller whether a swap happened (for logging / warm-up of the new conductor).
 */
export function maybeFailover(
  state: OrchestraState,
  conductorHealthy: boolean,
  healthyModels: string[],
  ts: string,
  roster?: unknown,
): { state: OrchestraState; swapped: boolean; joker: string } {
  const joker = resolveJoker(healthyModels, state.conductor_model, roster);
  if (!shouldFailover(conductorHealthy, state.conductor_model, joker)) {
    return { state, swapped: false, joker };
  }
  return { state: applyFailover(state, joker, ts), swapped: true, joker };
}
