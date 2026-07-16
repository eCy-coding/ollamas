// server/tracing.ts — distributed tracing (B2): OpenTelemetry NodeSDK boot +
// an in-process ring-buffer span exporter (mirrors server/telemetry.ts's
// RingBuffer pattern) so GET /api/traces can serve a live snapshot with zero
// external backend required. Optional OTLP export layers on top when
// OTEL_EXPORTER_OTLP_ENDPOINT is set — both the ring buffer AND OTLP get every
// span (fan-out via two SpanProcessors on the same TracerProvider), so
// /api/traces never depends on an external collector being reachable.
//
// MUST be imported FIRST in server.ts (before express/http) — NodeSDK's http
// auto-instrumentation monkey-patches node:http at require time via Node's
// module-loader hook; importing this after http is already required would
// miss the patch. (Auto-instrumentation is scoped to http ONLY — express was
// evaluated and rejected; see the rejection note above buildInstrumentationConfig().)
//
// openllmetry-js (@traceloop/node-server-sdk) evaluated and REJECTED: every
// instrumentation package it ships (instrumentation-openai, -anthropic,
// -langchain, -bedrock, -cohere, -vertexai, -together, …) monkey-patches a
// specific SDK CLIENT OBJECT (the `openai` / `@anthropic-ai/sdk` npm
// packages). server/providers.ts talks to every provider via plain `fetch()`
// calls through its own in-house HTTP client (see ProviderRouter.executeProvider)
// — there is no openai/anthropic SDK instance for traceloop to patch, so
// adding it would be dead dependency weight with zero instrumentation payoff.
// Manual spans via withLlmSpan below cover the same ground with no extra
// dependency surface.
import { trace, SpanStatusCode, type Span, type Attributes } from "@opentelemetry/api";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations, type InstrumentationConfigMap } from "@opentelemetry/auto-instrumentations-node";
import { SimpleSpanProcessor, BatchSpanProcessor, type SpanExporter, type ReadableSpan, type SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { ExportResultCode, hrTimeToMilliseconds, type ExportResult } from "@opentelemetry/core";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { RingBuffer } from "./telemetry";
import { tracingSpansExportedTotal } from "./metrics";

// ── Types ────────────────────────────────────────────────────────────────────
export type SpanStatusLabel = "unset" | "ok" | "error";

export interface StoredSpan {
  name: string;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  startTime: number; // epoch ms
  endTime: number; // epoch ms
  durationMs: number;
  attributes: Record<string, string | number | boolean>;
  status: SpanStatusLabel;
  statusMessage?: string;
}

export interface TraceSnapshot {
  spans: StoredSpan[];
  count: number;
  updatedAt: number;
}

function isOtelDisabled(): boolean {
  return process.env.OTEL_DISABLED === "1";
}

// ── Ring-buffer span exporter (pure, testable) ──────────────────────────────
// Keeps the last RING_BUFFER_MAX finished spans in memory, overwrite-oldest —
// same shape/behavior as telemetry.ts's RequestEvent buffer (built on the same
// generic RingBuffer<T>). push()/snapshot() are plain, schema-free methods so
// this class is unit-testable with zero OTel machinery.
export const RING_BUFFER_MAX = 500;

export class RingBufferSpanExporter {
  private buf: RingBuffer<StoredSpan>;

  constructor(capacity = RING_BUFFER_MAX) {
    this.buf = new RingBuffer<StoredSpan>(capacity);
  }

  /** Pure: append one finished span, evicting the oldest once past capacity. */
  push(span: StoredSpan): void {
    this.buf.push(span);
  }

  /** Pure: a fresh array copy, oldest-first (push order) — safe to mutate. */
  snapshot(): StoredSpan[] {
    return this.buf.toArray();
  }

  get size(): number {
    return this.buf.size;
  }
}

const ringExporter = new RingBufferSpanExporter(RING_BUFFER_MAX);
let lastUpdatedAt = Date.now();

function toAttributeRecord(attrs: Attributes): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined) continue;
    out[k] = typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? v : JSON.stringify(v);
  }
  return out;
}

