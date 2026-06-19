// Scripts domain v4 — golden tests for the adopted Ollama tok/s extraction
// (bench-metrics.mjs). The math comes from MinhNgyuen/llm-benchmark (MIT); these
// pin it against fixed fixtures so a regression in the formula is caught without
// a live Ollama. Pure functions only — no network, no fs.
import { describe, test, expect } from "vitest";
import {
  tokensPerSecond,
  extractOllamaMetrics,
  parsePlatformArg,
  detectDevice,
  benchRecord,
} from "../../bin/host-bridge/bench-metrics.mjs";

describe("tokensPerSecond", () => {
  test("count / (durationNs * 1e-9)", () => {
    // 100 tokens over 2s = 50 tok/s
    expect(tokensPerSecond(100, 2_000_000_000)).toBe(50);
    // 20 tokens over 0.1s = 200 tok/s
    expect(tokensPerSecond(20, 100_000_000)).toBe(200);
  });

  test("guards missing/zero fields -> null (Ollama omits on cached prompt)", () => {
    expect(tokensPerSecond(0, 2_000_000_000)).toBeNull();
    expect(tokensPerSecond(100, 0)).toBeNull();
    expect(tokensPerSecond(undefined, undefined)).toBeNull();
    expect(tokensPerSecond(100, -5)).toBeNull();
  });
});

describe("extractOllamaMetrics", () => {
  // Deterministic fixture shaped like a real /api/generate (stream:false) reply.
  const FIXTURE = {
    prompt_eval_count: 20,
    prompt_eval_duration: 100_000_000, // 0.1s -> 200 tok/s
    eval_count: 100,
    eval_duration: 2_000_000_000, // 2s -> 50 tok/s
    total_duration: 2_500_000_000, // 2.5s, 120 tokens -> 48 tok/s
  };

  test("splits prompt vs response throughput (golden)", () => {
    const m = extractOllamaMetrics(FIXTURE);
    expect(m).toEqual({
      promptTokens: 20,
      responseTokens: 100,
      promptTps: 200,
      responseTps: 50,
      totalTps: 48,
    });
  });

  test("absent fields degrade to null, never throw", () => {
    expect(extractOllamaMetrics({})).toEqual({
      promptTokens: null,
      responseTokens: null,
      promptTps: null,
      responseTps: null,
      totalTps: null,
    });
    expect(extractOllamaMetrics(undefined).responseTps).toBeNull();
  });
});

describe("parsePlatformArg", () => {
  test("--platform ios -> ios", () => {
    expect(parsePlatformArg(["node", "benchmark.mjs", "--platform", "ios"])).toBe("ios");
  });
  test("default + unknown -> macos (no throw)", () => {
    expect(parsePlatformArg(["node", "benchmark.mjs"])).toBe("macos");
    expect(parsePlatformArg(["--platform", "windows"])).toBe("macos");
    expect(parsePlatformArg(["--platform"])).toBe("macos"); // missing value
  });
});

describe("benchRecord schema (v4 key: platform+device+method)", () => {
  test("emits the canonical normalized shape", () => {
    const rec = benchRecord({
      platform: "macos",
      device: "mac.local",
      method: "app-generate",
      model: "ollama-local/qwen3:4b",
      responseTps: 78.3,
      latencyMs: 1200,
      correct: true,
      ts: "2026-06-19T00:00:00.000Z",
    });
    expect(Object.keys(rec).sort()).toEqual(
      [
        "correct", "device", "latencyMs", "method", "model",
        "platform", "promptTps", "responseTps", "totalTps", "ts",
      ].sort(),
    );
    expect(rec.promptTps).toBeNull(); // unset defaults to null, not undefined
    expect(rec.responseTps).toBe(78.3);
  });
});

describe("detectDevice", () => {
  test("reads local hardware identity (shape only, machine-agnostic)", () => {
    const d = detectDevice();
    expect(typeof d.device).toBe("string");
    expect(typeof d.ncpu).toBe("number");
    expect(d.ncpu).toBeGreaterThan(0);
    expect(typeof d.memGb).toBe("number");
    expect(["arm64", "x64", "arm", "ia32"]).toContain(d.arch);
  });
});
