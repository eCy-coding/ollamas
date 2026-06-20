import { describe, it, expect } from "vitest";
import { buildModelSelectionPrompt, DEFAULT_ROUTING, WARM_DEFAULT, type BenchPromptInput, type BenchAgg } from "../bin/lib/benchprompt";

const AGGS: BenchAgg[] = [
  { model: "qwen3-coder:30b", device: "mac", n: 1, medianTokS: 119.7, p95: 119.7, mad: 0, min: 119.7, max: 119.7, correctRatio: 1 },
  { model: "qwen3:4b", device: "mac", n: 1, medianTokS: 111, p95: 111, mad: 0, min: 111, max: 111, correctRatio: 0 },
  { model: "qwen3:8b", device: "mac", n: 1, medianTokS: 81.4, p95: 81.4, mad: 0, min: 81.4, max: 81.4, correctRatio: 1 },
];
const full: BenchPromptInput = {
  chip: "Apple M4 Max", best: { mac: AGGS[0] }, aggs: AGGS, regressions: [],
  routing: DEFAULT_ROUTING, ts: "2026-06-20T10:00:00Z",
};

describe("buildModelSelectionPrompt — taşınabilir çalışma-prensibi prompt'u", () => {
  const p = buildModelSelectionPrompt(full);

  it("en-verimli-DOĞRU champion modeli + tok/s sayısını içerir (runtime evidence)", () => {
    expect(p).toContain("qwen3-coder:30b");
    expect(p).toContain("119.7");
  });
  it("correctness-gate + tok/s prensibini açıkça belirtir", () => {
    expect(p).toMatch(/correctness/i);
    expect(p).toMatch(/tok\/s/i);
  });
  it("Tier-A routing (Opus plan / Sonnet code) çalışma-prensibini taşır", () => {
    expect(p).toMatch(/Opus/);
    expect(p).toMatch(/Sonnet/);
  });
  it("vibe-coding YASAK prensibini içerir (adopt-not-reinvent)", () => {
    expect(p).toMatch(/vibe/i);
  });
  it("yanlış-cevap-veren hızlı modeli (qwen3:4b correct=0) elenmiş gösterir", () => {
    expect(p).toContain("qwen3:4b");
    expect(p).toMatch(/disqualif|elen|✗|wrong/i);
  });
  it("deterministik — aynı girdi aynı çıktı (Date.now yok)", () => {
    expect(buildModelSelectionPrompt(full)).toBe(p);
  });
  it("taşınabilir: self-contained + sectioned (paste-anywhere)", () => {
    expect(p).toMatch(/<role>/);
    expect(p).toMatch(/<working_principles>/);
    expect(p).toMatch(/<runtime_evidence/);
    expect(p).toMatch(/<selection_rule>/);
  });
});

describe("buildModelSelectionPrompt — graceful fallback", () => {
  it("benchmark verisi yoksa warm-default qwen3:8b'ye düşer + uyarır", () => {
    const empty = buildModelSelectionPrompt({ chip: "?", best: {}, aggs: [], regressions: [], routing: DEFAULT_ROUTING, ts: "t" });
    expect(empty).toContain(WARM_DEFAULT);
    expect(empty).toMatch(/no benchmark|henüz|fallback/i);
  });
  it("regresyon varsa selection_rule'da listeler", () => {
    const withReg = buildModelSelectionPrompt({
      ...full,
      regressions: [{ model: "qwen3:8b", device: "mac", baseTokS: 100, medianTokS: 81.4, dropPct: 18 }],
    });
    expect(withReg).toMatch(/regress/i);
    expect(withReg).toContain("18");
  });
});
