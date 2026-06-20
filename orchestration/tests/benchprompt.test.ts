import { describe, it, expect } from "vitest";
import { buildModelSelectionPrompt, DEFAULT_ROUTING, WARM_DEFAULT, type BenchPromptInput, type BenchAgg, type LocalSelection } from "../bin/lib/benchprompt";

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

describe("buildModelSelectionPrompt — FÜZYON: donanım-duyarlı localSelection (selectBest)", () => {
  const ls: LocalSelection = {
    model: "qwen3-coder:30b", score: 0.906, tokS: 119.7,
    reason: "correct 1 + tok 119.7/119.7 + vram-fit 0.53",
    config: { num_ctx: 8192, num_gpu: 999, num_thread: 12, keep_alive: "30m", quant: "Q4_K_M" },
  };
  const fused = buildModelSelectionPrompt({ ...full, localSelection: ls });

  it("donanım-optimal pick + RAM-tier config + Tier-A routing HEPSİ tek prompt'ta", () => {
    expect(fused).toContain("qwen3-coder:30b");       // yerel selectBest pick
    expect(fused).toContain("num_ctx=8192");          // RAM-tier config (hardcoded değil)
    expect(fused).toContain("num_gpu=999");
    expect(fused).toMatch(/donanım-optimal|0-manuel/i);
    expect(fused).toMatch(/Opus/);                     // Tier-A routing korunur
    expect(fused).toMatch(/Sonnet/);
    expect(fused).toMatch(/skor 0\.906/);             // selectBest skoru görünür
  });
  it("localSelection YOKSA champion fallback (geriye-uyum)", () => {
    expect(buildModelSelectionPrompt(full)).toMatch(/🏆.*qwen3-coder:30b|use/);
  });
  it("stale=true → bayat uyarısı; stale=false → taze", () => {
    expect(buildModelSelectionPrompt({ ...full, stale: true })).toMatch(/bayat/i);
    expect(buildModelSelectionPrompt({ ...full, stale: false })).toMatch(/taze/i);
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
