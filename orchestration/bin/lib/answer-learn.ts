/**
 * orchestration/bin/lib/answer-learn.ts — PURE learning core that makes the Definitive Answer
 * Doctrine improve itself (GROUNDED-ANSWER.md §learning).
 *
 * Every research round records per-channel outcomes into the brain ledger (a channel that backed
 * the corroborated fact = hit; a channel whose claim was outvoted = miss — groq's wrong "2014"
 * becomes a permanent, evidence-lowering record). `channelStats` folds those records into Wilson
 * lower bounds (same instrument as the authority trainer) and `orderChannels` re-orders the
 * research loop so the historically-most-accurate channels are consulted FIRST — the loop gets
 * measurably better with every question it answers. Cold channels keep their hand-tuned position
 * (n<3 bids neutral, exactly like the v2 router).
 */
import { wilsonLower, type LedgerEntry } from "./organization";

export interface ChannelStat { n: number; ok: number; wilson: number; }

export const CHANNEL_TASK_PREFIX = "answer-fact:";

/** Fold answer-fact outcome entries (actorId = channel) into per-channel evidence. */
export function channelStats(entries: LedgerEntry[]): Map<string, ChannelStat> {
  const m = new Map<string, ChannelStat>();
  for (const e of entries) {
    if (e.type !== "outcome" || typeof e.ok !== "boolean") continue;
    if (!e.taskId.startsWith(CHANNEL_TASK_PREFIX)) continue;
    const s = m.get(e.actorId) ?? { n: 0, ok: 0, wilson: 0 };
    s.n += 1;
    if (e.ok) s.ok += 1;
    m.set(e.actorId, s);
  }
  for (const s of m.values()) s.wilson = wilsonLower(s.ok, s.n);
  return m;
}

const MIN_EVIDENCE_N = 3;

/**
 * Order channels by learned accuracy: Wilson lower bound DESC for channels with n≥3; thin-evidence
 * channels bid neutral and keep their baseline (hand-tuned) relative order. Deterministic
 * (stable sort by baseline index on ties).
 */
export function orderChannels(baseline: string[], stats: Map<string, ChannelStat>): string[] {
  const score = (id: string): number => {
    const s = stats.get(id);
    return s && s.n >= MIN_EVIDENCE_N ? s.wilson : 0;
  };
  return baseline
    .map((id, i) => ({ id, i, w: score(id) }))
    .sort((a, b) => b.w - a.w || a.i - b.i)
    .map((x) => x.id);
}

/** Ledger outcome entries for one corroboration round: backers = hit, outvoted claimers = miss,
 *  silent channels = miss (they failed to produce a usable claim). Pure — caller persists. */
export function channelOutcomes(
  questionKey: string,
  attempts: Array<{ channel: string; ok: boolean; fact: string | null }>,
  agreed: string | null,
  ts: string,
): LedgerEntry[] {
  if (!agreed) return []; // no ground truth this round — recording would be guessing (doctrine!)
  return attempts.map((a) => {
    const hit = a.ok && a.fact === agreed;
    return {
      type: "outcome" as const,
      tier: hit ? ("episodic" as const) : ("learned" as const),
      ts,
      taskId: `${CHANNEL_TASK_PREFIX}${questionKey}`,
      actorId: a.channel,
      ok: hit,
      summary: hit
        ? `channel backed the corroborated fact "${agreed}"`
        : a.ok
          ? `channel claimed "${a.fact}" but was OUTVOTED (truth: "${agreed}")`
          : "channel produced no usable claim",
    };
  });
}

/** Stable short key for a question (dedupe across re-asks without storing the full text twice). */
export function questionKey(q: string): string {
  let h = 0;
  for (let i = 0; i < q.length; i++) h = (h * 31 + q.charCodeAt(i)) | 0;
  return Math.abs(h).toString(36);
}

/** Human scoreboard for reports: channels with evidence, best first. */
export function renderScoreboard(stats: Map<string, ChannelStat>): string[] {
  return Array.from(stats.entries())
    .sort((a, b) => b[1].wilson - a[1].wilson || b[1].n - a[1].n)
    .map(([id, s]) => `${id.padEnd(22)} ${s.ok}/${s.n} isabet · wilson ${s.wilson.toFixed(2)}`);
}
