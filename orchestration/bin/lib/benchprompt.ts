/**
 * benchprompt.ts — Benchmark agregasyonunu (BENCH.json) + çalışma prensiplerini
 * TAŞINABİLİR, global-standart bir model-seçim PROMPT'una füzyon eder (vO6.1).
 *
 * PURE (I/O yok) → test edilebilir + deterministik (ts dışarıdan verilir, Date.now yok).
 * Yapı deseni adopt: f/prompts.chat (role→constraints→evidence→output) +
 * gszhangwei/structured-prompts (XML-section paste-anywhere). Kod kopyası YOK.
 *
 * Tipler LOKAL tanımlı (worker bench-core BENCH.json şemasıyla aynı) — commit-izolasyon:
 * worker'ın untracked lib/bench.ts'ine bağımlı değil; runtime'da BENCH.json düz-JSON okunur.
 */

/** BENCH.json `aggs[]` kaydı (worker bench-core ile yapı-eş; salt veri-şekli). */
export interface BenchAgg {
  model: string; device: string; n: number;
  medianTokS: number; p95: number; mad: number; min: number; max: number; correctRatio: number;
}
/** BENCH.json `regressions[]` kaydı. */
export interface BenchRegression { model: string; device: string; baseTokS: number; medianTokS: number; dropPct: number; }

export interface RoutingPolicy { planner: string; coder: string; cheap: string; }

/** Donanım-duyarlı yerel seçim (optimize.ts selectBest+optimalConfig sonucu; tip lokal = commit-izole). */
export interface LocalSelection {
  model: string; score: number; tokS: number; reason: string;
  config: { num_ctx: number; num_gpu: number; num_thread: number; keep_alive: string; quant: string };
}

/** Tier-A Claude routing (plan.md §1) — local-bench DEĞİL, public 2026 leaderboard ile. */
export const DEFAULT_ROUTING: RoutingPolicy = {
  planner: "Opus 4.8 (claude-opus-4-8)",
  coder: "Sonnet 4.6 (claude-sonnet-4-6)",
  cheap: "Haiku 4.5 (claude-haiku-4-5-20251001)",
};

/** Bench yokken sıcak varsayılan (providers.ts M4 tuned). */
export const WARM_DEFAULT = "qwen3:8b";

export interface BenchPromptInput {
  chip: string;
  best: Record<string, BenchAgg>;   // device → en-verimli-DOĞRU champion
  aggs: BenchAgg[];
  regressions: BenchRegression[];
  routing: RoutingPolicy;
  ts: string;                  // ölçüm/üretim zamanı (deterministik test için param)
  localSelection?: LocalSelection;  // VARSA donanım-duyarlı pick (selectBest); YOKSA champion fallback
  stale?: boolean;             // bench verisi bayat mı (uyarı satırı)
}

/** selection_rule gövdesi: donanım-duyarlı localSelection varsa onu, yoksa champion+hardcoded M4. */
function selectionLines(input: BenchPromptInput): string[] {
  const ls = input.localSelection;
  if (ls) {
    const c = ls.config;
    return [
      `- **🏆 Seçili (donanım-optimal, 0-manuel): \`${ls.model}\`** — ${ls.tokS} tok/s, skor ${ls.score} ` +
        `(correctness-gate ✓ + VRAM-fit ✓; bu RAM'e sığan en-verimli DOĞRU model).`,
      `- Gerekçe: ${ls.reason}.`,
      `- Optimal config (RAM-tier-duyarlı): \`num_ctx=${c.num_ctx}\` \`num_gpu=${c.num_gpu}\` \`num_thread=${c.num_thread}\` \`keep_alive=${c.keep_alive}\` \`quant=${c.quant}\`.`,
      `- **Yanlış cevap veren hızlı model elenir** (correct=0 → daha hızlı olsa bile diskalifiye).`,
      `- Apple Silicon: Ollama ≥0.19 **MLX backend** (~2× decode, ≥32GB unified RAM) tercih et.`,
    ];
  }
  return [
    champLine(input.best),
    `- **Yanlış cevap veren hızlı model elenir** (örn correct=0 olan model, daha yüksek tok/s olsa bile).`,
    `- M4 tuning: \`num_thread=12\`, \`num_gpu=999\`, \`num_ctx=8192\`, \`keep_alive=30m\` (sıcak tut, reload yok).`,
    `  Bench yoksa warm fallback \`${WARM_DEFAULT}\`.`,
    `- Apple Silicon: Ollama ≥0.19 **MLX backend** (~2× decode, ≥32GB unified RAM) tercih et.`,
  ];
}

