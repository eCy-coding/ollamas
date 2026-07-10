// M-049 / GAP-045 — central error tracking & aggregation (TDD).
// Pure-core module server/error-tracking.ts: in-memory ring buffer + per-kind counters +
// Express 4-arg error middleware + process hooks (unhandledRejection / uncaughtException)
// + env-gated threshold webhook alert (global fetch, no new deps).
// Socket use is limited to one tiny in-test express app (port 0) proving the middleware
// actually catches a thrown route error — same technique as tests/routes-hardening.test.ts.
import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import {
  recordError,
  getErrorStats,
  resetErrorTracking,
  errorTrackingMiddleware,
  makeProcessErrorHooks,
  installProcessErrorHooks,
  uninstallProcessErrorHooks,
} from "../server/error-tracking";
import { register } from "../server/metrics";

beforeEach(() => {
  resetErrorTracking();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  uninstallProcessErrorHooks();
});

/** Current value of ollamas_errors_total for one kind label (0 when absent). */
async function errorsTotalValue(kind: string): Promise<number> {
  const metric = register.getSingleMetric("ollamas_errors_total");
  if (!metric) return 0;
  const data = await (metric as { get: () => Promise<{ values: Array<{ labels: Record<string, string>; value: number }> }> }).get();
  const row = data.values.find((v) => v.labels.kind === kind);
  return row ? row.value : 0;
}

describe("aggregator core — recordError / getErrorStats", () => {
  test("records timestamp, kind, message and route; counts total and by kind", () => {
    recordError("route", new Error("boom"), "GET /api/x");
    const stats = getErrorStats();
    expect(stats.total).toBe(1);
    expect(stats.byKind.route).toBe(1);
    expect(stats.recent).toHaveLength(1);
    const rec = stats.recent[0];
    expect(typeof rec.ts).toBe("number");
    expect(rec.kind).toBe("route");
    expect(rec.message).toBe("boom");
    expect(rec.route).toBe("GET /api/x");
  });

  test("ring buffer keeps only the most recent 100 entries (oldest dropped)", () => {
    for (let i = 0; i < 105; i++) recordError("route", new Error(`e${i}`));
    const stats = getErrorStats();
    expect(stats.total).toBe(105); // total counter is NOT capped
    expect(stats.recent).toHaveLength(100);
    expect(stats.recent[0].message).toBe("e5"); // oldest surviving
    expect(stats.recent[99].message).toBe("e104"); // newest last
  });

  test("non-Error values are stringified safely", () => {
    recordError("unhandledRejection", "plain string reason");
    expect(getErrorStats().recent[0].message).toContain("plain string reason");
  });
});

describe("express error middleware — catches thrown route error", () => {
  test("thrown route error → 500 structured body + aggregation + /metrics counter", async () => {
    const app = express();
    app.get("/boom", () => {
      throw new Error("route exploded");
    });
    app.use(errorTrackingMiddleware);

    const server = http.createServer(app);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;

    const before = await errorsTotalValue("route");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/boom`);
      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.code).toBe("INTERNAL_ERROR");
      expect(typeof body.error).toBe("string");
      // No internal message leak in the HTTP response:
      expect(JSON.stringify(body)).not.toContain("route exploded");
    } finally {
      await new Promise<void>((r) => server.close(() => r()));
    }

    const stats = getErrorStats();
    expect(stats.byKind.route).toBe(1);
    expect(stats.recent[0].message).toBe("route exploded");
    expect(stats.recent[0].route).toContain("/boom");
    expect(await errorsTotalValue("route")).toBe(before + 1);
  });
});

describe("process hooks — unhandledRejection / uncaughtException", () => {
  test("unhandledRejection: records + survives (no exit)", () => {
    const exit = vi.fn();
    const hooks = makeProcessErrorHooks({ exit });
    hooks.onUnhandledRejection(new Error("bg boom"));
    const stats = getErrorStats();
    expect(stats.byKind.unhandledRejection).toBe(1);
    expect(stats.recent[0].message).toBe("bg boom");
    expect(exit).not.toHaveBeenCalled();
  });

  test("uncaughtException: records then exits(1) by default (node best practice)", () => {
    const exit = vi.fn();
    const hooks = makeProcessErrorHooks({ exit });
    hooks.onUncaughtException(new Error("fatal"));
    expect(getErrorStats().byKind.uncaughtException).toBe(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  test("uncaughtException with OLLAMAS_KEEP_ALIVE_ON_UNCAUGHT=1: records, does NOT exit", () => {
    vi.stubEnv("OLLAMAS_KEEP_ALIVE_ON_UNCAUGHT", "1");
    const exit = vi.fn();
    const hooks = makeProcessErrorHooks({ exit });
    hooks.onUncaughtException(new Error("fatal-but-kept-alive"));
    expect(getErrorStats().byKind.uncaughtException).toBe(1);
    expect(exit).not.toHaveBeenCalled();
  });

  test("uncaughtException prefers injected onFatal (graceful shutdown) over raw exit", () => {
    const exit = vi.fn();
    const onFatal = vi.fn();
    const hooks = makeProcessErrorHooks({ exit, onFatal });
    hooks.onUncaughtException(new Error("fatal"));
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(exit).not.toHaveBeenCalled(); // shutdown closure owns the exit
  });

  test("install is guarded against double-registration (module re-import safe)", () => {
    const beforeRej = process.listenerCount("unhandledRejection");
    const beforeExc = process.listenerCount("uncaughtException");
    installProcessErrorHooks({ exit: vi.fn() });
    installProcessErrorHooks({ exit: vi.fn() }); // second call must be a no-op
    expect(process.listenerCount("unhandledRejection")).toBe(beforeRej + 1);
    expect(process.listenerCount("uncaughtException")).toBe(beforeExc + 1);
    uninstallProcessErrorHooks();
    expect(process.listenerCount("unhandledRejection")).toBe(beforeRej);
    expect(process.listenerCount("uncaughtException")).toBe(beforeExc);
  });
});

describe("threshold alert — env-gated webhook via global fetch", () => {
  test("fires webhook POST once when count exceeds threshold in window, then cools down", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("ERROR_ALERT_WEBHOOK", "http://alert.test/hook");
    vi.stubEnv("ERROR_ALERT_THRESHOLD", "3");
    vi.stubEnv("ERROR_ALERT_WINDOW_MS", "60000");

    for (let i = 0; i < 3; i++) recordError("route", new Error(`e${i}`));
    expect(fetchMock).not.toHaveBeenCalled(); // 3 > 3 is false — not exceeded yet

    recordError("route", new Error("e3")); // 4 > 3 → alert
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://alert.test/hook");
    expect(init.method).toBe("POST");
    const payload = JSON.parse(init.body);
    expect(payload.count).toBeGreaterThan(3);

    recordError("route", new Error("e4")); // within cooldown window → no second POST
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("no webhook configured → never fetches", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (let i = 0; i < 50; i++) recordError("route", new Error("x"));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
