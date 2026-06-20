import { describe, it, expect } from "vitest";
import {
  parseSysctl, modelVramGb, vramFit, scoreModel, scoreAll, selectBest,
  optimalConfig, buildWorkingPrompt, DEFAULT_WEIGHTS,
  type SysInfo, type Selection,
} from "../bin/lib/optimize";
import type { Agg } from "../bin/lib/bench";

const agg = (model: string, tokS: number, correctRatio: number): Agg =>
  ({ model, device: "mac", n: 1, medianTokS: tokS, p95: tokS, mad: 0, min: tokS, max: tokS, correctRatio });

describe("parseSysctl", () => {
  it("M4 Max 48GB", () => {
    const s = parseSysctl("51539607552", "16", "Apple M4 Max");
    expect(s).toEqual({ arch: "arm64", ramGb: 52, cores: 16, chip: "Apple M4 Max" });
  });
  it("8GB / bozuk girdi graceful", () => {
    expect(parseSysctl("8589934592", "8", "Apple M2").ramGb).toBe(9);
    expect(parseSysctl("", "", "").ramGb).toBe(0);
  });
});

describe("modelVramGb + vramFit", () => {
  it("bilinen + param-tahmin", () => {
    expect(modelVramGb("qwen3-coder:30b")).toBe(18);
    expect(modelVramGb("qwen3:8b")).toBe(5.2);
    expect(modelVramGb("mystery:13b")).toBeCloseTo(8.5, 1); // 13*0.65
  });
  it("vramFit: 48GB'de 30b sığar, 8GB'de sığmaz", () => {
    expect(vramFit("qwen3-coder:30b", 48)).toBe(true);
    expect(vramFit("qwen3-coder:30b", 8)).toBe(false);
  });
});

describe("scoreModel — correctness-gate + weighted-sum", () => {
  it("yüksek correct + yüksek tok → yüksek skor", () => {
    const s = scoreModel(agg("qwen3-coder:30b", 120, 1), 120, 48);
    expect(s.score).toBeGreaterThan(0.7);
    expect(s.fits).toBe(true);
  });
  it("correctness < 0.7 → gate 0 (reddet)", () => {
    const s = scoreModel(agg("fast-wrong:7b", 200, 0.5), 200, 48);
    expect(s.score).toBe(0);
    expect(s.reason).toMatch(/gate/);
  });
  it("VRAM sığmaz → skor 0", () => {
    const s = scoreModel(agg("llama3.3:70b", 40, 1), 40, 16); // 40GB > 16*0.8
    expect(s.score).toBe(0);
    expect(s.reason).toMatch(/sığmaz/i);
  });
});

describe("selectBest — en-verimli doğru", () => {
  const aggs = [
    agg("qwen3-coder:30b", 120, 1),   // doğru, hızlı
    agg("fast-wrong:7b", 200, 0.5),   // hızlı ama yanlış → gate
    agg("qwen3:8b", 81, 1),           // doğru, yavaş
  ];
  it("48GB: yanlış-ama-hızlı diskalifiye, doğru-hızlı kazanır", () => {
    const best = selectBest(aggs, 48);
    expect(best?.model).toBe("qwen3-coder:30b");
  });
  it("8GB: 30b VRAM elenir → qwen3:8b kazanır", () => {
    const best = selectBest(aggs, 8);
    expect(best?.model).toBe("qwen3:8b");
  });
  it("lexicographic tie-break (eşit skor → deterministik)", () => {
    const tie = [agg("b-model", 100, 1), agg("a-model", 100, 1)];
    expect(selectBest(tie, 48)?.model).toBe("a-model");
  });
});

describe("optimalConfig — M4 RAM-tier", () => {
  it("48GB → num_ctx 8192, num_gpu 999, thread cores-2", () => {
    const c = optimalConfig(48, 16, "qwen3-coder:30b");
    expect(c.num_ctx).toBe(8192);
    expect(c.num_gpu).toBe(999);
    expect(c.num_thread).toBe(12);
    expect(c.keep_alive).toBe("30m");
  });
  it("8GB → num_ctx 2048", () => {
    expect(optimalConfig(8, 8, "qwen3:8b").num_ctx).toBe(2048);
  });
});

describe("buildWorkingPrompt — portable, kendine-yeten", () => {
  const sel: Selection = {
    sys: { arch: "arm64", ramGb: 48, cores: 16, chip: "Apple M4 Max" },
    model: "qwen3-coder:30b", score: 0.85, tokS: 119.7,
    config: { num_ctx: 8192, num_gpu: 999, num_thread: 12, keep_alive: "30m", quant: "Q4_K_M" },
    reason: "correct 1 + tok 119.7/119.7 + vram-fit 0.53",
  };
  const out = buildWorkingPrompt(sel, "choke-point, TDD, no-vibe-code");
  it("model + config + prensip + self-optimize-direktif", () => {
    expect(out).toContain("qwen3-coder:30b");
    expect(out).toContain("num_ctx=8192");
    expect(out).toContain("num_gpu=999");
    expect(out).toMatch(/self-optimizing|otomatik güncellenir/i);
    expect(out).toMatch(/choke-point/);
    expect(out).toMatch(/no vibe-code/i);
  });
  it("XML-tag + Vanderbilt bölümleri", () => {
    for (const tag of ["<context>", "<selected-runtime>", "<task>", "<constraints>", "<format>", "<example>"]) {
      expect(out).toContain(tag);
    }
  });
  it("M4 chip + config portable (kendine-yeter)", () => {
    expect(out).toContain("Apple M4 Max");
    expect(out).toMatch(/optimize\.ts/); // nereye yapıştırılırsa optimize.ts koş direktifi
  });
});
