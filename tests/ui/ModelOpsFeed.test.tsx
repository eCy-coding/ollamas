// T5-F4 — cockpit ModelOpsFeed / RollupTiles / ProviderLeaderboard render from the
// /api/telemetry/recent initial-paint snapshot (jsdom; EventSource live-tail is stubbed).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import { renderUI } from "./helpers";
import { ModelOpsFeed } from "../../src/components/cockpit/ModelOpsFeed";
import { RollupTiles } from "../../src/components/cockpit/RollupTiles";
import { ProviderLeaderboard } from "../../src/components/cockpit/ProviderLeaderboard";

// ModelOpsFeed windows its "live" view to the last 3h, so the paint-snapshot events must be recent
// (a fixed 2023 ts would age out and render nothing). `nowish` keeps them inside the window.
const nowish = Date.now();
const snapshot = {
  events: [
    { ts: nowish - 2_000, operation: "chat", providerName: "groq", responseModel: "llama-3.3-70b-versatile", inputTokens: 10, outputTokens: 20, totalMs: 220, ttftMs: 45, requestId: "r1", status: "ok", costUsd: 0.0002, routeAttempt: 0, retryCount: 0, stream: true, tokPerSec: 90 },
    { ts: nowish - 1_000, operation: "chat", providerName: "cerebras", responseModel: "gpt-oss-120b", inputTokens: 8, outputTokens: 0, totalMs: 180, requestId: "r2", status: "error", errorType: "429", costUsd: 0, routeAttempt: 1, retryCount: 0, stream: false },
  ],
  rollup: {
    windowMs: 60000, count: 2, p50TotalMs: 200, p95TotalMs: 220, p50TtftMs: 45, p95TtftMs: 45,
    errorRate: 0.5, tokPerSec: 90, reqPerMin: 2, costPerHr: 0.012,
    byProvider: [
      { provider: "groq", calls: 1, tokPerSec: 90, costPer1k: 0.006, successPct: 100, p95Ms: 220, avgTtftMs: 45 },
      { provider: "cerebras", calls: 1, tokPerSec: 0, costPer1k: 0, successPct: 0, p95Ms: 180, avgTtftMs: 0 },
    ],
  },
};

// Null-safe fetch stub: the panels fetch /api/telemetry/recent for initial paint; unrelated
// background RUM beacons (which can call fetch with no url) must not crash the test.
beforeEach(() => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
    const url = typeof input === "string" ? input : (input && input.href) || (input && input.url) || "";
    const body = url.includes("/api/telemetry/recent") ? snapshot : {};
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  });
});
afterEach(() => vi.restoreAllMocks());

describe("ModelOpsFeed — live request tail", () => {
  it("renders one row per event from the initial-paint snapshot", async () => {
    renderUI(<ModelOpsFeed />);
    await waitFor(() => expect(screen.getByText("llama-3.3-70b-versatile")).toBeInTheDocument());
    expect(screen.getByText("gpt-oss-120b")).toBeInTheDocument();
    expect(screen.getByText("429")).toBeInTheDocument();
  });

  it("windows out stale rows (a prior-incident timeout hours ago must not dominate the LIVE feed)", async () => {
    const stale = { events: [
      { ts: Date.now() - 7 * 60 * 60 * 1000, operation: "chat", providerName: "cloudflare", responseModel: "stale-timeout-model", inputTokens: 0, outputTokens: 0, totalMs: 600000, requestId: "old", status: "error", errorType: "error", costUsd: 0, routeAttempt: 0, retryCount: 0, stream: false },
      { ts: Date.now() - 1_000, operation: "chat", providerName: "groq", responseModel: "fresh-model", inputTokens: 5, outputTokens: 10, totalMs: 200, requestId: "new", status: "ok", costUsd: 0, routeAttempt: 0, retryCount: 0, stream: false, tokPerSec: 50 },
    ], rollup: snapshot.rollup };
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: any) => {
      const url = typeof input === "string" ? input : (input && input.href) || (input && input.url) || "";
      return new Response(JSON.stringify(url.includes("/api/telemetry/recent") ? stale : {}), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    renderUI(<ModelOpsFeed />);
    await waitFor(() => expect(screen.getByText("fresh-model")).toBeInTheDocument());
    expect(screen.queryByText("stale-timeout-model")).not.toBeInTheDocument(); // 7h-old row filtered
  });
});

describe("RollupTiles — window stat tiles", () => {
  it("renders p95 tiles, error rate and cost/hr from the snapshot", async () => {
    renderUI(<RollupTiles />);
    await waitFor(() => expect(screen.getByText(/p95 latency/i)).toBeInTheDocument());
    expect(screen.getByText(/p95 TTFT/i)).toBeInTheDocument();
    expect(screen.getByText("50%")).toBeInTheDocument();
    expect(screen.getByText("$0.012")).toBeInTheDocument();
  });
});

describe("ProviderLeaderboard — per-provider comparison", () => {
  it("lists providers ranked with tok/s + success%", async () => {
    renderUI(<ProviderLeaderboard />);
    await waitFor(() => expect(screen.getByText("groq")).toBeInTheDocument());
    expect(screen.getByText("cerebras")).toBeInTheDocument();
    expect(screen.getByText("100%")).toBeInTheDocument();
  });
});
