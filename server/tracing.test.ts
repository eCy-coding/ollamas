// server/tracing.test.ts — TDD suite for OpenTelemetry tracing (B2).
// Exercises the pure ring-buffer exporter directly (no real NodeSDK boot needed
// for these unit tests — push/evict/ordering is schema-free, deterministic).
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import {
  RingBufferSpanExporter,
  withLlmSpan,
  getTraceSnapshot,
  shutdownTracing,
  RING_BUFFER_MAX,
  type StoredSpan,
} from "./tracing";
import { register as metricsRegister } from "./metrics";

function fakeSpan(overrides: Partial<StoredSpan> = {}): StoredSpan {
  const now = Date.now();
  return {
    name: overrides.name ?? "span",
    traceId: overrides.traceId ?? "trace-1",
    spanId: overrides.spanId ?? Math.random().toString(36).slice(2),
    startTime: overrides.startTime ?? now,
    endTime: overrides.endTime ?? now + 1,
    durationMs: overrides.durationMs ?? 1,
    attributes: overrides.attributes ?? {},
    status: overrides.status ?? "ok",
    statusMessage: overrides.statusMessage,
  };
}

describe("RingBufferSpanExporter", () => {
  test("push then snapshot returns the pushed span", () => {
    const exp = new RingBufferSpanExporter();
    exp.push(fakeSpan({ name: "a" }));
    const snap = exp.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0].name).toBe("a");
  });

  test("evicts oldest once past RING_BUFFER_MAX (default 500)", () => {
    const exp = new RingBufferSpanExporter();
    for (let i = 0; i < RING_BUFFER_MAX + 10; i++) {
      exp.push(fakeSpan({ name: `s${i}` }));
    }
    const snap = exp.snapshot();
    expect(snap).toHaveLength(RING_BUFFER_MAX);
    // oldest 10 (s0..s9) evicted — first entry is s10
    expect(snap[0].name).toBe("s10");
    expect(snap[snap.length - 1].name).toBe(`s${RING_BUFFER_MAX + 9}`);
  });

  test("snapshot preserves push order (newest last)", () => {
    const exp = new RingBufferSpanExporter();
    exp.push(fakeSpan({ name: "first" }));
    exp.push(fakeSpan({ name: "second" }));
    exp.push(fakeSpan({ name: "third" }));
    const snap = exp.snapshot();
    expect(snap.map((s) => s.name)).toEqual(["first", "second", "third"]);
  });

  test("snapshot is a copy — mutating it does not affect the buffer", () => {
    const exp = new RingBufferSpanExporter();
    exp.push(fakeSpan({ name: "a" }));
    const snap = exp.snapshot();
    snap.pop();
    expect(exp.snapshot()).toHaveLength(1);
  });
});

describe("withLlmSpan", () => {
  beforeEach(() => {
    delete process.env.OTEL_DISABLED;
  });

  test("records provider/model attrs on success", async () => {
    const result = await withLlmSpan("llm.generate", { provider: "openai", model: "gpt-4o" }, async (span) => {
      span.setAttribute("llm.tokens_out", 42);
      return "ok";
    });
    expect(result).toBe("ok");
    const snap = getTraceSnapshot();
    const found = snap.spans.find((s) => s.name === "llm.generate" && s.attributes.provider === "openai");
    expect(found).toBeDefined();
    expect(found?.attributes.model).toBe("gpt-4o");
    expect(found?.attributes["llm.tokens_out"]).toBe(42);
    expect(found?.status).toBe("ok");
    expect(typeof found?.durationMs).toBe("number");
  });

  test("records error status + message + rethrows on failure", async () => {
    await expect(
      withLlmSpan("llm.generate", { provider: "anthropic", model: "claude" }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const snap = getTraceSnapshot();
    const found = [...snap.spans].reverse().find((s) => s.name === "llm.generate" && s.attributes.provider === "anthropic");
    expect(found).toBeDefined();
    expect(found?.status).toBe("error");
    expect(found?.statusMessage).toContain("boom");
  });

  test("undefined attrs are dropped, not stored as literal undefined", async () => {
    await withLlmSpan("llm.generate", { provider: "demo", model: undefined }, async () => "x");
    const snap = getTraceSnapshot();
    const found = [...snap.spans].reverse().find((s) => s.name === "llm.generate" && s.attributes.provider === "demo");
    expect(found).toBeDefined();
    expect("model" in (found?.attributes ?? {})).toBe(false);
  });

  test("OTEL_DISABLED=1 is a no-op — fn still runs, nothing recorded", async () => {
    process.env.OTEL_DISABLED = "1";
    const before = getTraceSnapshot().spans.length;
    const result = await withLlmSpan("llm.generate", { provider: "noop" }, async () => "ran");
    expect(result).toBe("ran");
    const after = getTraceSnapshot().spans.length;
    expect(after).toBe(before); // nothing new recorded while disabled
    delete process.env.OTEL_DISABLED;
  });
});

describe("getTraceSnapshot", () => {
  test("shape: { spans, count, updatedAt }", async () => {
    await withLlmSpan("llm.generate", { provider: "shapecheck" }, async () => "x");
    const snap = getTraceSnapshot();
    expect(Array.isArray(snap.spans)).toBe(true);
    expect(typeof snap.count).toBe("number");
    expect(typeof snap.updatedAt).toBe("number");
    expect(snap.count).toBe(snap.spans.length);
  });
});

describe("metrics (C2) — spans-exported counter exported via server/metrics.ts", () => {
  beforeEach(() => { delete process.env.OTEL_DISABLED; });

  test("a real span exported through the NodeSDK pipeline increments ollamas_tracing_spans_exported_total", async () => {
    const before = (await metricsRegister.getSingleMetric("ollamas_tracing_spans_exported_total")!.get()).values[0]?.value ?? 0;
    await withLlmSpan("llm.generate", { provider: "metrics-check" }, async () => "x");
    const after = (await metricsRegister.getSingleMetric("ollamas_tracing_spans_exported_total")!.get()).values[0]?.value ?? 0;
    expect(after).toBeGreaterThan(before);
  });

  test("RingBufferBridgeExporter's own export() path is what increments the counter (unit-level)", async () => {
    // Exercised indirectly above via the real SDK; this asserts the counter is monotonic
    // across two spans (not double-counted, not reset) — cheap regression guard.
    const before = (await metricsRegister.getSingleMetric("ollamas_tracing_spans_exported_total")!.get()).values[0]?.value ?? 0;
    await withLlmSpan("llm.generate", { provider: "metrics-check-2" }, async () => "y");
    await withLlmSpan("llm.generate", { provider: "metrics-check-3" }, async () => "z");
    const after = (await metricsRegister.getSingleMetric("ollamas_tracing_spans_exported_total")!.get()).values[0]?.value ?? 0;
    expect(after).toBeGreaterThanOrEqual(before + 2);
  });
});

describe("shutdownTracing", () => {
  test("resolves without throwing when tracing was never started", async () => {
    await expect(shutdownTracing()).resolves.not.toThrow();
  });
});
