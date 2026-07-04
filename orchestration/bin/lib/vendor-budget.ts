// vendor-budget (pure core + thin IO) — vendor-agnostic free-tier DAILY budget pool for the fleet.
//
// Why: vO58 gave gemini a daily-quota gate, but the grounded-proposal production loop was still bound to a
// SINGLE vendor — when gemini's free-tier day is spent (today: 20/20) the loop STALLS with no proposal. The
// orchestra conductor answer is a POOL: track every free-tier vendor's daily usage in one file and, when the
// preferred vendor is exhausted, fall over to the next available one (`pickVendor` picks the most-remaining
// candidate) so the loop never stalls and each vendor's scarce requests are never wasted (pre-flight gate) or
// over-spent (429-latch). The pure core is a per-vendor generalization of gemini-quota's single-state math —
// same {date,used,limit} shape, `today` injected, IO-free, unit-tested; gemini-quota re-exports these fns so
// there is ONE source of truth. The thin IO layer keeps a single JSON map (atomic read/write; pickVendor needs
// a cross-vendor scan, which per-file state would race).

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

export interface VendorState { date: string; used: number; limit: number }
export type BudgetFile = Record<string, VendorState>;

/** Fallback daily budgets for the known free-tier vendors (override with `${VENDOR}_DAILY_LIMIT`). */
const FALLBACK_LIMIT: Record<string, number> = { gemini: 20, groq: 20, cerebras: 20, zai: 20 };
const DEFAULT_LIMIT = 20;

/** Default daily request budget for a vendor: env `${VENDOR}_DAILY_LIMIT` (floored, positive) → table → 20. */
export function defaultLimitFor(vendor: string): number {
  const env = Number(process.env[`${vendor.toUpperCase()}_DAILY_LIMIT`]);
  if (Number.isFinite(env) && env > 0) return Math.floor(env);
  return FALLBACK_LIMIT[vendor.toLowerCase()] ?? DEFAULT_LIMIT;
}

// ── pure core (today is injected — deterministic, IO-free; per-vendor generalization) ─────────────────

/** Reset the counter when the day rolls over. Returns a fresh state for `today` if the date changed. */
export function rollover(state: VendorState, today: string): VendorState {
  return state.date === today ? state : { date: today, used: 0, limit: state.limit };
}

/** Is there budget left today for this vendor? (rolls over first.) */
export function canDispatch(state: VendorState, today: string): boolean {
  const s = rollover(state, today);
  return s.used < s.limit;
}

/** Remaining requests today (never negative). */
export function remaining(state: VendorState, today: string): number {
  const s = rollover(state, today);
  return Math.max(0, s.limit - s.used);
}

/** Count one successful request. */
export function recordSuccess(state: VendorState, today: string): VendorState {
  const s = rollover(state, today);
  return { ...s, used: s.used + 1 };
}

/** Latch today as exhausted (a real 429 was seen) — used = limit so nothing else dispatches to this vendor
 *  today, even if the counter under-estimated the true cap. Correctness independent of the limit guess. */
export function recordExhausted(state: VendorState, today: string): VendorState {
  const s = rollover(state, today);
  return { ...s, used: Math.max(s.used, s.limit) };
}

/** Value/availability-aware pick: among `candidates` still under budget today, choose the MOST-remaining one.
 *  Ties (and unknown vendors, scored at their default budget) break by `pref` index order, else candidate
 *  order. Returns null when every candidate is exhausted. `today` rolls each candidate over first. */
export function pickVendor(candidates: string[], b: BudgetFile, today: string, pref: string[] = []): string | null {
  const stateOf = (vendor: string): VendorState =>
    b[vendor] ?? { date: today, used: 0, limit: defaultLimitFor(vendor) };
  const rank = (vendor: string): number => { const i = pref.indexOf(vendor); return i < 0 ? pref.length : i; };

  let best: string | null = null;
  let bestRem = -1;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const st = stateOf(c);
    if (!canDispatch(st, today)) continue;
    const rem = remaining(st, today);
    const r = rank(c);
    if (rem > bestRem || (rem === bestRem && r < bestRank)) {
      best = c; bestRem = rem; bestRank = r;
    }
  }
  return best;
}

