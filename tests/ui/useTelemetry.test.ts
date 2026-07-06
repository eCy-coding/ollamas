import { describe, it, expect } from "vitest";
import { mergeEvent, type RequestEventVM } from "../../src/components/cockpit/useTelemetry";

// Guards the ModelOps duplicate-rows fix: the SSE stream replays its buffer on connect (overlapping the
// /recent snapshot), so a naive append piled the same event up to CAP. mergeEvent dedups by requestId+ts.
const ev = (requestId: string, ts: number): RequestEventVM => ({
  ts, providerName: "ollama-local", requestId, status: "ok",
  inputTokens: 1, outputTokens: 2, totalMs: 100, costUsd: 0, stream: false, routeAttempt: 0,
});

describe("mergeEvent — telemetry feed dedup", () => {
  it("appends a genuinely new event", () => {
    const out = mergeEvent([ev("a", 1)], ev("b", 2));
    expect(out.map((e) => e.requestId)).toEqual(["a", "b"]);
  });

  it("drops a duplicate (same requestId+ts) and returns the SAME array ref (no re-render)", () => {
    const list = [ev("a", 1)];
    const out = mergeEvent(list, ev("a", 1));
    expect(out).toBe(list);            // identity preserved → hook skips setEvents
    expect(out).toHaveLength(1);
  });

  it("a replayed snapshot never grows the feed (18 uniq stay 18, not 200)", () => {
    let list: RequestEventVM[] = Array.from({ length: 18 }, (_, i) => ev(`r${i}`, 1000 + i));
    // simulate the stream replaying the same 18 events several times
    for (let round = 0; round < 5; round++) for (const e of [...list]) list = mergeEvent(list, e);
    expect(list).toHaveLength(18);
  });

  it("caps the feed length", () => {
    let list: RequestEventVM[] = [];
    for (let i = 0; i < 250; i++) list = mergeEvent(list, ev(`r${i}`, i), 200);
    expect(list).toHaveLength(200);
    expect(list[0].requestId).toBe("r50"); // oldest 50 dropped
  });
});
