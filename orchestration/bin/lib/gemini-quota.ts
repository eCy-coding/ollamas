// gemini-quota (pure core + thin IO) — daily free-tier budget accounting for the Gemini vendor.
//
// Why: vO57 hit the Gemini free-tier DAILY quota (429, ~20/day). The dispatcher only noticed AFTER making a
// doomed call + burning ~50s of backoff. A scarce resource (20 requests/day) must be SPENT, not wasted: this
// tracks the day's usage in ~/.llm-mission-control/gemini-quota.json and gates BEFORE the call — when the
// budget is spent, the dispatcher fails fast (no API call, no backoff). The first real 429 latches the day
// as exhausted, so correctness never depends on guessing the exact limit. Pure logic (today injected, no
// Date) is unit-tested; the thin IO wrapper is shared by both dispatch sites (gemini-run + fleet-agent).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface QuotaState { date: string; used: number; limit: number }

/** Default free-tier daily request budget (override with GEMINI_DAILY_LIMIT). */
export function defaultLimit(): number {
  const n = Number(process.env.GEMINI_DAILY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
}

// ── pure core (today is injected — deterministic, IO-free) ────────────────────────────────────────────

/** Reset the counter when the day rolls over. Returns a fresh state for `today` if the date changed. */
export function rollover(state: QuotaState, today: string): QuotaState {
  return state.date === today ? state : { date: today, used: 0, limit: state.limit };
}

/** Is there budget left today? (rolls over first.) */
export function canDispatch(state: QuotaState, today: string): boolean {
  const s = rollover(state, today);
  return s.used < s.limit;
}

/** Remaining requests today (never negative). */
export function remaining(state: QuotaState, today: string): number {
  const s = rollover(state, today);
  return Math.max(0, s.limit - s.used);
}

/** Count one successful request. */
export function recordSuccess(state: QuotaState, today: string): QuotaState {
  const s = rollover(state, today);
  return { ...s, used: s.used + 1 };
}

/** Latch today as exhausted (a real 429 was seen) — used = limit so nothing else dispatches today, even if
 *  the counter under-estimated the true cap. Correctness independent of the limit guess. */
export function recordExhausted(state: QuotaState, today: string): QuotaState {
  const s = rollover(state, today);
  return { ...s, used: Math.max(s.used, s.limit) };
}

// ── thin IO (shared by both dispatch sites) ───────────────────────────────────────────────────────────

/** Today's key "YYYY-MM-DD" (local). The only Date use — kept out of the pure core. */
export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

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

export function saveQuota(path: string, state: QuotaState): void {
  try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(state) + "\n"); } catch { /* best-effort */ }
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

/** Record an outcome and persist. `success` → +1; `exhausted` → latch the day. */
export function noteOutcome(path: string, outcome: "success" | "exhausted", today: string = todayKey(), limit: number = defaultLimit()): QuotaState {
  const cur = loadQuota(path, limit);
  const next = outcome === "success" ? recordSuccess(cur, today) : recordExhausted(cur, today);
  saveQuota(path, next);
  return next;
}
