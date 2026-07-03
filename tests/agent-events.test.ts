import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sessionEventsSince,
  sessionStepCount,
  isSessionDone,
  formatSseEvent,
  formatSseDone,
  formatSseError,
  isSessionStalled,
  isStreamTimeout,
} from "../server/agent-events";

// Helper: build a session whose messages[] are the replayable steps.
const sess = (...roles: string[]) => ({
  id: "s1",
  messages: roles.map((role, i) => ({ id: `m${i}`, role, content: `c${i}` })),
});

describe("sessionEventsSince — pure replay/after-filter (v17 P1)", () => {
  test("afterId=-1 (default) replays all steps with index ids", () => {
    const evs = sessionEventsSince(sess("user", "tool", "assistant"));
    expect(evs.map(e => e.id)).toEqual([0, 1, 2]);
    expect(evs[1].data).toMatchObject({ role: "tool", content: "c1" });
  });

  test("after-filter returns only steps strictly after the cursor", () => {
    const s = sess("user", "tool", "tool", "assistant");
    expect(sessionEventsSince(s, 1).map(e => e.id)).toEqual([2, 3]);
    expect(sessionEventsSince(s, 3)).toEqual([]); // caught up
  });

  test("empty / missing / null sessions yield no events (no throw)", () => {
    expect(sessionEventsSince({ messages: [] })).toEqual([]);
    expect(sessionEventsSince({})).toEqual([]);
    expect(sessionEventsSince(null)).toEqual([]);
    expect(sessionEventsSince(undefined)).toEqual([]);
  });

  test("bogus afterId is clamped, never skips real steps or throws", () => {
    const s = sess("user", "assistant");
    expect(sessionEventsSince(s, NaN).map(e => e.id)).toEqual([0, 1]);
    expect(sessionEventsSince(s, -999).map(e => e.id)).toEqual([0, 1]);
    expect(sessionEventsSince(s, 1.9).map(e => e.id)).toEqual([]); // floor(1.9)=1
  });
});

describe("completion + framing helpers", () => {
  test("sessionStepCount is the id-monotonic high-water mark", () => {
    expect(sessionStepCount(sess("user", "assistant"))).toBe(2);
    expect(sessionStepCount({})).toBe(0);
    expect(sessionStepCount(null)).toBe(0);
  });

  test("isSessionDone true only when last step is an assistant turn", () => {
    expect(isSessionDone(sess("user", "tool", "assistant"))).toBe(true);
    expect(isSessionDone(sess("user", "tool"))).toBe(false); // mid-flight
    expect(isSessionDone(sess())).toBe(false); // empty
    expect(isSessionDone(null)).toBe(false);
  });

  test("formatSseEvent emits `id:`/`data:` SSE frame", () => {
    expect(formatSseEvent(2, { role: "assistant", content: "hi" }))
      .toBe(`id: 2\ndata: ${JSON.stringify({ role: "assistant", content: "hi" })}\n\n`);
  });

  test("formatSseDone emits a terminal `event: done` frame", () => {
    expect(formatSseDone({ steps: 3, reason: "complete" }))
      .toBe(`event: done\ndata: ${JSON.stringify({ steps: 3, reason: "complete" })}\n\n`);
  });
});

/**
 * Integration: drive the route's exact compose (replay → poll → done) against a
 * mutable in-memory session, with a fake `res`. No app boot, no new deps. This
 * mirrors the GET /api/agent/sessions/:id/events handler logic 1:1.
 */