/** SpanExporter adapter: OTel's real ReadableSpan -> our StoredSpan shape,
 *  pushed into the in-process ring buffer. Registered as one of possibly two
 *  SpanProcessors on the TracerProvider (the other, optional, drives OTLP) so
 *  EVERY span (auto http/express + manual withLlmSpan) reaches /api/traces
 *  through exactly one path — no double-recording. */
class RingBufferBridgeExporter implements SpanExporter {
  export(spans: ReadableSpan[], resultCallback: (result: ExportResult) => void): void {
    tracingSpansExportedTotal.inc(spans.length);
    for (const s of spans) {
      const ctx = s.spanContext();
      ringExporter.push({
        name: s.name,
        traceId: ctx.traceId,
        spanId: ctx.spanId,
        parentSpanId: s.parentSpanContext?.spanId,
        startTime: hrTimeToMilliseconds(s.startTime),
        endTime: hrTimeToMilliseconds(s.endTime),
        durationMs: hrTimeToMilliseconds(s.duration),
        attributes: toAttributeRecord(s.attributes),
        status: s.status.code === SpanStatusCode.ERROR ? "error" : s.status.code === SpanStatusCode.OK ? "ok" : "unset",
        statusMessage: s.status.message,
      });
    }
    lastUpdatedAt = Date.now();
    resultCallback({ code: ExportResultCode.SUCCESS });
  }
  shutdown(): Promise<void> {
    return Promise.resolve();
  }
  forceFlush(): Promise<void> {
    return Promise.resolve();
  }
}

/** Cheap snapshot for GET /api/traces — never throws, never null. */
export function getTraceSnapshot(): TraceSnapshot {
  const spans = ringExporter.snapshot();
  return { spans, count: spans.length, updatedAt: lastUpdatedAt };
}

// ── NodeSDK boot ─────────────────────────────────────────────────────────────
// Scoped to http ONLY. "express" was tried and explicitly REJECTED here:
// @opentelemetry/instrumentation-express monkey-patches Router.prototype.use/
// .route at the CLASS level to wrap every handler in a function literally
// named `patched` (unconditionally — the `ignoreLayersType` config option only
// suppresses span emission per request, it does NOT stop the wrap, so it
// can't fix this). That silently destroys `Function.name` on every
// middleware/route handler process-wide, which broke a CRITICAL security
// invariant test (server/__tests__/module-guard.test.ts, INV-O0-1 KN-A9)
// that asserts `localOwnerGuard` sits before every module route by reading
// `layer.handle.name`. The guard itself keeps working correctly at runtime
// (all behavioral 403/200/401 cases still pass) — only introspection by
// name breaks — but that's too invasive a side effect for a tracing add-on
// to impose on unrelated security tests. http-only still gives full
// request/response span coverage (method, route via http target, status,
// duration) without touching Express's handler identity.
const AUTO_INSTRUMENTATION_SUFFIXES = [
  "amqplib", "aws-lambda", "aws-sdk", "bunyan", "cassandra-driver", "connect", "cucumber",
  "dataloader", "dns", "express", "fs", "generic-pool", "graphql", "grpc", "hapi", "host-metrics",
  "ioredis", "kafkajs", "knex", "koa", "lru-memoizer", "memcached", "mongodb", "mongoose",
  "mysql", "mysql2", "nestjs-core", "net", "openai", "oracledb", "pg", "pino", "redis",
  "restify", "router", "runtime-node", "socket.io", "tedious", "undici", "winston",
]; // deliberately excludes only "http" — see rejection note above re: "express"

function buildInstrumentationConfig(): InstrumentationConfigMap {
  const cfg: InstrumentationConfigMap = {};
  for (const suffix of AUTO_INSTRUMENTATION_SUFFIXES) {
    (cfg as Record<string, { enabled: boolean }>)[`@opentelemetry/instrumentation-${suffix}`] = { enabled: false };
  }
  return cfg;
}