// A vendor's free-tier daily rate/quota is spent (→ latch it + fail over). Vendor-AGNOSTIC on purpose: the
// gemini-specific matcher missed groq/cerebras wordings ("rate limit reached", "Too Many Requests") that omit
// the literal 429/quota → the vendor never latched. Excludes 5xx: a 500/502/503 is a TRANSIENT overload
// (retry-worthy, handled by backoff), NOT an exhausted budget — latching it would wrongly abandon the vendor.
// Bare "exceeded" is deliberately NOT matched: 400-class request errors ("maximum context length exceeded",
// "size limit exceeded") carry it too and would falsely latch a healthy vendor for the whole day.
// "requests limit" IS matched: cerebras/zai 429 bodies say "exceeded your current requests limit" with no
// 429/quota literal — narrow enough to never hit the size/context wordings above.
const VENDOR_EXHAUSTED = /\b429\b|too many requests|rate.?limit|resource_exhausted|insufficient_quota|quota|daily limit|usage limit|requests? limit/i;

/** True when an error/response blob signals the vendor's rate/quota is spent (latch + fail over, not retry). */
export function isVendorExhausted(text: string): boolean {
  return typeof text === "string" && VENDOR_EXHAUSTED.test(text);
}

// ── thin IO (single JSON map; shared by every dispatch site) ──────────────────────────────────────────

/** Load the persisted per-vendor map, or `{}` when absent/corrupt. */
export function loadBudget(path: string): BudgetFile {
  try {
    const j = JSON.parse(readFileSync(path, "utf8"));
    if (j && typeof j === "object" && !Array.isArray(j)) {
      const out: BudgetFile = {};
      for (const [k, val] of Object.entries(j as Record<string, unknown>)) {
        const s = val as Partial<VendorState>;
        if (s && typeof s.date === "string" && typeof s.used === "number") {
          out[k] = { date: s.date, used: s.used, limit: typeof s.limit === "number" ? s.limit : defaultLimitFor(k) };
        }
      }
      return out;
    }
  } catch { /* absent / corrupt → fresh */ }
  return {};
}

export function saveBudget(path: string, b: BudgetFile): void {
  try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, JSON.stringify(b) + "\n"); } catch { /* best-effort */ }
}

/** Pre-flight gate: may we dispatch to `vendor` now? Loads the map, rolls this vendor over, checks budget. */
export function guardVendor(path: string, vendor: string, today: string = todayKey(), limit: number = defaultLimitFor(vendor)): { allowed: boolean; state: VendorState; msg: string } {
  const map = loadBudget(path);
  const state = rollover(map[vendor] ?? { date: today, used: 0, limit }, today);
  const allowed = canDispatch(state, today);
  const msg = allowed
    ? `${vendor} budget ${state.used}/${state.limit} today (${remaining(state, today)} left)`
    : `${vendor} daily budget exhausted (${state.used}/${state.limit}) — resets tomorrow`;
  return { allowed, state, msg };
}

/** Record an outcome for one vendor and persist WITHOUT clobbering the other vendors' slices. */
export function noteVendorOutcome(path: string, vendor: string, outcome: "success" | "exhausted", today: string = todayKey(), limit: number = defaultLimitFor(vendor)): VendorState {
  const map = loadBudget(path);
  const cur = map[vendor] ?? { date: today, used: 0, limit };
  const next = outcome === "success" ? recordSuccess(cur, today) : recordExhausted(cur, today);
  map[vendor] = next;
  saveBudget(path, map);
  return next;
}

/** Today's key "YYYY-MM-DD". The only Date use — kept out of the pure core. */
export function todayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
