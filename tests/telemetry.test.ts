// T5-F1 — per-request telemetry core: pure ring buffer, redaction (zero-leak choke point),
// and rollup statistics (p50/p95 latency+TTFT, error rate, tok/s, cost/hr, provider
// leaderboard). All pure — no sockets, no timers. Field names follow OTel gen_ai.* so a
// future OTel export needs no reshape.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RingBuffer,
  redactEvent,
  rollup,
  recordRequestEvent,
  onRequestEvent,
  recentEvents,
  resetTelemetry,
  type RequestEvent,
} from "../server/telemetry";

const ev = (over: Partial<RequestEvent> = {}): RequestEvent => ({
  ts: 1_700_000_000_000,
  operation: "chat",
  providerName: "groq",
  requestModel: "llama-3.3-70b-versatile",
  responseModel: "llama-3.3-70b-versatile",
  inputTokens: 10,
  outputTokens: 20,
  totalMs: 500,
  requestId: "req_1",
  status: "ok",
  costUsd: 0.0001,
  routeAttempt: 0,
  retryCount: 0,
  stream: false,
  ...over,
});

describe("RingBuffer — O(1) bounded, overwrites oldest", () => {
  it("keeps only the last cap items in insertion order", () => {
    const rb = new RingBuffer<number>(3);
    for (const n of [1, 2, 3, 4, 5]) rb.push(n);
    expect(rb.toArray()).toEqual([3, 4, 5]);
    expect(rb.size).toBe(3);
  });
  it("under-full buffer returns what was pushed", () => {
    const rb = new RingBuffer<number>(5);
    rb.push(1); rb.push(2);
    expect(rb.toArray()).toEqual([1, 2]);
    expect(rb.size).toBe(2);
  });
});

describe("redactEvent — zero-leak choke point", () => {
  it("host-only serverAddress (strips path/query that could carry a key)", () => {
    const r = redactEvent(ev({ serverAddress: "https://api.groq.com/openai/v1?key=gsk_secret" }));
    expect(r.serverAddress).toBe("api.groq.com");
    expect(JSON.stringify(r)).not.toContain("gsk_secret");
  });
  it("strips any secret-shaped substring from every string field", () => {
    const r = redactEvent(ev({ finishReason: "stop gsk_LEAKED1234567890", requestId: "req_sk-abc123def456" }));
    const s = JSON.stringify(r);
    expect(s).not.toMatch(/gsk_LEAKED/);
    expect(s).not.toMatch(/sk-abc123def456/);
  });
  it("keyId (pool-slot label) is preserved as-is — it is already a non-reversible hash", () => {
    const r = redactEvent(ev({ keyId: "a1b2c3d4e5f6" }));
    expect(r.keyId).toBe("a1b2c3d4e5f6");
  });
  it("content capture OFF by default → no promptHash/completionHash even if raw text passed via _prompt", () => {
    const r = redactEvent(ev({ _prompt: "secret user prompt", _completion: "secret answer" } as any));
    expect(r.promptHash).toBeUndefined();
    expect(r.completionHash).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain("secret user prompt");
  });
  it("content capture ON → SHA-256 hash only, never the raw text", () => {
    vi.stubEnv("TELEMETRY_CAPTURE_CONTENT", "1");
    const r = redactEvent(ev({ _prompt: "hello world", _completion: "hi" } as any));
    expect(r.promptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.completionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(r)).not.toContain("hello world");
    vi.unstubAllEnvs();
  });
});

describe("rollup — window statistics", () => {
  it("empty window → zeroed rollup, no NaN", () => {
    const r = rollup([], 1_700_000_100_000);
    expect(r.p50TotalMs).toBe(0);
    expect(r.errorRate).toBe(0);
    expect(r.byProvider).toEqual([]);
    expect(Number.isFinite(r.costPerHr)).toBe(true);
  });
  it("percentiles via nearest-rank; error rate + leaderboard", () => {
    const now = 1_700_000_060_000; // 60s after base
    const events = [
      ev({ ts: now - 50_000, providerName: "groq", totalMs: 100, ttftMs: 40, status: "ok", outputTokens: 50, costUsd: 0.001 }),
      ev({ ts: now - 40_000, providerName: "groq", totalMs: 300, ttftMs: 80, status: "ok", outputTokens: 60, costUsd: 0.002 }),
      ev({ ts: now - 30_000, providerName: "cerebras", totalMs: 200, ttftMs: 60, status: "error", errorType: "429", outputTokens: 0, costUsd: 0 }),
      ev({ ts: now - 10_000, providerName: "groq", totalMs: 500, ttftMs: 120, status: "ok", outputTokens: 40, costUsd: 0.003 }),
    ];
    const r = rollup(events, now);
    expect(r.p50TotalMs).toBeGreaterThan(0);
    expect(r.p95TotalMs).toBe(500); // nearest-rank top
    expect(r.errorRate).toBeCloseTo(0.25, 5);
    const groq = r.byProvider.find((p) => p.provider === "groq")!;
    expect(groq.calls).toBe(3);
    expect(groq.successPct).toBe(100);
    const cere = r.byProvider.find((p) => p.provider === "cerebras")!;
    expect(cere.successPct).toBe(0);
    expect(r.costPerHr).toBeGreaterThan(0);
  });
});

describe("recordRequestEvent / onRequestEvent — emit + buffer (redacted)", () => {
  beforeEach(() => resetTelemetry());
  afterEach(() => resetTelemetry());

  it("records into the buffer redacted and notifies subscribers", () => {
    const seen: RequestEvent[] = [];
    const unsub = onRequestEvent((e) => seen.push(e));
    recordRequestEvent(ev({ serverAddress: "https://api.groq.com/v1?k=gsk_x", requestId: "r1" }));
    expect(seen).toHaveLength(1);
    expect(seen[0].serverAddress).toBe("api.groq.com");
    expect(recentEvents(10)).toHaveLength(1);
    unsub();
    recordRequestEvent(ev({ requestId: "r2" }));
    expect(seen).toHaveLength(1); // unsubscribed
    expect(recentEvents(10)).toHaveLength(2);
  });

  it("a throwing subscriber never breaks recording (telemetry is side-effect-safe)", () => {
    onRequestEvent(() => { throw new Error("boom"); });
    expect(() => recordRequestEvent(ev())).not.toThrow();
    expect(recentEvents(10)).toHaveLength(1);
  });
});