function evidenceTable(aggs: BenchAgg[], best: Record<string, BenchAgg>): string {
  if (!aggs.length) {
    return `_Henüz benchmark verisi yok (no benchmark data). Önce \`tsx orchestration/bin/bench.ts\` koş; ` +
      `o zamana kadar warm fallback \`${WARM_DEFAULT}\`._`;
  }
  const rows = aggs.map((a) => {
    const champ = best[a.device]?.model === a.model;
    const pick = a.correctRatio === 0 ? "✗ disqualified (wrong)" : champ ? "🏆 use" : "ok";
    return `| ${a.device} | \`${a.model}\` | ${a.medianTokS} | ${a.p95} | ${a.mad} | ${Math.round(a.correctRatio * 100)} | ${pick} |`;
  });
  return [
    `| Device | Model | Median tok/s | p95 | ±MAD | Correct% | Pick |`,
    `|---|---|--:|--:|--:|--:|---|`,
    ...rows,
  ].join("\n");
}

function champLine(best: Record<string, BenchAgg>): string {
  const entries = Object.entries(best);
  if (!entries.length) return `- Bench yok → warm default \`${WARM_DEFAULT}\` (M4 tuned).`;
  return entries
    .map(([dev, a]) => `- **${dev}** → 🏆 \`${a.model}\` — ${a.medianTokS} tok/s (correct). Coding workload için bunu seç.`)
    .join("\n");
}

/** Taşınabilir model-seçim + çalışma-prensibi prompt'u üretir (markdown + XML-section). */
export function buildModelSelectionPrompt(input: BenchPromptInput): string {
  const { chip, best, aggs, regressions, routing, ts } = input;
  const regList = regressions.length
    ? regressions.map((r) => `\`${r.model}\`@${r.device}: ${r.medianTokS} vs baseline ${r.baseTokS} → **-%${r.dropPct}**`).join(" · ")
    : "none";

  const staleWarn = input.stale
    ? `> ⚠️ **Bench verisi bayat** (${ts}). Seçim en-iyi-bilinen veriye dayanır; tazelemek için \`tsx orchestration/bin/benchprompt.ts --refresh\` (server :3000 açıkken).`
    : `> ✓ Bench verisi taze (${ts}).`;
  return [
    `# OLLAMAS — OPTIMAL MODEL & WORKING-PRINCIPLE PROMPT`,
    `<!-- AUTO benchprompt.ts · ${ts} · chip ${chip} · regenerate: \`tsx orchestration/bin/benchprompt.ts\` · elle düzenleme -->`,
    ``,
    `> Taşınabilir + self-contained. Nereye yapıştırırsan yapıştır: aşağıdaki en-verimli seçimleri al ve`,
    `> **çalışmaya başla** — hangi modeli kullanacağını sorma. Seçimler runtime-kanıtlı (tok/s) +`,
    `> matematik-sağlam (median/MAD/p95) + kod-bütünlüğü (correctness-gate + gate-before-commit).`,
    staleWarn,
    ``,
    `<role>`,
    `Apple M4 (macOS) üzerinde **ollamas** projesinde otonom kıdemli mühendissin. Tek alanına odaklan,`,
    `kesintisiz çalış, "sıradaki versiyonu planla" denince todo+phase üret ve adım-adım kodla.`,
    `</role>`,
    ``,
    `<working_principles>`,
    `- **Planner** = ${routing.planner}; **Coder** = ${routing.coder}; **Cheap/search** = ${routing.cheap}.`,
    `  Ana oturum planner'da kalır; kodlama Coder subagent, arama/mekanik Cheap subagent (tek mesaj, paralel).`,
    `- **TDD**: önce test, sonra implementasyon. **Root-cause first** — semptom fix YASAK. **Evidence-first**:`,
    `  "çalışıyor" iddiası = komut çıktısını yapıştır.`,
    `- **Adopt, don't vibe-code**: top-star macOS repo'larından çalışan kodu entegre et, sıfırdan icat etme.`,
    `  Lisans: MIT/Apache kopya+attribution, GPL desen-only.`,
    `- **Gate before commit**: lint ✓ → test ✓ → conformance ✓. Per-file \`git add\` (asla \`-A\`). Conventional commit.`,
    `- **Claude'u lokal benchmark ETME** (API-only). Lokal model seçimi = on-device tok/s + correctness (aşağıda).`,
    `</working_principles>`,
    ``,
    `<runtime_evidence chip="${chip}" measured="${ts}">`,
    `Lokal çıkarım sıralaması — **önce correctness-gate, sonra tok/s** (throughput). tok/s = eval_count/eval_duration`,
    `(median; outlier-robust; ±MAD yayılım; p95 kuyruk). Regression = baseline'a göre >%10 düşüş.`,
    ``,
    evidenceTable(aggs, best),
    `</runtime_evidence>`,
    ``,
    `<selection_rule>`,
    ...selectionLines(input),
    `- Regresyon: ${regList}.`,
    `</selection_rule>`,
    ``,
    `<output>`,
    `Yukarıdaki seçimlerle ÇALIŞMAYA BAŞLA. "sıradaki versiyonu planla" → sonraki versiyonun todo+phase`,
    `listesini üret, sonra adım-adım yürüt (TDD, adopt-not-vibe, gate, per-file commit). 10 versiyon ileri planla;`,
    `mevcut adımı bitirirken sonraki adımı hesapla.`,
    `</output>`,
    ``,
  ].join("\n");
}
