/**
 * orchestration/bin/lib/answer-research.ts — PURE corroboration core of the research-until-verified
 * loop (GROUNDED-ANSWER.md §research). "It is either right or wrong": a fact answer becomes
 * DEFINITIVE only when INDEPENDENT channels AGREE on the same key fact. One channel's claim is a
 * candidate, never an answer. Disagreement or silence → the loop keeps researching on the next
 * channel; only after every channel is exhausted does the system report the impasse honestly
 * (with every candidate + source on the record, and the gap remembered for retry).
 *
 * Pure and deterministic: key-fact extraction + agreement counting. IO (the actual channel calls)
 * lives in bin/answer.ts.
 */

export interface ResearchAttempt {
  channel: string;   // e.g. "odysseus-research", "cloud:groq", "cloud:gemini"
  text: string;      // the channel's full answer text
  ok: boolean;       // channel produced usable text
}

export interface Corroboration {
  /** The agreed key fact (≥2 independent channels) — null while no agreement exists. */
  agreed: string | null;
  /** votes per normalized key fact, with the channels that back each. */
  votes: Array<{ fact: string; channels: string[] }>;
}

/**
 * Extract the KEY FACT from an answer text, deterministically:
 * 1) a 3-4 digit year or any number (most factual questions resolve to one) — first match wins;
 * 2) otherwise the first line, lowercased, stripped of punctuation/filler, first 8 tokens.
 * Normalization makes "2012." and "In 2012, Microsoft…" corroborate.
 */
export function extractKeyFact(text: string): string | null {
  const t = text.trim();
  if (!t) return null;
  const num = /-?\d+(?:[.,]\d+)?/.exec(t);
  if (num) return num[0].replace(",", ".");
  const firstLine = t.split("\n")[0].toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const tokens = firstLine.split(" ").filter((w) => w.length > 2).slice(0, 8);
  return tokens.length ? tokens.join(" ") : null;
}

/** Count agreement across attempts. DEFINITIVE requires ≥2 DISTINCT channels on the same key fact. */
export function corroborate(attempts: ResearchAttempt[]): Corroboration {
  const byFact = new Map<string, Set<string>>();
  for (const a of attempts) {
    if (!a.ok) continue;
    const fact = extractKeyFact(a.text);
    if (!fact) continue;
    const set = byFact.get(fact) ?? new Set<string>();
    set.add(a.channel);
    byFact.set(fact, set);
  }
  const votes = Array.from(byFact.entries())
    .map(([fact, channels]) => ({ fact, channels: Array.from(channels).sort() }))
    .sort((x, y) => y.channels.length - x.channels.length || x.fact.localeCompare(y.fact));
  const top = votes[0];
  return { agreed: top && top.channels.length >= 2 ? top.fact : null, votes };
}

/** Honest impasse report: every candidate with its backers — nothing smoothed over. */
export function renderImpasse(votes: Corroboration["votes"], rounds: number): string {
  if (votes.length === 0) return `researched ${rounds} channel(s) — no channel produced a usable claim`;
  return `researched ${rounds} channel(s) — NO ≥2-channel agreement yet. Candidates on the record: `
    + votes.map((v) => `"${v.fact}" (${v.channels.join("+")})`).join(" · ");
}
