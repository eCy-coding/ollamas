import { describe, it, expect } from "vitest";
import {
  median, percentile, mad, sparkline, normModel,
  normalizeBenchmark, normalizeCliBench, baselineFromCalibration,
  aggregate, rankEfficient, regressions, isStale,
} from "../bin/lib/bench";

describe("isStale — bench tazelik (0-manuel refresh tetiği)", () => {
  const now = Date.parse("2026-06-20T12:00:00Z");
  it("taze (1 gün) → false", () => {
    expect(isStale("2026-06-19T12:00:00Z", 2, now)).toBe(false);
  });
  it("bayat (6 gün) → true", () => {
    expect(isStale("2026-06-14T12:00:00Z", 2, now)).toBe(true);
  });
  it("geçersiz/boş ts → true (bilinmeyen=güvenli-stale)", () => {
    expect(isStale("", 2, now)).toBe(true);
    expect(isStale("not-a-date", 2, now)).toBe(true);
  });
  it("maxDays sınırı dahil (tam 2 gün → false)", () => {
    expect(isStale("2026-06-18T12:00:00Z", 2, now)).toBe(false);
  });
});

describe("stats", () => {
  it("median tek/çift", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBe(0);
  });
  it("percentile p95", () => {
    expect(percentile([10, 20, 30, 40, 50], 95)).toBe(50);
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });
  it("mad outlier-robust", () => {
    expect(mad([10, 10, 10])).toBe(0);
    expect(mad([1, 1, 1, 100])).toBe(0); // sapmalar [0,0,0,99] median=0 (outlier-robust)
    expect(mad([1, 2, 4, 8])).toBe(1.5); // median=3, sapmalar [2,1,1,5] sorted[1,1,2,5] median=1.5
  });
  it("sparkline blok char + uzunluk", () => {
    const s = sparkline([1, 5, 9]);
    expect(s).toHaveLength(3);
    expect(/[▁▂▃▄▅▆▇█]/.test(s)).toBe(true);
    expect(sparkline([])).toBe("");
    expect(sparkline([5, 5])).toBe("▄▄"); // eşit → orta seviye
  });
});

describe("normalize — 3 şema", () => {
  it("normModel provider prefix atar", () => {
    expect(normModel("ollama-local/qwen3:8b")).toBe("qwen3:8b");
    expect(normModel("qwen3:8b")).toBe("qwen3:8b");
  });
  it("benchmark.json: tok_s:null atılır, device=mac", () => {
    const r = normalizeBenchmark({ ts: "T", results: [
      { model: "ollama-local/qwen3:8b", tok_s: 81.4, total_ms: 4314, correct: true },
      { model: "gemini/x", tok_s: null, correct: true },
    ]});
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ device: "mac", model: "qwen3:8b", tokS: 81.4, correct: true });
  });
  it("cli-bench.json: target=mac/ios, correctRatio>=1 → correct", () => {
    const r = normalizeCliBench({ ts: "T", targets: [
      { target: "mac", results: [{ model: "qwen3:8b", tokPerSec: 76.3, totalMs: 120, correctRatio: 1 }] },
      { target: "ios", results: [{ model: "qwen3:8b", tokPerSec: 12.5, totalMs: 800, correctRatio: 0.5 }] },
    ]});
    expect(r).toHaveLength(2);
    expect(r.find(x => x.device === "ios")?.correct).toBe(false);
    expect(r.find(x => x.device === "mac")?.tokS).toBe(76.3);
  });
  it("baselineFromCalibration ranked → Map", () => {
    const b = baselineFromCalibration({ benchmark: { ranked: [
      { model: "ollama-local/qwen3:8b", tok_s: 81.4 },
      { model: "gemini/x", tok_s: null },
    ]}});
    expect(b.get("qwen3:8b")).toBe(81.4);
    expect(b.has("x")).toBe(false);
  });
});

describe("aggregate / rank / regression", () => {
  const recs = [
    { device: "mac", model: "qwen3:8b", tokS: 80, latencyMs: 0, correct: true, ts: "", source: "" },
    { device: "mac", model: "qwen3:8b", tokS: 90, latencyMs: 0, correct: true, ts: "", source: "" },
    { device: "mac", model: "slow:70b", tokS: 200, latencyMs: 0, correct: false, ts: "", source: "" },
  ];
  it("aggregate median (2 koşu)", () => {
    const a = aggregate(recs);
    const q = a.find(x => x.model === "qwen3:8b")!;
    expect(q.n).toBe(2);
    expect(q.medianTokS).toBe(85);
    expect(q.correctRatio).toBe(1);
  });
  it("rankEfficient: yanlış model dışlanır (200 tok/s ama correct=false)", () => {
    const best = rankEfficient(aggregate(recs));
    expect(best.get("mac")?.model).toBe("qwen3:8b"); // slow:70b değil
  });
  it("regressions: baseline 100 → 85 flag (-%15>10); 95 flag yok", () => {
    const aggs = aggregate(recs);
    const baseFlagged = regressions(aggs, new Map([["qwen3:8b", 100]]));
    expect(baseFlagged).toHaveLength(1);
    expect(baseFlagged[0].dropPct).toBe(15);
    const baseOk = regressions(aggs, new Map([["qwen3:8b", 90]])); // 85 vs 90 = -%5.6 < 10
    expect(baseOk).toHaveLength(0);
  });
});

describe("aggregate — tokS==0/NaN invalid-sample dışlama (v1.25.1 bench honesty)", () => {
  it("0 ve NaN örnekler medianTokS'tan hariç; geçerli örnek median'ı belirler", () => {
    const recs = [
      { device: "mac", model: "flaky:8b", tokS: 0, latencyMs: 0, correct: true, ts: "", source: "" },
      { device: "mac", model: "flaky:8b", tokS: 90, latencyMs: 0, correct: true, ts: "", source: "" },
      { device: "mac", model: "flaky:8b", tokS: NaN, latencyMs: 0, correct: true, ts: "", source: "" },
    ];
    const q = aggregate(recs).find((x) => x.model === "flaky:8b")!;
    expect(q.medianTokS).toBe(90); // 0 ve NaN hariç → tek geçerli örnek 90
  });
  it("TÜM örnekler geçersiz → medianTokS 0 → rankEfficient champion vermez", () => {
    const aggs = aggregate([
      { device: "mac", model: "ghost:8b", tokS: 0, latencyMs: 0, correct: true, ts: "", source: "" },
    ]);
    expect(aggs[0].medianTokS).toBe(0);
    expect(rankEfficient(aggs).get("mac")).toBeUndefined();
  });
});

describe("rankEfficient — champion gate (Faz11B: rounded-ratio diskalifiye regresyonu)", () => {
  it("11/12 doğru (0.9166) model champion seçilir — round'lanıp 0.9'a düşüp dışlanmamalı", () => {
    const recs = [];
    for (let i = 0; i < 12; i++) {
      recs.push({ device: "mac", model: "good:8b", tokS: 100, latencyMs: 0, correct: i < 11, ts: "", source: "" });
    }
    // tek rakip: %100 doğru ama YAVAŞ → good:8b (0.9166, hızlı) champion olmalı
    recs.push({ device: "mac", model: "perfect:70b", tokS: 50, latencyMs: 0, correct: true, ts: "", source: "" });
    const best = rankEfficient(aggregate(recs));
    expect(best.get("mac")?.model).toBe("good:8b");
  });
});
