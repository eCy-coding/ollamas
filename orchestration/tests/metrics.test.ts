import { describe, it, expect } from "vitest";
import { parseHealth, sumPromMetric, promGauge } from "../bin/lib/metrics";

// Gerçek /api/health gövdesi (server.ts:221 şekli birebir).
const HEALTH = JSON.stringify({
  mode: "live",
  isLive: true,
  os: { platform: "darwin", release: "24.6.0", arch: "arm64", uptime: 1000 },
  metrics: {
    cpuLoad1Min: 2.34,
    memory: { total: 100, free: 40, percentageUsed: 60 },
    ollamaVersion: "0.5.7",
    loadedModels: [
      { name: "qwen3", size_vram: 6_200_000_000, details: { quantization_level: "Q4_K_M" } },
      { model: "llama3" },
    ],
  },
  db: "up",
});

describe("parseHealth", () => {
  it("gerçek health gövdesini BackendHealth'e eşler", () => {
    const h = parseHealth(HEALTH);
    expect(h).toEqual({
      cpu: 2.34,
      ram: 60,
      ollamaVersion: "0.5.7",
      mode: "live",
      db: "up",
      models: 2,
      loaded: [
        { name: "qwen3", vramGB: 6.2, quant: "Q4_K_M" },
        { name: "llama3", vramGB: 0, quant: "" },   // name yoksa model; vram/quant yoksa 0/""
      ],
    });
  });
  it("loadedModels yoksa → loaded []", () => {
    expect(parseHealth(JSON.stringify({ mode: "live", metrics: {} }))?.loaded).toEqual([]);
  });
  it("ollamaVersion 'unavailable'/'unknown' → null", () => {
    expect(parseHealth(JSON.stringify({ metrics: { ollamaVersion: "unavailable" } }))?.ollamaVersion).toBeNull();
    expect(parseHealth(JSON.stringify({ metrics: { ollamaVersion: "unknown" } }))?.ollamaVersion).toBeNull();
  });
  it("eksik metrics bloğu → tolerant 0 default, asla throw", () => {
    const h = parseHealth(JSON.stringify({ mode: "demo", db: "down" }));
    expect(h).toMatchObject({ cpu: 0, ram: 0, ollamaVersion: null, mode: "demo", db: "down", models: 0 });
  });
  it("bozuk JSON → null (matris kırılmaz)", () => {
    expect(parseHealth("{not json")).toBeNull();
    expect(parseHealth("")).toBeNull();
  });
});

const PROM = [
  "# HELP mcp_tool_calls_total Total MCP tool calls",
  "# TYPE mcp_tool_calls_total counter",
  'mcp_tool_calls_total{tool="hesapla",tier="host",ok="true"} 7',
  'mcp_tool_calls_total{tool="status",tier="local",ok="true"} 4',
  "# TYPE ollamas_webhook_queue_depth gauge",
  "ollamas_webhook_queue_depth 3",
  "# TYPE ollamas_migration_version gauge",
  "ollamas_migration_version 13",
].join("\n");

describe("sumPromMetric", () => {
  it("aynı ada sahip tüm etiketli örnekleri toplar (counter)", () => {
    expect(sumPromMetric(PROM, "mcp_tool_calls_total")).toBe(11); // 7 + 4
  });
  it("HELP/TYPE yorum satırlarını atlar", () => {
    expect(sumPromMetric(PROM, "ollamas_webhook_queue_depth")).toBe(3);
  });
  it("yok → 0", () => {
    expect(sumPromMetric(PROM, "nonexistent_metric")).toBe(0);
  });
  it("ad-prefix yanlış eşleşmez (mcp_tool_calls_total ≠ mcp_tool_calls_total_bucket)", () => {
    const t = 'mcp_tool_calls_total_bucket{le="1"} 99\nmcp_tool_calls_total{tool="x"} 5';
    expect(sumPromMetric(t, "mcp_tool_calls_total")).toBe(5);
  });
});

describe("promGauge", () => {
  it("tek-örnek gauge değerini döner", () => {
    expect(promGauge(PROM, "ollamas_migration_version")).toBe(13);
    expect(promGauge(PROM, "ollamas_webhook_queue_depth")).toBe(3);
  });
  it("yok → null", () => {
    expect(promGauge(PROM, "nope")).toBeNull();
  });
});
