// server/telemetry.ts — per-request observability core for the cockpit. Tracks EVERY model
// operation (one RequestEvent per call through ProviderRouter.generate) in a bounded in-memory
// ring buffer, redacted at record time (the single zero-leak choke point), and exposes pure
// rollup statistics for the live cockpit. Field names follow the OpenTelemetry gen_ai.*
// semantic conventions so a future OTel export needs no reshape. Zero-dep, no timers here
// (the SSE endpoint owns the tick); the module is side-effect-safe — recording never throws.
import { createHash } from "node:crypto";

export interface RequestEvent {
  ts: number;                    // epoch ms when the call completed
  operation: "chat" | "embed" | "transcribe";
  providerName: string;          // gen_ai.provider.name — the routed leg (groq, ollama-local…)
  requestModel?: string;         // gen_ai.request.model
  responseModel?: string;        // gen_ai.response.model (route may substitute)
  inputTokens: number;           // gen_ai.usage.input_tokens
  outputTokens: number;          // gen_ai.usage.output_tokens
  finishReason?: string;         // gen_ai.response.finish_reasons
  requestId: string;
  ttftMs?: number;               // time-to-first-token (stream only) — most diagnostic latency
  totalMs: number;               // total wall-clock incl. fallbacks
  errorType?: string;            // HTTP status class or exception label (error status only)
  status: "ok" | "error";
  serverAddress?: string;        // host ONLY (never path/query — could carry a key)
  costUsd: number;               // derived: tokens × per-1k rate
  routeAttempt: number;          // index in the fallback chain
  fallbackFrom?: string;         // provider this attempt fell back FROM
  retryCount: number;            // key-pool rotation attempt within this provider
  keyId?: string;                // pool-slot label (sha256 prefix) — NEVER the raw key
  quotaCooldownFlag?: boolean;   // this failure tripped a 429/quota cooldown
  stream: boolean;
  tokPerSec?: number;
  promptHash?: string;           // set ONLY when TELEMETRY_CAPTURE_CONTENT=1 (SHA-256)
  completionHash?: string;
  // Raw content is passed via these transient underscore fields and NEVER stored — redactEvent
  // hashes them (if content capture is on) then drops them. They never reach the buffer/SSE.
  _prompt?: string;
  _completion?: string;
}

// ── Ring buffer (O(1) push, bounded memory, overwrite-oldest) ─────────────────────────────
export class RingBuffer<T> {
  private buf: T[];
  private start = 0;
  private count = 0;
  constructor(private cap: number) {
    this.buf = new Array(Math.max(1, cap));
    this.cap = Math.max(1, cap);
  }
  push(x: T): void {
    const end = (this.start + this.count) % this.cap;
    this.buf[end] = x;
    if (this.count < this.cap) this.count++;
    else this.start = (this.start + 1) % this.cap; // full → advance start (drop oldest)
  }
  toArray(): T[] {
    const out: T[] = [];
    for (let i = 0; i < this.count; i++) out.push(this.buf[(this.start + i) % this.cap]);
    return out;
  }
  get size(): number { return this.count; }
}

// ── Redaction — the ONE zero-leak choke point ─────────────────────────────────────────────
// Secret-shaped substrings we must never surface (provider key prefixes + generic bearer/hex).
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{8,}/g,       // openai / anthropic style
  /gsk_[A-Za-z0-9]{8,}/g,        // groq
  /csk-[A-Za-z0-9]{8,}/g,        // cerebras
  /tvly-[A-Za-z0-9-]{8,}/g,      // tavily
  /pa-[A-Za-z0-9_-]{20,}/g,      // voyage
  /jina_[A-Za-z0-9]{8,}/g,       // jina
  /(?:api[_-]?key|authorization|bearer)\s*[:=]\s*\S+/gi,
];

function scrub(s: string): string {
  let out = s;
  for (const re of SECRET_PATTERNS) out = out.replace(re, "[REDACTED]");
  return out;
}

/** Public shared redactor — scrub secret-shaped substrings from a string. Used by the
 *  agent SSE path (tool_call args) so no dashboard/agent frame can carry a raw key. */
export function redactString(s: string): string {
  return scrub(s);
}

/** Deep-redact any value: scrubs every string leaf in objects/arrays, preserves structure
 *  and non-secret content. Non-string primitives pass through unchanged. Zero-leak choke
 *  point for arbitrary payloads (e.g. tool_call arguments the model may have echoed a key into). */
export function redactDeep<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value === "string") return scrub(value) as unknown as T;
  if (value && typeof value === "object") {
    // Cycle guard: tool_call arguments can be circular (e.g. a node referencing its parent); without this the
    // recursion overflows the stack and crashes the /api/agent/chat SSE handler. Break the cycle, keep redacting.
    if (seen.has(value as object)) return "[Circular]" as unknown as T;
    seen.add(value as object);
    if (Array.isArray(value)) return value.map((v) => redactDeep(v, seen)) as unknown as T;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, seen);
    return out as unknown as T;
  }
  return value;
}