let sdk: NodeSDK | null = null;
// SimpleSpanProcessor.onEnd() fires its export as fire-and-forget (not awaited
// inline with span.end()) — @opentelemetry/sdk-trace's SimpleSpanProcessor
// queues `_doExport` and returns immediately, so a span landing in the ring
// buffer can lag span.end() by a few microtask ticks. withLlmSpan awaits this
// processor's forceFlush() (below) before returning so a caller that awaits
// withLlmSpan(...) can immediately see it in getTraceSnapshot() — forceFlush
// on a local in-memory exporter with zero I/O is effectively free. The
// (separate, optional) OTLP processor is intentionally NOT flushed here — it
// batches over the network and must never add per-call latency to the LLM
// request path.
let ringProcessor: SimpleSpanProcessor | null = null;

function startTracing(): void {
  if (sdk || isOtelDisabled()) return;
  ringProcessor = new SimpleSpanProcessor(new RingBufferBridgeExporter());
  const processors: SpanProcessor[] = [ringProcessor];
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otlpEndpoint) {
    // Batched — network export shouldn't add per-span latency to the ring
    // buffer's synchronous, always-on local path above.
    processors.push(new BatchSpanProcessor(new OTLPTraceExporter({ url: otlpEndpoint })));
  }
  sdk = new NodeSDK({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || "ollamas" }),
    spanProcessors: processors,
    instrumentations: [getNodeAutoInstrumentations(buildInstrumentationConfig())],
  });
  try {
    sdk.start();
  } catch (e: any) {
    console.warn(`[Tracing] NodeSDK start failed: ${String(e?.message ?? e).slice(0, 160)}`);
    ringProcessor = null;
  }
}

startTracing(); // module-load side effect — see file header re: import order

/** Faz 13A graceful-shutdown hook: flush + stop the SDK. Safe to call even if
 *  tracing was never started (OTEL_DISABLED=1 or startTracing() no-op). */
export async function shutdownTracing(): Promise<void> {
  if (!sdk) return;
  const s = sdk;
  sdk = null;
  try {
    await s.shutdown();
  } catch (e: any) {
    console.warn(`[Tracing] shutdown error: ${String(e?.message ?? e).slice(0, 160)}`);
  }
}

// ── withLlmSpan — manual instrumentation for the ONE in-house LLM fetch seam ─
// Used by server/providers.ts to wrap ProviderRouter's single executeProvider()
// call site inside the retry loop in ProviderRouter.generate — NOT scattered
// across every provider branch. attrs values of `undefined` are dropped
// (never stored as literal "undefined"). Dynamic attributes discovered only
// after the call completes (tokens, tokPerSec, …) can be attached by `fn` via
// `span.setAttribute(...)` before it returns.
const tracer = trace.getTracer("ollamas-llm");

function dropUndefined(attrs: Record<string, string | number | boolean | undefined>): Attributes {
  const out: Attributes = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** A Span whose methods are all no-ops — used when tracing is disabled at
 *  call time so `fn` can still call span.setAttribute(...) unconditionally
 *  without a null check, but nothing is recorded or exported. */
function noopSpan(): Span {
  const self: Partial<Span> = {
    setAttribute: () => self as Span,
    setAttributes: () => self as Span,
    addEvent: () => self as Span,
    addLink: () => self as Span,
    addLinks: () => self as Span,
    setStatus: () => self as Span,
    updateName: () => self as Span,
    end: () => undefined,
    isRecording: () => false,
    recordException: () => undefined,
    spanContext: () => ({ traceId: "0".repeat(32), spanId: "0".repeat(16), traceFlags: 0 }),
  };
  return self as Span;
}

export async function withLlmSpan<T>(
  name: string,
  attrs: Record<string, string | number | boolean | undefined>,
  fn: (span: Span) => Promise<T> | T,
): Promise<T> {
  // Checked per call (not just at module-boot time) so an operator can flip
  // OTEL_DISABLED at runtime as a kill switch even after the SDK started.
  if (isOtelDisabled()) {
    return fn(noopSpan());
  }
  return tracer.startActiveSpan(name, async (span) => {
    span.setAttributes(dropUndefined(attrs));
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err: any) {
      const message = String(err?.message ?? err).slice(0, 500);
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message });
      throw err;
    } finally {
      span.end();
      if (ringProcessor) await ringProcessor.forceFlush().catch(() => {});
    }
  });
}
