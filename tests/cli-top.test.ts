import { describe, it, expect } from "vitest";
import { GatewayClient } from "../cli/lib/client";

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
