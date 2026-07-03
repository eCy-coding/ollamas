/**
 * Pure helpers for live-tailing a running agent session over SSE (v17 Phase 1).
 *
 * IMPORTANT SHAPE NOTE: agent sessions (`ChatSession`, server/db) persist their
 * per-turn record in `messages[]` (ChatMessage), NOT `steps[]`. There is also no
 * dedicated `status`/`done`/`endedAt` field on the session — the only completion
 * signal the chat handler writes is `updatedAt` (bumped once at ReAct-loop end with
 * the final assistant turn appended). So "a step" here = one `messages[]` entry and
 * the id = its array index. Completion is detected by quiescence: the caller polls,
 * and when the message count stops growing AND the last message is an assistant turn
 * (the agent's final answer), the stream emits `event: done`.
 *
 * All functions are I/O-free (no socket/disk/clock) so they unit-test in isolation.
 */

/** Minimal structural view of a session — index-addressable replayable units. */
export interface TailableSession {
  messages?: Array<{ role?: string; [k: string]: any }>;
}

/** One SSE-ready event: `id` is the step index, `data` the (already-selected) step. */
export interface SessionEvent {
  id: number;
  data: any;
}

/**
 * Replay every step whose index is strictly greater than `afterId`.
 * `afterId = -1` (default) returns all steps. Out-of-range / negative afterId is
 * clamped so a bogus `?after=` never throws and never skips real steps.
 */
export function sessionEventsSince(session: TailableSession | null | undefined, afterId = -1): SessionEvent[] {
  const steps = session?.messages;
  if (!Array.isArray(steps) || steps.length === 0) return [];
  const from = Number.isFinite(afterId) ? Math.max(-1, Math.floor(afterId)) : -1;
  const out: SessionEvent[] = [];
  for (let i = from + 1; i < steps.length; i++) {
    out.push({ id: i, data: steps[i] });
  }
  return out;
}

/** Number of replayable steps currently in the session (id-monotonic high-water mark). */
export function sessionStepCount(session: TailableSession | null | undefined): number {
  const steps = session?.messages;
  return Array.isArray(steps) ? steps.length : 0;
}

/**
 * Completion heuristic (no status field exists — see module header).
 * Done when the session has at least one step AND its last step is an assistant
 * turn, i.e. the ReAct loop appended its final answer. A session still mid-flight
 * ends on a `user`/`tool`/`system` turn (or is empty), so this stays false until
 * the agent actually finishes.
 */
export function isSessionDone(session: TailableSession | null | undefined): boolean {
  const steps = session?.messages;
  if (!Array.isArray(steps) || steps.length === 0) return false;
  return steps[steps.length - 1]?.role === "assistant";
}

/** Frame a single SSE message: `id: <n>\ndata: <json>\n\n`. */
export function formatSseEvent(id: number, data: any): string {
  return `id: ${id}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Frame the terminal `done` event. */
export function formatSseDone(payload: Record<string, any>): string {
  return `event: done\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Frame a terminal `error` event. The tail is completion-detected by quiescence (see module header) and
 * only ever emits `done`; a session that stalls or errors would otherwise tail forever. This lets the
 * caller emit an explicit `error` frame so the client stops instead of hanging. (errors-resilience stream)
 */
export function formatSseError(payload: Record<string, any>): string {
  return `event: error\ndata: ${JSON.stringify(payload)}\n\n`;
}

/**
 * Stall guard for the quiescence poll: true when the step count has NOT grown (curCount === prevCount)
 * AND it has been quiet at least `maxQuietMs`. The caller uses this to emit `formatSseError` instead of
 * tailing a hung/errored session indefinitely. Pure (no clock): the caller passes the measured quiet time.
 */
export function isSessionStalled(prevCount: number, curCount: number, quietMs: number, maxQuietMs: number): boolean {
  return curCount === prevCount && quietMs >= maxQuietMs;
}

/** Timeout guard for SSE stream: true when the elapsed time exceeds `maxStreamMs`. */
export function isStreamTimeout(elapsedMs: number, maxStreamMs: number): boolean {
  return elapsedMs >= maxStreamMs;
}
