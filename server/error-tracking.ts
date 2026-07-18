// server/error-tracking.ts — central error tracking & aggregation (M-049 / GAP-045).
//
// Pure in-memory core: every error funnels through recordError() → structured log entry
// (pino) + ring buffer of recent errors (timestamp, kind, message, route) + per-kind
// counters + /metrics Prometheus counter (ollamas_errors_total{kind}) + an OPTIONAL
// env-gated threshold webhook alert (ERROR_ALERT_WEBHOOK, global fetch — no new deps).
//
// Three producers feed it:
//  1. errorTrackingMiddleware — Express 4-arg error middleware (thrown route errors → 500).
//  2. process 'unhandledRejection' — record + survive (a dropped background promise must
//     not kill the gateway; the rising counter surfaces the bug to fix).
//  3. process 'uncaughtException' — record + flush, then EXIT(1) — Node best practice: the
//     process state is undefined after an uncaught exception, so we never swallow-and-continue.
//     Escape hatch: OLLAMAS_KEEP_ALIVE_ON_UNCAUGHT=1 keeps the process alive (dev/debug only).
//     When the caller injects onFatal (server.ts passes its graceful `shutdown` closure),
//     that closure owns draining + exiting instead of a raw process.exit(1).
//
// Sentry intentionally NOT included (no new deps); the webhook hook covers external alerting.

import type express from "express";
import { logger } from "./logger";
import { errorsTotal } from "./metrics";

export type ErrorKind = "route" | "unhandledRejection" | "uncaughtException";

export interface ErrorRecord {
  ts: number;
  kind: ErrorKind;
  message: string;
  route?: string;
}

export interface ErrorStats {
  total: number;
  byKind: Partial<Record<ErrorKind, number>>;
  recent: ErrorRecord[];
}

const RING_MAX = 100;

const ring: ErrorRecord[] = [];
let total = 0;
const byKind: Partial<Record<ErrorKind, number>> = {};
let lastAlertAt = 0;

function toMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  try {
    return typeof err === "string" ? err : JSON.stringify(err);
  } catch {
    return String(err);
  }
}

/** Record one error: ring buffer + counters + structured log + metric + maybe alert. */
export function recordError(kind: ErrorKind, err: unknown, route?: string): ErrorRecord {
  const rec: ErrorRecord = { ts: Date.now(), kind, message: toMessage(err), ...(route ? { route } : {}) };
  ring.push(rec);
  if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);
  total++;
  byKind[kind] = (byKind[kind] || 0) + 1;
  errorsTotal.labels(kind).inc();
  logger.error(
    { errKind: kind, route, stack: err instanceof Error ? err.stack : undefined },
    `[ErrorTracker] ${kind}: ${rec.message}`,
  );
  maybeAlert(rec.ts);
  // S31: the ring is in-process and ephemeral — emit so the brain subscriber can
  // fold recurring signatures into learned memory. Best-effort by definition.
  void import("./brain-bus").then(({ emit }) =>
    emit({
      type: "error.recorded", source: "error-tracking", at: rec.ts,
      payload: { signature: `${kind}:${rec.message.slice(0, 100)}` },
    }),
  ).catch(() => { /* bus absent */ });
  return rec;
}

/** Aggregated view — consumed by admin/telemetry surfaces (alongside /metrics counter). */
export function getErrorStats(): ErrorStats {
  return { total, byKind: { ...byKind }, recent: [...ring] };
}

/** Test/ops helper: clear ring, counters and alert cooldown (Prometheus counter untouched). */
export function resetErrorTracking(): void {
  ring.length = 0;
  total = 0;
  for (const k of Object.keys(byKind) as ErrorKind[]) delete byKind[k];
  lastAlertAt = 0;
}

