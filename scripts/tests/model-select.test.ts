// Scripts domain v17 — efficient local-model selection. Correct-first, metric
// (latency|tps), data-driven min-tok/s + size filters, fallback when none correct.
import { describe, test, expect } from "vitest";
import { rankModels, pickModel } from "../../bin/host-bridge/lib/model-select.mjs";

const R = [
  { model: "qwen3:8b", tok_s: 76, total_ms: 1200, correct: true, ran: true, sizeGb: 5.2 },
  { model: "qwen3-coder:30b", tok_s: 120, total_ms: 900, correct: true, ran: true, sizeGb: 18 },
  { model: "deepseek-r1:32b", tok_s: 40, total_ms: 5000, correct: false, ran: true, sizeGb: 20 },
  { model: "broken:1b", tok_s: null, total_ms: null, correct: false, ran: false },
];

describe("model-select", () => {
  test("rank: correct-first then latency (default) — matches benchmark.mjs", () => {
    const order = rankModels(R).map((r) => r.model);
    // both correct first (lower total_ms first: coder 900 < qwen 1200), then the rest
    expect(order.slice(0, 2)).toEqual(["qwen3-coder:30b", "qwen3:8b"]);
    expect(order[order.length - 1]).toBeDefined();
    expect(rankModels(R)[0].correct).toBe(true);
  });

  test("metric tps: correct-first then highest tok/s", () => {
    const order = rankModels(R, { metric: "tps" }).map((r) => r.model);
    expect(order.slice(0, 2)).toEqual(["qwen3-coder:30b", "qwen3:8b"]); // 120 > 76, both correct
  });

  test("pickModel prefers fastest correct, with reason", () => {
    const p = pickModel(R, { metric: "tps" });
    expect(p.model).toBe("qwen3-coder:30b");
    expect(p.correct).toBe(true);
    expect(p.reason).toMatch(/fastest correct by tps/);
  });

  test("minTokS drops slow models (data-driven)", () => {
    const p = pickModel(R, { metric: "tps", minTokS: 100 });
    expect(p.model).toBe("qwen3-coder:30b"); // only 120 passes; still correct
  });

  test("maxSizeGb fits RAM budget (data-driven sizeGb)", () => {
    const p = pickModel(R, { metric: "tps", maxSizeGb: 8 });
    expect(p.model).toBe("qwen3:8b"); // coder 18GB filtered out, qwen 5.2GB fits
  });

  test("filter that empties the pool is relaxed (answer > none)", () => {
    const p = pickModel(R, { minTokS: 9999 });
    expect(p.model).not.toBeNull(); // relaxed back to full pool
  });

  test("no correct model → fallback with explicit reason", () => {
    const wrong = R.filter((r) => !r.correct);
    const p = pickModel(wrong);
    expect(p.correct).toBe(false);
    expect(p.reason).toMatch(/no correct model/);
    expect(p.model).not.toBeNull();
  });

  test("empty benchmark → null model, safe", () => {
    const p = pickModel([]);
    expect(p.model).toBeNull();
    expect(p.reason).toMatch(/no models/);
  });
});
