import { describe, it, expect } from "vitest";
import { parsePromText, counterTotal, histogramStats, samplesByLabel } from "../cli/lib/metrics";

// A representative slice of the gateway's /metrics body (prom-client 0.0.4).
const SAMPLE = `# HELP http_request_duration_ms HTTP request duration in milliseconds
# TYPE http_request_duration_ms histogram
http_request_duration_ms_bucket{method="POST",route="/api/generate",status="200",le="25"} 0
http_request_duration_ms_bucket{method="POST",route="/api/generate",status="200",le="50"} 2
http_request_duration_ms_bucket{method="POST",route="/api/generate",status="200",le="100"} 6
http_request_duration_ms_bucket{method="POST",route="/api/generate",status="200",le="200"} 9
http_request_duration_ms_bucket{method="POST",route="/api/generate",status="200",le="500"} 10
http_request_duration_ms_bucket{method="POST",route="/api/generate",status="200",le="+Inf"} 10
http_request_duration_ms_sum{method="POST",route="/api/generate",status="200"} 850
http_request_duration_ms_count{method="POST",route="/api/generate",status="200"} 10
# HELP mcp_tool_calls_total Total MCP tool calls
# TYPE mcp_tool_calls_total counter
mcp_tool_calls_total{tool="read_file",tier="safe",ok="true"} 7
mcp_tool_calls_total{tool="write_file",tier="host",ok="true"} 3
mcp_tool_calls_total{tool="write_file",tier="host",ok="false"} 1
# HELP ollamas_webhook_queue_depth Pending webhooks
# TYPE ollamas_webhook_queue_depth gauge
ollamas_webhook_queue_depth 4
`;

describe("parsePromText", () => {
  const metrics = parsePromText(SAMPLE);

  it("parses counter/gauge/histogram by name + type", () => {
    const byName = Object.fromEntries(metrics.map((m) => [m.name, m.type]));
    expect(byName["http_request_duration_ms"]).toBe("histogram");
    expect(byName["mcp_tool_calls_total"]).toBe("counter");
    expect(byName["ollamas_webhook_queue_depth"]).toBe("gauge");
  });

  it("keeps HELP text", () => {
    expect(parsePromText(SAMPLE).find((m) => m.name === "mcp_tool_calls_total")?.help).toMatch(/MCP tool calls/);
  });

  it("parses counter samples with labels", () => {
    const m = metrics.find((x) => x.name === "mcp_tool_calls_total")!;
    expect(m.samples.length).toBe(3);
    const wf = m.samples.find((s) => s.labels.tool === "write_file" && s.labels.ok === "false")! as any;
    expect(wf.value).toBe(1);
  });

  it("consolidates a histogram into buckets + sum + count", () => {
    const m = metrics.find((x) => x.name === "http_request_duration_ms")!;
    expect(m.samples.length).toBe(1); // one label-set
    const h = m.samples[0] as any;
    expect(h.count).toBe(10);
    expect(h.sum).toBe(850);
    expect(h.buckets.get("100")).toBe(6);
    expect(h.buckets.get("+Inf")).toBe(10);
  });

  it("skips malformed lines and blank/comment-only input", () => {
    expect(parsePromText("")).toEqual([]);
    expect(parsePromText("# HELP only a comment\n\n   \n")).toEqual([]);
    expect((parsePromText("garbage no value line\nfoo_total 5").find((m) => m.name === "foo_total")?.samples[0] as any).value).toBe(5);
  });
});

describe("counterTotal", () => {
  const metrics = parsePromText(SAMPLE);
  it("sums all label-sets of a counter", () => {
    expect(counterTotal(metrics, "mcp_tool_calls_total")).toBe(11); // 7+3+1
  });
  it("returns 0 for an unknown metric", () => {
    expect(counterTotal(metrics, "nope")).toBe(0);
  });
});

describe("histogramStats", () => {
  const metrics = parsePromText(SAMPLE);
  const s = histogramStats(metrics, "http_request_duration_ms");

  it("computes count + sum + avg", () => {
    expect(s.count).toBe(10);
    expect(s.sum).toBe(850);
    expect(s.avg).toBe(85);
  });

  it("derives approximate p50/p90 from buckets (le boundary)", () => {
    // cumulative: 25→0, 50→2, 100→6, 200→9, 500→10. p50 (≥5) first at le=100; p90 (≥9) at le=200.
    expect(s.p50).toBe(100);
    expect(s.p90).toBe(200);
  });

  it("zeroes out for an unknown/absent histogram", () => {
    expect(histogramStats(metrics, "nope")).toEqual({ count: 0, sum: 0, avg: 0, p50: 0, p90: 0 });
  });
});

describe("samplesByLabel", () => {
  it("groups counter samples by a label value", () => {
    const m = parsePromText(SAMPLE).find((x) => x.name === "mcp_tool_calls_total")!;
    const byTool = samplesByLabel(m, "tool");
    expect(byTool["write_file"].reduce((a, s) => a + s.value, 0)).toBe(4); // 3 ok + 1 fail
    expect(byTool["read_file"][0].value).toBe(7);
  });
});
