import { describe, it, expect } from "vitest";
import { GatewayClient } from "../cli/lib/client";
import { buildSnapshot, renderDashboard, reqRateDelta, cleanupSequence, type Snapshot } from "../cli/commands/top";

const noColor = { color: false, json: false };

const METRICS = `# TYPE http_request_duration_ms histogram
http_request_duration_ms_bucket{method="POST",route="/api/generate",status="200",le="50"} 1
http_request_duration_ms_bucket{method="POST",route="/api/generate",status="200",le="100"} 4
http_request_duration_ms_bucket{method="POST",route="/api/generate",status="200",le="+Inf"} 5
http_request_duration_ms_sum{method="POST",route="/api/generate",status="200"} 300
http_request_duration_ms_count{method="POST",route="/api/generate",status="200"} 5
# TYPE mcp_tool_calls_total counter
mcp_tool_calls_total{tool="read_file",tier="safe",ok="true"} 9
mcp_tool_calls_total{tool="write_file",tier="host",ok="true"} 2
`;

describe("buildSnapshot", () => {
  it("derives latency stats + sorted tool calls from /metrics", () => {
    const s = buildSnapshot(METRICS, { gateway: "http://g", ts: "2026-06-20T00:00:00Z" });
    expect(s.totalRequests).toBe(5);
    expect(s.latency.avg).toBe(60); // 300/5
    expect(s.toolCalls[0]).toMatchObject({ tool: "read_file", count: 9 }); // sorted desc
    expect(s.toolCalls.map((t) => t.count)).toEqual([9, 2]);
  });
});

describe("reqRateDelta", () => {
  it("computes req/s between two counter reads", () => {
    expect(reqRateDelta({ count: 100, ts: 1000 }, { count: 160, ts: 3000 })).toBe(30); // 60 over 2s
  });
  it("no prior sample → 0", () => {
    expect(reqRateDelta(null, { count: 5, ts: 1000 })).toBe(0);
  });
  it("counter reset (cur < prev) → 0", () => {
    expect(reqRateDelta({ count: 100, ts: 1000 }, { count: 10, ts: 2000 })).toBe(0);
  });
  it("non-positive time delta → 0", () => {
    expect(reqRateDelta({ count: 1, ts: 2000 }, { count: 9, ts: 2000 })).toBe(0);
  });
});

describe("renderDashboard (pure)", () => {
  const base: Snapshot = {
    ts: "2026-06-20T00:00:00Z",
    gateway: "http://localhost:3000",
    totalRequests: 5,
    latency: { count: 5, sum: 300, avg: 60, p50: 100, p90: 100 } as any,
    toolCalls: [{ tool: "read_file", tier: "safe", ok: "true", count: 9 }],
  };

  it("renders header, requests, latency and tool rows", () => {
    const out = renderDashboard(base, noColor);
    expect(out).toContain("ollamas top");
    expect(out).toContain("http://localhost:3000");
    expect(out).toContain("requests");
    expect(out).toContain("5 total");
    expect(out).toContain("avg 60ms");
    expect(out).toContain("read_file");
  });

  it("shows — for req rate when not in watch mode", () => {
    expect(renderDashboard(base, noColor)).toContain("— req/s");
  });

  it("renders a usage panel with a sparkline when series present", () => {
    const out = renderDashboard({ ...base, usageSeries: [{ day: "d1", calls: 1, tokens: 10 }, { day: "d2", calls: 4, tokens: 40 }] }, noColor);
    expect(out).toContain("usage");
    expect(out).toContain("calls");
  });

  it("shows a usage hint instead of the panel on error", () => {
    const out = renderDashboard({ ...base, usageError: "set OLLAMAS_API_KEY" }, noColor);
    expect(out).toContain("set OLLAMAS_API_KEY");
  });

  it("NO_COLOR output has no ANSI escapes", () => {
    expect(renderDashboard(base, noColor)).not.toContain("\x1b[");
  });
});

describe("cleanupSequence (terminal restore contract)", () => {
  it("shows the cursor and leaves the alternate screen", () => {
    expect(cleanupSequence()).toContain("\x1b[?25h"); // cursor show
    expect(cleanupSequence()).toContain("\x1b[?1049l"); // alt-screen off
  });
});

describe("GatewayClient.getMetrics (mock fetch)", () => {
  it("returns the raw Prometheus text body from /metrics (no auth needed)", async () => {
    const original = globalThis.fetch;
    let url = "";
    globalThis.fetch = (async (u: string) => {
      url = u;
      return new Response("# TYPE foo counter\nfoo_total 3\n", {
        status: 200,
        headers: { "Content-Type": "text/plain; version=0.0.4" },
      });
    }) as any;
    try {
      const body = await new GatewayClient("http://x").getMetrics();
      expect(url).toBe("http://x/metrics");
      expect(body).toContain("foo_total 3");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("maps a non-200 /metrics to an error", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("nope", { status: 503 })) as any;
    try {
      await expect(new GatewayClient("http://x").getMetrics()).rejects.toThrow(/\/metrics → 503/);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("GatewayClient.getUsageTimeseries (mock fetch)", () => {
  it("returns the {tenantId, series} shape with Bearer", async () => {
    const original = globalThis.fetch;
    let auth: string | undefined;
    globalThis.fetch = (async (_u: string, init: any) => {
      auth = init?.headers?.Authorization;
      return new Response(JSON.stringify({ tenantId: "t1", series: [{ day: "2026-06-20", calls: 5, tokens: 100 }] }), { status: 200 });
    }) as any;
    try {
      const r = await new GatewayClient("http://x", "olm_key").getUsageTimeseries();
      expect(auth).toBe("Bearer olm_key");
      expect(r.series[0]).toMatchObject({ day: "2026-06-20", calls: 5, tokens: 100 });
    } finally {
      globalThis.fetch = original;
    }
  });

  it("401 → OLLAMAS_API_KEY hint", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response("no", { status: 401 })) as any;
    try {
      await expect(new GatewayClient("http://x").getUsageTimeseries()).rejects.toThrow(/OLLAMAS_API_KEY/);
    } finally {
      globalThis.fetch = original;
    }
  });
});