function hostOnly(addr: string): string {
  try { return new URL(addr).host; }
  catch { return scrub(addr.split(/[/?#]/)[0]); }
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Redact a raw event: host-only address, secret-shaped substrings stripped from every string
 *  field, prompt/completion hashed ONLY when TELEMETRY_CAPTURE_CONTENT=1, transient raw text
 *  dropped. Pure given the env flag. Returns a NEW event safe to buffer/emit. */
export function redactEvent(raw: RequestEvent, env: NodeJS.ProcessEnv = process.env): RequestEvent {
  const captureContent = env.TELEMETRY_CAPTURE_CONTENT === "1";
  const e: RequestEvent = { ...raw };
  if (e.serverAddress) e.serverAddress = hostOnly(e.serverAddress);
  // Scrub free-text fields that a model/provider could echo a key into.
  if (e.finishReason) e.finishReason = scrub(e.finishReason);
  if (e.errorType) e.errorType = scrub(e.errorType);
  if (e.requestId) e.requestId = scrub(e.requestId);
  if (e.responseModel) e.responseModel = scrub(e.responseModel);
  if (e.requestModel) e.requestModel = scrub(e.requestModel);
  if (captureContent) {
    if (typeof e._prompt === "string") e.promptHash = sha256(e._prompt);
    if (typeof e._completion === "string") e.completionHash = sha256(e._completion);
  }
  delete e._prompt;      // raw content NEVER stored, regardless of the flag
  delete e._completion;
  return e;
}

// ── Rollup statistics (pure) ──────────────────────────────────────────────────────────────
export interface ProviderStat {
  provider: string; calls: number; tokPerSec: number; costPer1k: number;
  successPct: number; p95Ms: number; avgTtftMs: number;
}
export interface Rollup {
  windowMs: number;
  count: number;
  p50TotalMs: number; p95TotalMs: number;
  p50TtftMs: number; p95TtftMs: number;
  errorRate: number;
  tokPerSec: number;
  reqPerMin: number;
  costPerHr: number;
  byProvider: ProviderStat[];
}

// Nearest-rank percentile (sorted ascending). Empty → 0.
function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

const WINDOW_MS = 60_000; // rolling 60s window for rates

export function rollup(events: RequestEvent[], nowMs: number): Rollup {
  const win = events.filter((e) => nowMs - e.ts <= WINDOW_MS);
  const total = [...win].map((e) => e.totalMs).sort((a, b) => a - b);
  const ttft = win.filter((e) => typeof e.ttftMs === "number").map((e) => e.ttftMs!).sort((a, b) => a - b);
  const errors = win.filter((e) => e.status === "error").length;
  const outTokens = win.reduce((n, e) => n + e.outputTokens, 0);
  const totalMsSum = win.reduce((n, e) => n + e.totalMs, 0);
  const costSum = win.reduce((n, e) => n + e.costUsd, 0);

  const byProviderMap = new Map<string, RequestEvent[]>();
  for (const e of win) (byProviderMap.get(e.providerName) ?? byProviderMap.set(e.providerName, []).get(e.providerName)!).push(e);
  const byProvider: ProviderStat[] = [...byProviderMap.entries()].map(([provider, evs]) => {
    const ok = evs.filter((e) => e.status === "ok");
    const provOut = evs.reduce((n, e) => n + e.outputTokens, 0);
    const provMs = evs.reduce((n, e) => n + e.totalMs, 0);
    const provCost = evs.reduce((n, e) => n + e.costUsd, 0);
    const provIn = evs.reduce((n, e) => n + e.inputTokens + e.outputTokens, 0);
    const p95 = pct(evs.map((e) => e.totalMs).sort((a, b) => a - b), 95);
    const ttfts = evs.filter((e) => typeof e.ttftMs === "number").map((e) => e.ttftMs!);
    return {
      provider, calls: evs.length,
      tokPerSec: provMs > 0 ? (provOut / (provMs / 1000)) : 0,
      costPer1k: provIn > 0 ? (provCost / provIn) * 1000 : 0,
      successPct: evs.length ? Math.round((ok.length / evs.length) * 100) : 0,
      p95Ms: p95,
      avgTtftMs: ttfts.length ? ttfts.reduce((a, b) => a + b, 0) / ttfts.length : 0,
    };
  }).sort((a, b) => b.tokPerSec - a.tokPerSec);

  return {
    windowMs: WINDOW_MS,
    count: win.length,
    p50TotalMs: pct(total, 50), p95TotalMs: pct(total, 95),
    p50TtftMs: pct(ttft, 50), p95TtftMs: pct(ttft, 95),
    errorRate: win.length ? errors / win.length : 0,
    tokPerSec: totalMsSum > 0 ? outTokens / (totalMsSum / 1000) : 0,
    reqPerMin: win.length, // window is 60s
    costPerHr: costSum * (3_600_000 / WINDOW_MS),
    byProvider,
  };
}

// ── Module state: ring buffer + subscribers (thin, side-effect-safe) ──────────────────────
const BUFFER_CAP = Number(process.env.TELEMETRY_BUFFER) || 500;
let ring = new RingBuffer<RequestEvent>(BUFFER_CAP);
let subscribers: Array<(e: RequestEvent) => void> = [];

/** Record one model operation: redact → buffer → notify. NEVER throws into the caller
 *  (a bad subscriber can't break the model path). */
export function recordRequestEvent(raw: RequestEvent): void {
  let e: RequestEvent;
  try { e = redactEvent(raw); } catch { return; } // redaction must not break the hot path
  ring.push(e);
  for (const fn of subscribers) {
    try { fn(e); } catch { /* a throwing subscriber never breaks recording */ }
  }
}

/** Subscribe to live events; returns an unsubscribe fn. */
export function onRequestEvent(fn: (e: RequestEvent) => void): () => void {
  subscribers.push(fn);
  return () => { subscribers = subscribers.filter((s) => s !== fn); };
}

/** Snapshot of the last n events (already redacted) — cockpit initial paint + tests. */
export function recentEvents(n = BUFFER_CAP): RequestEvent[] {
  const all = ring.toArray();
  return n >= all.length ? all : all.slice(all.length - n);
}

/** Test/maintenance helper — clear buffer + subscribers. */
export function resetTelemetry(): void {
  ring = new RingBuffer<RequestEvent>(BUFFER_CAP);
  subscribers = [];
}