describe("SSE tail route integration (fake session in db)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  // A faithful, dependency-free port of the handler body for hermetic testing.
  function tail(db: any, id: string, after: number, res: any) {
    const session = (db.data.sessions || []).find((s: any) => s.id === id);
    if (!session) { res.status(404); res.json({ error: "Agent session not found" }); return; }
    let cursor = after;
    for (const ev of sessionEventsSince(session, after)) { res.write(formatSseEvent(ev.id, ev.data)); cursor = ev.id; }
    if (isSessionDone(session)) { res.write(formatSseDone({ steps: sessionStepCount(session), reason: "complete" })); res.end(); return; }
    const poll = setInterval(() => {
      const live = (db.data.sessions || []).find((s: any) => s.id === id);
      if (!live) { res.write(formatSseDone({ steps: cursor + 1, reason: "gone" })); clearInterval(poll); res.end(); return; }
      for (const ev of sessionEventsSince(live, cursor)) { res.write(formatSseEvent(ev.id, ev.data)); cursor = ev.id; }
      if (isSessionDone(live)) { res.write(formatSseDone({ steps: sessionStepCount(live), reason: "complete" })); clearInterval(poll); res.end(); }
    }, 500);
  }

  const fakeRes = () => {
    const out: string[] = [];
    return { out, ended: false, code: 0,
      write(s: string) { out.push(s); }, end() { this.ended = true; },
      status(c: number) { this.code = c; return this; }, json() {} };
  };

  test("404 when session missing", () => {
    const res = fakeRes();
    tail({ data: { sessions: [] } }, "nope", -1, res);
    expect(res.code).toBe(404);
    expect(res.out).toEqual([]);
  });

  test("respects ?after and live-tails newly appended steps to done", () => {
    const session = sess("user", "tool"); // mid-flight
    const db = { data: { sessions: [session] } };
    const res = fakeRes();
    tail(db, "s1", 0, res); // after=0 → skip step 0, replay step 1

    expect(res.out).toEqual([formatSseEvent(1, session.messages[1])]);
    expect(res.ended).toBe(false);

    // Agent appends another tool step, then its final assistant answer.
    session.messages.push({ id: "m2", role: "tool", content: "c2" });
    vi.advanceTimersByTime(500);
    expect(res.out.at(-1)).toBe(formatSseEvent(2, session.messages[2]));
    expect(res.ended).toBe(false);

    session.messages.push({ id: "m3", role: "assistant", content: "final" });
    vi.advanceTimersByTime(500);
    expect(res.out.at(-2)).toBe(formatSseEvent(3, session.messages[3]));
    expect(res.out.at(-1)).toBe(formatSseDone({ steps: 4, reason: "complete" }));
    expect(res.ended).toBe(true);
  });

  test("already-complete session replays then ends immediately (no poll)", () => {
    const db = { data: { sessions: [sess("user", "assistant")] } };
    const res = fakeRes();
    tail(db, "s1", -1, res);
    expect(res.out.at(-1)).toBe(formatSseDone({ steps: 2, reason: "complete" }));
    expect(res.ended).toBe(true);
  });
});

describe("formatSseError — terminal error frame (errors-resilience stream)", () => {
  test("frames an SSE `error` event with JSON payload", () => {
    expect(formatSseError({ reason: "stalled", after: 3 })).toBe(
      `event: error\ndata: ${JSON.stringify({ reason: "stalled", after: 3 })}\n\n`,
    );
  });
  test("distinct from the done frame", () => {
    expect(formatSseError({ x: 1 })).not.toBe(formatSseDone({ x: 1 }));
  });
});

describe("isSessionStalled — quiescence stall guard (no clock, caller passes quiet time)", () => {
  test("no growth + quiet >= max → stalled", () => {
    expect(isSessionStalled(3, 3, 31_000, 30_000)).toBe(true);
    expect(isSessionStalled(3, 3, 30_000, 30_000)).toBe(true);
  });
  test("still growing → not stalled even if quiet exceeds max", () => {
    expect(isSessionStalled(3, 4, 99_000, 30_000)).toBe(false);
  });
  test("no growth but not quiet long enough → not stalled", () => {
    expect(isSessionStalled(3, 3, 10_000, 30_000)).toBe(false);
  });
});

describe("isStreamTimeout — hard stream-duration guard (no clock, caller passes elapsed time)", () => {
  test("elapsed >= max → timed out", () => {
    expect(isStreamTimeout(30_000, 30_000)).toBe(true);
    expect(isStreamTimeout(31_000, 30_000)).toBe(true);
  });
  test("elapsed < max → not timed out", () => {
    expect(isStreamTimeout(29_999, 30_000)).toBe(false);
    expect(isStreamTimeout(0, 30_000)).toBe(false);
  });
});
