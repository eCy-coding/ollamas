/**
 * orchestration/bin/lib/org-learn.ts — PURE learned-authority model (ORG v3, RESEARCH-ORG.md §v3).
 *
 * Authorities and responsibilities are BUILT LIKE MACHINE LEARNING: nothing is hardcoded per actor —
 * `trainPolicy` retrains the whole policy from the brain ledger (online learning), promoting/demoting
 * every actor on its Wilson-lower-bound evidence (curriculum ladder observe → propose → apply-gated →
 * trusted; demotion always wins; a recurrence caps authority), and `selectActor` balances
 * exploration/exploitation with UCB1 (Auer et al. 2002 — untried arm bids ∞, deterministic ties).
 *
 * SAFETY INVARIANT: a learned authority NEVER weakens the deterministic gates. "trusted" only removes
 * the extra review pass — fleet-apply (tsc + tests + revert-on-red) remains mandatory for every apply,
 * and markers/launchd stay T0-only. `allowedAction` is the enforcement point.
 *
 * Discipline as hierarchy.ts/organization.ts: no IO, no clocks (now injected), no Math.random
 * (UCB1 chosen over Thompson sampling precisely because it is deterministic).
 */
import { wilsonLower, type Actor, type ActorStat, type LedgerEntry } from "./organization";

export type AuthorityLevel = "observe" | "propose" | "apply-gated" | "trusted";

export const AUTHORITY_RANK: Record<AuthorityLevel, number> = {
  observe: 0, propose: 1, "apply-gated": 2, trusted: 3,
};

export interface PolicyThresholds {
  promoteApplyN: number;      // min samples before apply-gated
  promoteApplyWilson: number; // min wilson for apply-gated
  promoteTrustN: number;      // min samples before trusted
  promoteTrustWilson: number; // min wilson for trusted
  demoteWilson: number;       // below this (with demoteMinN samples) → observe
  demoteMinN: number;
  recurrenceWindow: number;   // look-back window (outcomes per actor) for recurrence capping
}

export const DEFAULT_THRESHOLDS: PolicyThresholds = {
  promoteApplyN: 5, promoteApplyWilson: 0.6,
  promoteTrustN: 15, promoteTrustWilson: 0.8,
  demoteWilson: 0.3, demoteMinN: 5,
  recurrenceWindow: 20,
};

export interface AuthorityEntry { level: AuthorityLevel; wilson: number; n: number; reason: string; }

export interface OrgPolicy {
  version: number;
  trainedAt: string;
  samples: number;
  authorities: Record<string, AuthorityEntry>;
  bandit: Record<string, { n: number; ok: number }>;
}

/** Empty policy (cold start): everyone unknown → allowedAction falls back to "propose". */
export function emptyPolicy(now: string): OrgPolicy {
  return { version: 1, trainedAt: now, samples: 0, authorities: {}, bandit: {} };
}

/**
 * "Training" = one full policy-improvement pass over the ledger (online learning — call it after every
 * episode/round). Per actor: aggregate outcomes → wilson → curriculum level. Demotion WINS over
 * promotion; a recurrence (same failure signature ≥2 inside the last recurrenceWindow outcomes of that
 * actor) caps the level at "propose" no matter how good the wilson is.
 */
export function trainPolicy(
  ledger: LedgerEntry[],
  opts: { now: string; thresholds?: Partial<PolicyThresholds> },
): OrgPolicy {
  const t = { ...DEFAULT_THRESHOLDS, ...opts.thresholds };
  const byActor = new Map<string, LedgerEntry[]>();
  let samples = 0;
  for (const e of ledger) {
    if (e.type !== "outcome" || typeof e.ok !== "boolean") continue;
    samples += 1;
    const arr = byActor.get(e.actorId) ?? [];
    arr.push(e);
    byActor.set(e.actorId, arr);
  }

  const authorities: Record<string, AuthorityEntry> = {};
  const bandit: Record<string, { n: number; ok: number }> = {};
  for (const [actorId, outcomes] of byActor) {
    const n = outcomes.length;
    const ok = outcomes.filter((e) => e.ok).length;
    const wilson = wilsonLower(ok, n);
    bandit[actorId] = { n, ok };

    // Recurrence cap: same sig ≥2 within the actor's last recurrenceWindow outcomes.
    const recent = outcomes.slice(-t.recurrenceWindow);
    const sigCounts = new Map<string, number>();
    for (const e of recent) if (e.ok === false && e.sig) sigCounts.set(e.sig, (sigCounts.get(e.sig) ?? 0) + 1);
    const hasRecurrence = Array.from(sigCounts.values()).some((c) => c >= 2);

    let level: AuthorityLevel;
    let reason: string;
    if (n >= t.demoteMinN && wilson < t.demoteWilson) {
      level = "observe"; reason = `demoted: wilson ${wilson.toFixed(2)} < ${t.demoteWilson} over n=${n}`;
    } else if (n >= t.promoteTrustN && wilson >= t.promoteTrustWilson) {
      level = "trusted"; reason = `promoted: wilson ${wilson.toFixed(2)} ≥ ${t.promoteTrustWilson} over n=${n}`;
    } else if (n >= t.promoteApplyN && wilson >= t.promoteApplyWilson) {
      level = "apply-gated"; reason = `promoted: wilson ${wilson.toFixed(2)} ≥ ${t.promoteApplyWilson} over n=${n}`;
    } else {
      level = "propose"; reason = `default: insufficient evidence (n=${n}, wilson ${wilson.toFixed(2)})`;
    }
    if (hasRecurrence && AUTHORITY_RANK[level] > AUTHORITY_RANK.propose) {
      level = "propose"; reason = `capped at propose: recurrence inside last ${t.recurrenceWindow} outcomes`;
    }
    authorities[actorId] = { level, wilson, n, reason };
  }

  return { version: 1, trainedAt: opts.now, samples, authorities, bandit };
}

