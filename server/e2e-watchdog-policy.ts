// Self-heal policy for the e2e watchdog — pure, so the decision can be tested without
// launchctl and without waiting five minutes for the next gate run.
//
// WHY THIS IS NOT INLINE SHELL ANY MORE. The previous version counted consecutive red
// runs and, once the count crossed the threshold, kickstarted the service on EVERY run
// from then on (the counter only reset on a green run). Measured on 2026-07-22: odysseus
// needs ~210s to bind :7860 (onnxruntime + chroma + model init) while the gate runs every
// 300s. So the restart landed on a service that was still booting, the boot restarted,
// the leg stayed red, and the healer kept re-killing it. That is the long-standing
// "odysseus :7860 intermittent" symptom — self-inflicted.
//
// The fix is a grace window: after a restart, a leg is left alone long enough to actually
// finish booting. It is still counted (so the operator sees how long it has been red) and
// it is still restarted again if it is genuinely dead once the window expires.

export interface LegState {
  /** Consecutive red runs for this leg. */
  n: number;
  /** Epoch ms of the last kickstart, 0 if never restarted. */
  kickedAt: number;
}
export type WatchdogState = Record<string, LegState>;

export type Action =
  | { kind: "kick"; chk: string; label: string; n: number }
  | { kind: "notify"; chk: string; n: number };

export interface DecideInput {
  prev: WatchdogState;
  red: string[];
  now: number;
  thresh: number;
  graceMs: number;
  /** Red check -> launchd label that is SAFE to restart. "" means notify-only. */
  labelFor: (chk: string) => string;
}

/**
 * Read a state file. Tolerates the flat-int format this replaces, so upgrading does not
 * throw away the counters of a leg that is red right now.
 */
/** Side-channel key holding kick timestamps. Chosen so the previous shell script, which
 *  only looks up the names of currently-red checks, never reads it. */
const KICK_KEY = "_kickedAt";

export function parseState(raw: string): WatchdogState {
  let obj: unknown;
  try { obj = JSON.parse(raw); } catch { return {}; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const rec = obj as Record<string, unknown>;

  const kicks: Record<string, number> = {};
  const side = rec[KICK_KEY];
  if (side && typeof side === "object" && !Array.isArray(side)) {
    for (const [k, v] of Object.entries(side as Record<string, unknown>)) {
      if (typeof v === "number" && Number.isFinite(v)) kicks[k] = v;
    }
  }

  const out: WatchdogState = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === KICK_KEY) continue;
    if (typeof v === "number" && Number.isFinite(v)) {
      out[k] = { n: v, kickedAt: kicks[k] ?? 0 };
    } else if (v && typeof v === "object" && !Array.isArray(v)) {
      // The per-leg object shape, written briefly before the compatibility problem with
      // the old shell script was found. Still read so no counter is lost on upgrade.
      const o = v as Record<string, unknown>;
      const n = typeof o.n === "number" && Number.isFinite(o.n) ? o.n : 0;
      const kickedAt = typeof o.kickedAt === "number" && Number.isFinite(o.kickedAt) ? o.kickedAt : 0;
      if (n > 0 || kickedAt > 0) out[k] = { n, kickedAt };
    }
    // anything else (strings, null) is not a counter — drop it rather than guess
  }
  return out;
}

/**
 * Write the state so that a watchdog running the PREVIOUS shell script can still read it.
 * That script does `n=$(python … .get(chk,0))` followed by `n=$((n+1))`, so a non-integer
 * value for a check name kills it with "bad math expression". Counts therefore stay bare
 * integers at the top level and kick times live under KICK_KEY, which it never looks up.
 */
export function serializeState(state: WatchdogState): string {
  const out: Record<string, unknown> = {};
  const kicks: Record<string, number> = {};
  for (const [chk, leg] of Object.entries(state)) {
    out[chk] = leg.n;
    if (leg.kickedAt > 0) kicks[chk] = leg.kickedAt;
  }
  if (Object.keys(kicks).length > 0) out[KICK_KEY] = kicks;
  return JSON.stringify(out);
}

export function decide(input: DecideInput): { actions: Action[]; next: WatchdogState } {
  const { prev, red, now, thresh, graceMs, labelFor } = input;
  const actions: Action[] = [];
  const next: WatchdogState = {};

  for (const chk of red) {
    const before = prev[chk] ?? { n: 0, kickedAt: 0 };
    const n = before.n + 1;
    let kickedAt = before.kickedAt;

    if (n >= thresh) {
      const label = labelFor(chk);
      if (label) {
        // Only restart if we are not already waiting on a restart we just ordered.
        if (now - before.kickedAt >= graceMs) {
          actions.push({ kind: "kick", chk, label, n });
          kickedAt = now;
        }
      } else {
        // No safe label (the hub, ollama, chroma): report every time, restart never.
        actions.push({ kind: "notify", chk, n });
      }
    }
    next[chk] = { n, kickedAt };
  }
  // Legs absent from `red` recovered — they simply do not carry into the next state.
  return { actions, next };
}
