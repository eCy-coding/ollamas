// Transport scoring + hysteresis — PURE, deterministic (no I/O, no clock).
// Lower score = better. Selection is benchmark-driven: measured probe latency dominates,
// priority breaks ties / weights the band (LAN_TLS < MESH < REVERSE), an open breaker is
// effectively disqualified. Hysteresis keeps the active transport unless a challenger is
// clearly + persistently better, preventing flapping (Google Patents US20230012193A1 +
// SD-WAN hold-down practice; idea-only).

export interface Candidate {
  name: string;
  /** Transport.priority (lower preferred). */
  priority: number;
  /** Measured probe latency in ms; Infinity if unhealthy/unreachable. */
  latencyMs: number;
  /** Breaker open → disqualified this round. */
  breakerOpen: boolean;
  /** Probe succeeded this round. */
  healthy: boolean;
}

export interface Scored extends Candidate {
  score: number; // lower = better; Infinity = ineligible
}

// Deterministic weights. priority is multiplied so a one-band gap (10) ≈ 100ms of latency,
// i.e. latency wins within a band, priority decides across bands or on ties.
export const SCORE_WEIGHTS = { latency: 1, priority: 10 } as const;

/** PURE: score one candidate. Ineligible (unhealthy / breaker-open) → Infinity. */
export function scoreCandidate(c: Candidate): number {
  if (!c.healthy || c.breakerOpen || !Number.isFinite(c.latencyMs)) return Infinity;
  return c.latencyMs * SCORE_WEIGHTS.latency + c.priority * SCORE_WEIGHTS.priority;
}

/** PURE: score + sort ascending (best first). Ties broken by lower priority then name (stable). */
export function rank(candidates: Candidate[]): Scored[] {
  return candidates
    .map((c) => ({ ...c, score: scoreCandidate(c) }))
    .sort((a, b) => a.score - b.score || a.priority - b.priority || a.name.localeCompare(b.name));
}

export interface HysteresisOptions {
  /** Challenger must beat the active's score by at least this margin to be considered. */
  margin?: number;
  /** Challenger must stay ahead this many consecutive rounds before takeover. */
  holdRounds?: number;
}

export interface HysteresisState {
  /** Name of the challenger currently accumulating hold rounds (or null). */
  challenger: string | null;
  /** How many consecutive rounds the challenger has led by >= margin. */
  streak: number;
}

export const EMPTY_HYSTERESIS: HysteresisState = { challenger: null, streak: 0 };

export interface ChoiceResult {
  /** Winning transport name, or null if nothing eligible. */
  winner: string | null;
  /** Updated hysteresis state to feed into the next round. */
  state: HysteresisState;
  /** True when the winner differs from the previous active (a failover/takeover happened). */
  switched: boolean;
  /** Human-readable reason (decision-log). */
  reason: string;
}

/**
 * PURE: choose the active transport with anti-flap hysteresis.
 * - If the active is ineligible (unhealthy/open) → immediate failover to best eligible.
 * - If a challenger is better but within margin / not held long enough → keep active.
 * - Takeover only when challenger leads by >= margin for >= holdRounds consecutive rounds.
 */
export function chooseWithHysteresis(
  activeName: string | null,
  candidates: Candidate[],
  prev: HysteresisState = EMPTY_HYSTERESIS,
  opts: HysteresisOptions = {},
): ChoiceResult {
  const margin = opts.margin ?? 50;
  const holdRounds = opts.holdRounds ?? 2;
  const ranked = rank(candidates);
  const eligible = ranked.filter((c) => Number.isFinite(c.score));

  const best = eligible[0];
  if (!best) {
    return { winner: null, state: EMPTY_HYSTERESIS, switched: false, reason: "no eligible transport" };
  }
  const active = eligible.find((c) => c.name === activeName) ?? null;

  // No current active (or it became ineligible) → take the best immediately.
  if (!active) {
    return {
      winner: best.name,
      state: EMPTY_HYSTERESIS,
      switched: activeName !== null && activeName !== best.name,
      reason: activeName ? `failover: ${activeName} ineligible → ${best.name}` : `initial: ${best.name}`,
    };
  }

  // Active still eligible and is the best → keep, clear any challenger streak.
  if (best.name === active.name) {
    return { winner: active.name, state: EMPTY_HYSTERESIS, switched: false, reason: `hold active ${active.name} (best)` };
  }

  // A challenger leads. Only count it if it beats the active by >= margin.
  const lead = active.score - best.score;
  if (lead < margin) {
    return {
      winner: active.name,
      state: EMPTY_HYSTERESIS,
      switched: false,
      reason: `hold active ${active.name} (challenger ${best.name} lead ${lead.toFixed(1)} < margin ${margin})`,
    };
  }

  // Challenger leads by margin — accumulate streak (reset if challenger identity changed).
  const streak = prev.challenger === best.name ? prev.streak + 1 : 1;
  if (streak >= holdRounds) {
    return {
      winner: best.name,
      state: EMPTY_HYSTERESIS,
      switched: true,
      reason: `takeover: ${best.name} led ${active.name} by ${lead.toFixed(1)}>=${margin} for ${streak} rounds`,
    };
  }
  return {
    winner: active.name,
    state: { challenger: best.name, streak },
    switched: false,
    reason: `hold active ${active.name} (challenger ${best.name} streak ${streak}/${holdRounds})`,
  };
}
