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
  };
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
