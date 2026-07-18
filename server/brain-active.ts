// Brain always-on helpers (Tur 17) — the pure decision logic that makes memory
// AUTOMATIC by default (2026 SOTA: recall before every turn, retain after every turn,
// without the model choosing to call a tool). server.ts wires these into the ReAct loop.
import type { BrainMemoryInput } from "./brain";

/** Per-turn retain (SOTA "write every turn", $0): fold the last user+assistant exchange
 *  into ONE working-tier memory. Embed-only (no LLM) — the ring buffer + dedup keep it
 *  from bloating, and the daily maintenance daemon decays it. Returns null when there's
 *  no usable exchange (nothing to remember). */
export function buildTurnMemory(
  messages: { role: string; content?: string }[],
  sessionId?: string,
): BrainMemoryInput | null {
  const turns = (messages || []).filter(
    (m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim(),
  );
  const lastUser = [...turns].reverse().find((m) => m.role === "user");
  const lastAssistant = [...turns].reverse().find((m) => m.role === "assistant");
  if (!lastUser && !lastAssistant) return null;
  const parts: string[] = [];
  if (lastUser) parts.push(`S: ${lastUser.content}`);
  if (lastAssistant) parts.push(`Y: ${lastAssistant.content}`);
  return {
    tier: "working",
    content: parts.join("\n").slice(0, 2000),
    source: sessionId ? `turn:${sessionId}` : "turn",
    confidence: 0.6,
  };
}

// A-MAC admission markers (Tur-2 AI-Mode research): deterministic keyword buckets that
// signal future actionability — temporal commitments, preferences, tasks. TR+EN.
const ADMIT_TEMPORAL =
  /\b(yar[ıi]n|bug[üu]n|pazartesi|sal[ıi]|çarşamba|perşembe|cuma|cumartesi|pazar|hafta|saat|deadline|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|until|every)\b/iu;
const ADMIT_PREFERENCE =
  /\b(sever|sevmez|tercih|istemiyor|nefret|alerji|prefers?|hates?|loves?|likes?|dislikes?|always|never|asla|daima|allergic)\b/iu;
const ADMIT_TASK =
  /\b(remind|need to|must|plan|todo|fix|deploy|kur|oluştur|yap[ıi]lacak|gerek|laz[ıi]m|hat[ıi]rlat|unutma)\b/iu;

/** A-MAC admission score (0..1): high-value token density (numbers, code ids/paths,
 *  interior-uppercase names, mid-sentence proper nouns) plus actionability-marker
 *  bonuses. Pure, zero-dep, embed-free — it runs BEFORE any write or embedding, so
 *  dropping a noise turn also spares the embedder. Sentence-start capitals (incl.
 *  after `.:!?` or a newline, e.g. the "S:"/"Y:" fold prefixes) do not count. */
export function admissionScore(text: string): number {
  const t = (text || "").trim();
  if (!t) return 0;
  const rawTokens = t.split(/\s+/);
  let highValue = 0;
  let sentenceStart = true;
  for (const raw of rawTokens) {
    const w = raw.replace(/^[^\p{L}\p{N}`~/._:\\-]+|[^\p{L}\p{N}`~/._:\\-]+$/gu, "");
    const startsSentence = sentenceStart;
    sentenceStart = /[.:!?\n]$/.test(raw);
    if (!w) continue;
    if (/\d/.test(w)) highValue++;
    else if (w.length > 2 && /[/_.:`\\-]/.test(w)) highValue++; // paths, urls, code ids
    else if (/\p{Lu}/u.test(w.slice(1))) highValue++; // camelCase / ALLCAPS interior
    else if (!startsSentence && w.length > 2 && /^\p{Lu}\p{Ll}/u.test(w)) highValue++; // mid-sentence proper noun (real Aa shape — not fold prefixes like "Y:")
  }
  let bonus = 0;
  if (ADMIT_TEMPORAL.test(t)) bonus += 0.25;
  if (ADMIT_PREFERENCE.test(t)) bonus += 0.25;
  if (ADMIT_TASK.test(t)) bonus += 0.25;
  return Math.min(1, highValue / rawTokens.length + bonus);
}

/** Admission gate for the per-turn retain: below BRAIN_ADMIT_MIN (default 0.1) the
 *  exchange is noise ("tamam", "hi") — not worth a row, a vector, or maintenance
 *  work. BRAIN_ADMIT=0 turns the filter off (legacy write-every-turn). */
export function admitsTurn(
  content: string,
  env: { BRAIN_ADMIT?: string; BRAIN_ADMIT_MIN?: string } = process.env,
): boolean {
  if (env.BRAIN_ADMIT === "0") return true;
  const min = Number(env.BRAIN_ADMIT_MIN);
  return admissionScore(content) >= (Number.isFinite(min) && min > 0 ? min : 0.1);
}

/** Distill provider resolution: the periodic durable extraction defaults to the KEYLESS
 *  $0 provider (pollinations) unless BRAIN_DISTILL_PROVIDER is pinned — so auto-distill
 *  being on-by-default never spends the session's (possibly paid) provider budget. */
export function resolveDistillProvider(env: { BRAIN_DISTILL_PROVIDER?: string }): string {
  return env.BRAIN_DISTILL_PROVIDER || "pollinations";
}

/** Opt-out flag reader: a brain active-behavior is ON unless explicitly set to "0". */
export const activeOn = (v: string | undefined): boolean => v !== "0";

/** Session-end distill (S1): the %10 periodic cadence never fires for short sessions
 *  (<10 msgs) or trailing messages after the last multiple of 10 — those sessions were
 *  never consolidated at all. An idle timer (re-armed each turn) closes that hole:
 *  fire only when messages actually landed since the last distill of any kind. */
export const shouldIdleDistill = (len: number, distilledLen: number): boolean =>
  len > 0 && len > distilledLen;

/** Idle window before a quiet session counts as ended (default 10 min). */
export const idleDistillMs = (env: { BRAIN_DISTILL_IDLE_MS?: string }): number => {
  const n = Number(env.BRAIN_DISTILL_IDLE_MS);
  return Number.isFinite(n) && n > 0 ? n : 600_000;
};

/** B2 relative-time recall (2026 gap-audit): resolve TR/EN relative expressions in a
 *  query to an absolute [since, until] window over createdAt. Pure — `now` injectable.
 *  Returns null when the query carries no time cue (recall stays semantic-only). */
export function parseTemporalFilter(query: string, now: number): { since: number; until: number } | null {
  const q = (query || "").toLowerCase();
  const d = 86_400_000;
  const lastN = q.match(/\b(?:son|last|past)\s+(\d{1,3})\s*(?:gün|gun|days?)\b/);
  if (lastN) return { since: now - Number(lastN[1]) * d, until: now };
  if (/\b(dün|dun|yesterday)\b/.test(q)) return { since: now - 2 * d, until: now };
  if (/\b(geçen hafta|gecen hafta|last week)\b/.test(q)) return { since: now - 14 * d, until: now - 7 * d + d };
  if (/\b(bugün|bugun|today)\b/.test(q)) return { since: now - d, until: now };
  if (/\b(geçen ay|gecen ay|last month)\b/.test(q)) return { since: now - 60 * d, until: now - 30 * d + d };
  return null;
}
