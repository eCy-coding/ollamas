// T5-F3 — telemetry SSE framing helpers + /api/telemetry/recent snapshot shape. Pure framing
// is unit-tested here; the live endpoint is exercised in the F7 live verification.
import { describe, it, expect, beforeEach } from "vitest";
import { formatTelemetryFrame, telemetrySnapshot } from "../server/telemetry-sse";
import { recordRequestEvent, resetTelemetry } from "../server/telemetry";

const ev = (over: Record<string, unknown> = {}) => ({
  ts: 1_700_000_000_000, operation: "chat" as const, providerName: "groq",
  inputTokens: 5, outputTokens: 10, totalMs: 200, requestId: "r1",
  status: "ok" as const, costUsd: 0.0001, routeAttempt: 0, retryCount: 0, stream: false, ...over,
});

describe("formatTelemetryFrame — named SSE events", () => {
  it("emits `event: <name>` + `data: <json>` + blank-line terminator", () => {
    const frame = formatTelemetryFrame("request", { requestId: "r1" });
    expect(frame).toBe('event: request\ndata: {"requestId":"r1"}\n\n');
  });
  it("rollup frame uses the rollup event name", () => {
    expect(formatTelemetryFrame("rollup", { count: 3 })).toBe('event: rollup\ndata: {"count":3}\n\n');
  });
});

describe("telemetrySnapshot — recent events + rollup", () => {
  beforeEach(() => resetTelemetry());
  it("returns the last-n redacted events and a rollup over them", () => {
    recordRequestEvent(ev({ requestId: "a", serverAddress: "https://api.groq.com/v1?k=gsk_leak" }) as any);
    recordRequestEvent(ev({ requestId: "b", status: "error", errorType: "429" }) as any);
    const snap = telemetrySnapshot(10, 1_700_000_000_500);
    expect(snap.events).toHaveLength(2);
    expect(snap.events[0].serverAddress).toBe("api.groq.com"); // redacted at record time
    expect(JSON.stringify(snap)).not.toContain("gsk_leak");
    expect(snap.rollup.count).toBe(2);
    expect(snap.rollup.errorRate).toBeCloseTo(0.5, 5);
  });
  it("n caps the returned events", () => {
    for (let i = 0; i < 5; i++) recordRequestEvent(ev({ requestId: `r${i}` }) as any);
    expect(telemetrySnapshot(2, 1_700_000_000_500).events).toHaveLength(2);
  });
});