// --- Threshold alert (optional, env-gated; fire-and-forget global fetch) ---
function maybeAlert(now: number): void {
  const webhook = process.env.ERROR_ALERT_WEBHOOK;
  if (!webhook) return;
  const threshold = Number(process.env.ERROR_ALERT_THRESHOLD || 10);
  const windowMs = Number(process.env.ERROR_ALERT_WINDOW_MS || 60_000);
  if (now - lastAlertAt < windowMs) return; // cooldown: at most one alert per window
  const count = ring.filter((r) => r.ts > now - windowMs).length;
  if (count <= threshold) return;
  lastAlertAt = now;
  void fetch(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ service: "ollamas", count, threshold, windowMs, recent: ring.slice(-5) }),
  }).catch((e) => logger.warn(`[ErrorTracker] alert webhook failed: ${toMessage(e)}`));
}

// --- Express error middleware (4-arg) ---
/**
 * Central Express error handler: record + structured 500. Never leaks the internal
 * message to the HTTP client. Delegates when headers already went out (streaming).
 */
export function errorTrackingMiddleware(
  err: unknown,
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): void {
  recordError("route", err, `${req.method} ${req.path}`);
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ error: "internal server error", code: "INTERNAL_ERROR" });
}

// --- Process-level hooks ---
export interface ProcessErrorHookDeps {
  /** Exit primitive (default process.exit). Injected in tests. */
  exit?: (code: number) => void;
  /** Graceful shutdown closure — when provided it OWNS drain + exit on uncaughtException. */
  onFatal?: (err: unknown) => void;
  /** Legacy metric bump for a survived rejection (server.ts keeps ollamas_unhandled_rejection_total alive). */
  onRejectionSurvived?: () => void;
}

export interface ProcessErrorHooks {
  onUnhandledRejection: (reason: unknown) => void;
  onUncaughtException: (err: unknown) => void;
}

/** Build the two process-level handlers (pure — no global registration). */
export function makeProcessErrorHooks(deps: ProcessErrorHookDeps = {}): ProcessErrorHooks {
  const exit = deps.exit ?? ((code: number) => process.exit(code));
  return {
    onUnhandledRejection(reason: unknown) {
      // SURVIVE: log + count only. A `.catch`-less background promise must not kill the gateway.
      recordError("unhandledRejection", reason);
      deps.onRejectionSurvived?.();
    },
    onUncaughtException(err: unknown) {
      recordError("uncaughtException", err);
      // Node best practice: state is undefined after an uncaught exception → log/flush then
      // exit(1). Never blindly swallow-and-continue. OLLAMAS_KEEP_ALIVE_ON_UNCAUGHT=1 is a
      // deliberate, documented escape hatch for dev/debug sessions only.
      if (process.env.OLLAMAS_KEEP_ALIVE_ON_UNCAUGHT === "1") return;
      if (deps.onFatal) {
        deps.onFatal(err); // graceful drain path (server.ts shutdown closure) owns the exit
        return;
      }
      exit(1);
    },
  };
}

// Re-import guard: vitest (and hot-reload) re-evaluate this module in the same process, so a
// module-local flag is not enough — the flag lives on globalThis keyed by a well-known Symbol.
const INSTALL_KEY = Symbol.for("ollamas.errorTracking.installedHooks");

/** Register hooks on the live process. Idempotent across module re-imports. */
export function installProcessErrorHooks(deps: ProcessErrorHookDeps = {}): ProcessErrorHooks {
  const g = globalThis as Record<PropertyKey, unknown>;
  const existing = g[INSTALL_KEY] as ProcessErrorHooks | undefined;
  if (existing) return existing;
  const hooks = makeProcessErrorHooks(deps);
  process.on("unhandledRejection", hooks.onUnhandledRejection);
  process.on("uncaughtException", hooks.onUncaughtException);
  g[INSTALL_KEY] = hooks;
  return hooks;
}

/** Remove previously installed hooks (tests / controlled teardown). */
export function uninstallProcessErrorHooks(): void {
  const g = globalThis as Record<PropertyKey, unknown>;
  const hooks = g[INSTALL_KEY] as ProcessErrorHooks | undefined;
  if (!hooks) return;
  process.removeListener("unhandledRejection", hooks.onUnhandledRejection);
  process.removeListener("uncaughtException", hooks.onUncaughtException);
  delete g[INSTALL_KEY];
}
