// Faz 26 (v1.17) — sweeper LIFECYCLE for server/oauth-gc.ts (start/stop timer control).
// The store-level purge behavior is covered by tests/oauth-gc.test.ts; this suite exercises
// the module's own exported functions (startOAuthGc/stopOAuthGc): boot sweep, idempotency,
// interval re-sweep, and clean stop. purgeExpiredOAuth is mocked so the test is hermetic
// (no DB, no real interval) and asserts the lifecycle contract, not the SQL.
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { purge } = vi.hoisted(() => ({ purge: vi.fn(async () => ({ codes: 0, tokens: 0, refresh: 0 })) }));
vi.mock("../server/store", () => ({ purgeExpiredOAuth: purge }));

import { startOAuthGc, stopOAuthGc } from "../server/oauth-gc";

describe("OAuth GC sweeper lifecycle (server/oauth-gc)", () => {
  beforeEach(() => { vi.useFakeTimers(); purge.mockClear(); });
  afterEach(() => { stopOAuthGc(); vi.useRealTimers(); delete process.env.OAUTH_GC_INTERVAL_MS; });

  test("start() sweeps once immediately and is idempotent", () => {
    startOAuthGc();
    expect(purge).toHaveBeenCalledTimes(1); // boot sweep — don't wait a full interval
    startOAuthGc(); // second call is a no-op (single timer, no extra sweep)
    expect(purge).toHaveBeenCalledTimes(1);
  });

  test("re-sweeps on every OAUTH_GC_INTERVAL_MS tick", () => {
    process.env.OAUTH_GC_INTERVAL_MS = "1000";
    startOAuthGc();
    expect(purge).toHaveBeenCalledTimes(1); // boot
    vi.advanceTimersByTime(3000);
    expect(purge).toHaveBeenCalledTimes(4); // boot + 3 interval sweeps
  });

  test("stop() halts further sweeps and start() can resume", () => {
    process.env.OAUTH_GC_INTERVAL_MS = "1000";
    startOAuthGc();
    stopOAuthGc();
    purge.mockClear();
    vi.advanceTimersByTime(5000);
    expect(purge).not.toHaveBeenCalled(); // timer cleared
    startOAuthGc(); // resumes cleanly after a stop
    expect(purge).toHaveBeenCalledTimes(1);
  });
});