/** UCB1 (Auer et al. 2002): mean + sqrt(2 ln N / n). Untried arm → Infinity (optimistic cold-start). */
export function ucb1(stat: { n: number; ok: number }, totalN: number): number {
  if (stat.n === 0) return Infinity;
  const mean = stat.ok / stat.n;
  return mean + Math.sqrt((2 * Math.log(Math.max(totalN, 1))) / stat.n);
}

/** Exploit-mode score mirrors the v2 rule: wilson with n≥3, else neutral 0. */
const MIN_EVIDENCE_N = 3;
function exploitScore(policy: OrgPolicy, actorId: string): number {
  const s = policy.bandit[actorId];
  return s && s.n >= MIN_EVIDENCE_N ? wilsonLower(s.ok, s.n) : 0;
}

/**
 * Pick one actor from a (cheapest-cost) band. explore = UCB1 (deterministic Infinity-first tie-break
 * by band order → every actor gets tried before any is re-tried); exploit = wilson (v2 semantics).
 */
export function selectActor(band: Actor[], policy: OrgPolicy, mode: "exploit" | "explore"): Actor {
  if (band.length === 0) throw new Error("selectActor: empty band");
  const totalN = Object.values(policy.bandit).reduce((a, s) => a + s.n, 0);
  const score = (a: Actor): number =>
    mode === "explore" ? ucb1(policy.bandit[a.id] ?? { n: 0, ok: 0 }, totalN) : exploitScore(policy, a.id);
  let best = band[0];
  for (const a of band.slice(1)) if (score(a) > score(best)) best = a; // strict > keeps band-order ties
  return best;
}

/** Bridge to the existing assignRole opts.stats (v2 evidence tie-break) — orchestra needs one line. */
export function statsFromPolicy(policy: OrgPolicy): Map<string, ActorStat> {
  const m = new Map<string, ActorStat>();
  for (const [id, s] of Object.entries(policy.bandit)) {
    m.set(id, { n: s.n, ok: s.ok, wilson: wilsonLower(s.ok, s.n) });
  }
  return m;
}

/**
 * The authority GATE (responsibility enforcement). Unknown actor → "propose" default (safe).
 * "apply" requires rank ≥ apply-gated. NOTE: this gate is IN ADDITION to the deterministic
 * fleet-apply gate — trusted never bypasses tsc+tests+revert-on-red.
 */
export function allowedAction(policy: OrgPolicy, actorId: string, action: "observe" | "propose" | "apply"): boolean {
  const level = policy.authorities[actorId]?.level ?? "propose";
  const need = action === "apply" ? AUTHORITY_RANK["apply-gated"] : AUTHORITY_RANK[action];
  return AUTHORITY_RANK[level] >= need;
}

/**
 * Learning-curve evaluation (online-learning metric): per-round success rate, improvement verdict
 * (mean of the last third ≥ mean of the first third), and cumulative regret vs the best final rate.
 */
export function learningCurve(
  episodes: Array<{ round: number; ok: number; total: number }>,
): { perRound: number[]; improved: boolean; regret: number[] } {
  const perRound = episodes.map((e) => (e.total > 0 ? e.ok / e.total : 0));
  if (perRound.length === 0) return { perRound: [], improved: false, regret: [] };
  const third = Math.max(1, Math.floor(perRound.length / 3));
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const improved = mean(perRound.slice(-third)) >= mean(perRound.slice(0, third));
  const best = Math.max(...perRound);
  let cum = 0;
  const regret = perRound.map((r) => { cum += best - r; return cum; });
  return { perRound, improved, regret };
}
