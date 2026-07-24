// 75/25 lookahead (pure) — start preparing the next task while this one finishes.
//
// WHY THIS EXISTS
// The operator's working rule, stated directly: *"1 görevi %75 tamamlarken bir sonrasındaki
// yapılması gerekenleri hesapla; görevin %25'i bir sonraki adımın planlamasıyla eş zamanlı
// tamamlansın"* — when a task reaches 75 %, compute what the next one needs, so the final
// 25 % overlaps with preparing the next step.
//
// That is a pipelining rule, and this pipeline had the opposite shape: every run started
// cold. The last waves of a run (`merge`, `commit`, `push`) are cheap and touch nothing the
// next run needs, so the container pool and the search/think caches sat idle exactly when
// they could have been filling.
//
// The trigger, the plan and the accounting are pure so the interesting properties — fires
// once, fires at the right boundary, never blocks — are testable without a container daemon.

/** The operator's number. Exported so the gate can assert the trigger did not drift. */
export const LOOKAHEAD_AT = 0.75;

export interface Progress {
  done: number;
  total: number;
  ratio: number;
}

export function progress(done: number, total: number): Progress {
  const t = Math.max(0, total);
  const d = Math.min(Math.max(0, done), t);
  return { done: d, total: t, ratio: t === 0 ? 0 : Number((d / t).toFixed(4)) };
}

/**
 * Has the run crossed the boundary?
 *
 * `>=` on purpose: with 18 steps the 75 % mark lands on step 13.5, so the crossing step is
 * the first at-or-past it. `already` makes the caller's latch explicit rather than leaving
 * "fire once" to a stray boolean somewhere in the runner.
 */
export function shouldPrefetch(p: Progress, already: boolean, at = LOOKAHEAD_AT): boolean {
  if (already) return false;
  if (p.total <= 0) return false;
  return p.ratio >= at;
}

export interface NextPlan {
  /** Profile the next run will use. */
  profile: string;
  /** Question whose search/think results are worth warming. */
  question: string;
  /** Containers to pre-start so the next `sandbox_test` borrows instead of cold-starting. */
  poolSize: number;
  /** Cache entries worth filling now: `search` costs a subprocess, `think` costs an LLM call. */
  prefetch: Array<"search" | "think">;
  reason: string;
}

/**
 * What the next run needs.
 *
 * Rotation rather than repetition: re-running the same profile would warm a cache that the
 * next run hits anyway, measuring nothing. Advancing to the next profile prepares work that
 * is genuinely ahead — and it is what a benchmark sweep does next in any case.
 */
export function nextPlan(
  current: string,
  profiles: string[],
  opts: { poolSize?: number; questionOf?: (p: string) => string } = {},
): NextPlan | null {
  if (!profiles.length) return null;
  const idx = profiles.indexOf(current);
  const next = idx >= 0 && idx + 1 < profiles.length ? profiles[idx + 1] : profiles[0];
  return {
    profile: next,
    question: opts.questionOf?.(next) ?? next,
    poolSize: opts.poolSize ?? 3,
    prefetch: ["search", "think"],
    reason: idx >= 0 && idx + 1 < profiles.length
      ? `advancing ${current} → ${next}`
      : `wrapping to ${next} (last profile in the sweep)`,
  };
}

export interface LookaheadOutcome {
  fired: boolean;
  /** Ratio at the moment the trigger fired — proof it fired at the right boundary. */
  firedAt?: number;
  plan?: NextPlan;
  /** Wall-clock the preparation took, overlapped with the tail of the current run. */
  prepMs?: number;
  /** Work the preparation actually completed. */
  warmed?: number;
  prefetched?: string[];
  error?: string;
}

/**
 * Time saved by the overlap.
 *
 * Deliberately conservative: only counts preparation that OVERLAPPED the remaining work.
 * If the tail finished in 200 ms while the prep took 3 s, 200 ms was saved — the other
 * 2.8 s ran after the run ended and bought nothing. Reporting the full prep time as a gain
 * would be the kind of flattering arithmetic this pipeline exists to refuse.
 */
export function savedMs(prepMs: number | undefined, tailMs: number): number {
  if (!prepMs || prepMs <= 0 || tailMs <= 0) return 0;
  return Math.round(Math.min(prepMs, tailMs));
}

/** One-line status for the CLI and the report. */
export function renderLookahead(o: LookaheadOutcome, saved: number): string {
  if (!o.fired) return "lookahead: not triggered (run too short to cross 75%)";
  if (o.error) return `lookahead: fired at ${o.firedAt} but preparation failed — ${o.error}`;
  return `lookahead: fired at ${o.firedAt} → ${o.plan?.profile} · warmed ${o.warmed ?? 0} container(s) · ` +
    `prefetched ${(o.prefetched ?? []).join("+") || "nothing"} · overlapped ${saved}ms`;
}
