// gemini-quota — gemini-specific thin wrapper over the vendor-agnostic budget core (`./vendor-budget`).
//
// Why: vO57 hit the Gemini free-tier DAILY quota (429, ~20/day) and only noticed AFTER a doomed call + ~50s
// backoff. vO58 added this pre-flight gate; vO59 generalized the math into `vendor-budget` (a multi-vendor
// pool) so ONE vendor exhausting no longer stalls the loop. The daily-budget MATH now lives in vendor-budget
// and is re-exported here unchanged (single source of truth) — `QuotaState` is structurally `VendorState`.
// The gemini-specific IO below keeps the historical SINGLE-state file `~/.llm-mission-control/gemini-quota.json`
// ({date,used,limit}, not the pool map) so existing call sites (gemini-run `--quota`, fleet-agent) are
// behavior-preserving.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { withLock } from "./claims";
import {
  rollover, canDispatch, remaining, recordSuccess, recordExhausted,
  defaultLimitFor, todayKey, type VendorState,
} from "./vendor-budget";

// ── re-exported pure core (identical shape; ONE source of truth in vendor-budget) ─────────────────────
export { rollover, canDispatch, remaining, recordSuccess, recordExhausted, todayKey };
export type QuotaState = VendorState;

/** Default free-tier daily request budget for gemini (override with GEMINI_DAILY_LIMIT). */
export function defaultLimit(): number {
  return defaultLimitFor("gemini");
}

// ── gemini-specific single-state IO (historical file format; not the pool map) ────────────────────────

/** Load the persisted state, or a fresh one at `limit`. Corrupt/absent file → fresh. */
export function loadQuota(path: string, limit: number = defaultLimit()): QuotaState {
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    if (j && typeof j.date === "string" && typeof j.used === "number") {
      return { date: j.date, used: j.used, limit: typeof j.limit === "number" ? j.limit : limit };
    }
  } catch { /* absent / corrupt → fresh */ }
  return { date: todayKey(), used: 0, limit };
}

// Atomic replace (tmp + rename(2)) so a concurrent reader never sees a truncated mid-write file. See
// vendor-budget.saveBudget for the full rationale — same shared-file torn-read hazard.
export function saveQuota(path: string, state: QuotaState): void {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(state) + "\n");
    renameSync(tmp, path);
  } catch { /* best-effort */ }
}

/** Pre-flight gate: may we dispatch to Gemini now? Loads + rolls over; returns the (possibly rolled) state. */
export function guardQuota(path: string, today: string = todayKey(), limit: number = defaultLimit()): { allowed: boolean; state: QuotaState; msg: string } {
  const state = rollover(loadQuota(path, limit), today);
  const allowed = canDispatch(state, today);
  const msg = allowed
    ? `gemini quota ${state.used}/${state.limit} today (${remaining(state, today)} left)`
    : `gemini daily quota exhausted (${state.used}/${state.limit}) — resets tomorrow`;
  return { allowed, state, msg };
}

/** Record an outcome and persist. `success` → +1; `exhausted` → latch the day.
 *  load→mutate→save is a cross-process read-modify-write on the shared quota file; `withLock`
 *  serializes it so concurrent fleet processes cannot lose each other's +1 (P1 lost-update). */
export function noteOutcome(path: string, outcome: "success" | "exhausted", today: string = todayKey(), limit: number = defaultLimit()): QuotaState {
  return withLock(`${path}.lock`, () => {
    const cur = loadQuota(path, limit);
    const next = outcome === "success" ? recordSuccess(cur, today) : recordExhausted(cur, today);
    saveQuota(path, next);
    return next;
  });
}
