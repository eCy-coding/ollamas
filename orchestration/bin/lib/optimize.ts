/**
 * orchestration/bin/lib/optimize.ts — Benchmark-driven optimal-config selector (zero-dep, pure).
 *
 * M4 sistem + ollamas bench verisi → DETERMİNİSTİK en-verimli DOĞRU model + optimal config seç →
 * portable working-prompt üret. ML YOK: weighted-sum çok-kriter (correctness-gate → tok/s → vram-fit).
 * Bütünlük: runtime (M4 config) + matematiksel (Pareto/normalize/lexicographic-tiebreak) + kod (prompt prensipleri).
 * Pattern ref: RouteLLM (correctness-gate), MLX (Apple Silicon config), semantic-router (deterministik seçim).
 */
import type { Agg } from "./bench";

export interface SysInfo { arch: string; ramGb: number; cores: number; chip: string; }
export interface Weights { correctness: number; speed: number; vramFit: number; }
export interface Scored { model: string; score: number; tokS: number; correctRatio: number; vramGb: number; fits: boolean; reason: string; }
export interface OptConfig { num_ctx: number; num_gpu: number; num_thread: number; keep_alive: string; quant: string; }
export interface Selection { sys: SysInfo; model: string; score: number; tokS: number; config: OptConfig; reason: string; }

export const DEFAULT_WEIGHTS: Weights = { correctness: 0.5, speed: 0.3, vramFit: 0.2 };
const CORRECT_GATE = 0.7; // RouteLLM deseni: correctness floor altında reddet.

/** Model → kaba VRAM tahmini (GB). Bilinmeyen → param-sayısından ~0.65GB/B (Q4) tahmin. */
const MODEL_VRAM: Record<string, number> = {
  "qwen3:8b": 5.2, "qwen3:8b-16k": 6.0, "qwen3-coder:30b": 18, "qwen3:30b-a3b": 18,
  "deepseek-r1:32b": 20, "qwen2.5vl:7b": 6, "gemma3:27b": 16, "llama3.3:70b": 40,
};
export function modelVramGb(model: string): number {
  const m = model.toLowerCase();
  if (MODEL_VRAM[m] != null) return MODEL_VRAM[m];
  const b = m.match(/(\d+(?:\.\d+)?)b\b/); // "...30b..." → 30
  return b ? Math.round(parseFloat(b[1]) * 0.65 * 10) / 10 : 8;
}

/** Model RAM'e sığar mı? (unified memory'nin %80'i — OS payı bırak). */
export function vramFit(model: string, ramGb: number): boolean {
  return modelVramGb(model) <= ramGb * 0.8;
}

// ── Pure parsers ──────────────────────────────────────────────────────────────

/** sysctl string'leri → SysInfo (test edilebilir; canlı çağrı ayrı). */
export function parseSysctl(memBytes: string, physCpu: string, brand: string): SysInfo {
  const bytes = parseInt((memBytes || "").trim(), 10);
  const ramGb = Number.isFinite(bytes) ? Math.round(bytes / 1e9) : 0;
  const cores = parseInt((physCpu || "").trim(), 10) || 0;
  const chip = (brand || "").trim() || "?";
  const arch = /apple|arm|m\d/i.test(chip) ? "arm64" : "x64";
  return { arch, ramGb, cores, chip };
}

// ── Skorlama (matematiksel bütünlük) ──────────────────────────────────────────

/** Tek model skoru. Correctness-gate: ratio<0.7 → 0 (reddet). Aksi weighted-sum (min-max normalize tok/s). */
export function scoreModel(a: Agg, maxTokS: number, ramGb: number, w: Weights = DEFAULT_WEIGHTS): Scored {
  const vramGb = modelVramGb(a.model);
  const fits = vramGb <= ramGb * 0.8;
  if (a.correctRatio < CORRECT_GATE) {
    return { model: a.model, score: 0, tokS: a.medianTokS, correctRatio: a.correctRatio, vramGb, fits, reason: `correctness ${a.correctRatio} < gate ${CORRECT_GATE} → reddedildi` };
  }
  if (!fits) {
    return { model: a.model, score: 0, tokS: a.medianTokS, correctRatio: a.correctRatio, vramGb, fits, reason: `VRAM ${vramGb}GB > ram*0.8 (${(ramGb * 0.8).toFixed(0)}GB) → sığmaz` };
  }
  const normTok = maxTokS > 0 ? a.medianTokS / maxTokS : 0;
  const fitScore = ramGb > 0 ? 1 - vramGb / (ramGb * 0.8) : 0; // az VRAM = daha iyi sığma
  const score = w.correctness * a.correctRatio + w.speed * normTok + w.vramFit * fitScore;
  return {
    model: a.model, score: Math.round(score * 1000) / 1000, tokS: a.medianTokS,
    correctRatio: a.correctRatio, vramGb, fits,
    reason: `correct ${a.correctRatio} + tok ${a.medianTokS}/${maxTokS} + vram-fit ${fitScore.toFixed(2)}`,
  };
}

/** Tüm adayları skorla (sıralı; lexicographic tie-break determinizm için).
 * maxTokS YALNIZ gate-geçen+sığan adaylardan (reddedilen hızlı-yanlış model tavanı bozmasın). */
export function scoreAll(aggs: Agg[], ramGb: number, w: Weights = DEFAULT_WEIGHTS): Scored[] {
  const valid = aggs.filter((a) => a.correctRatio >= CORRECT_GATE && modelVramGb(a.model) <= ramGb * 0.8);
  const maxTokS = Math.max(1, ...valid.map((a) => a.medianTokS));
  return aggs
    .map((a) => scoreModel(a, maxTokS, ramGb, w))
    .sort((x, y) => y.score - x.score || x.model.localeCompare(y.model));
}

/** En-verimli doğru model. Hiçbiri geçmezse null. */
export function selectBest(aggs: Agg[], ramGb: number, w: Weights = DEFAULT_WEIGHTS): Scored | null {
  const scored = scoreAll(aggs, ramGb, w);
  return scored.length && scored[0].score > 0 ? scored[0] : null;
}

// ── M4 optimal config matrisi (runtime bütünlük) ──────────────────────────────

/** RAM-tier → optimal Ollama/MLX config. num_gpu daima 999 (Apple Silicon tüm-Metal). */
export function optimalConfig(ramGb: number, cores: number, model: string): OptConfig {
  const numThread = Math.min(12, Math.max(4, cores - 2)); // OS'a 2 core bırak
  let num_ctx = 4096;
  if (ramGb >= 32) num_ctx = 8192;
  else if (ramGb >= 24) num_ctx = 8192;
  else if (ramGb >= 16) num_ctx = 4096;
  else num_ctx = 2048;
  // Büyük model + büyük ctx aynı anda → ctx'i bir tık düşür (VRAM baskısı).
  if (modelVramGb(model) >= 18 && num_ctx > 8192) num_ctx = 8192;
  return { num_ctx, num_gpu: 999, num_thread: numThread, keep_alive: "30m", quant: "Q4_K_M" };
}

// ── Portable working-prompt jeneratörü (kod-bütünlüğü) ─────────────────────────

/** Kusursuz, kendine-yeten, global-standart working-prompt. XML-tag + Vanderbilt 5-parça. */
export function buildWorkingPrompt(sel: Selection, principlesSummary: string): string {
  const c = sel.config;
  return [
    `# OLLAMAS — OPTIMAL WORKING PROMPT (self-optimizing, portable)`,
    ``,
    `> Bu blok nereye yapıştırılırsa orada ollamas için EN-VERİMLİ seçimle çalışmaya başlar.`,
    `> \`optimize.ts\` üretti — benchmark-driven, deterministik. Bench/calibration değişince seçim otomatik güncellenir.`,
    ``,
    `<context>`,
    `Donanım: ${sel.sys.chip} · ${sel.sys.ramGb}GB unified · ${sel.sys.cores} core · ${sel.sys.arch}.`,
    `Proje: ollamas (yerel MCP gateway + tools-as-SaaS). Çalışma prensipleri: ${principlesSummary}`,
    `</context>`,
    ``,
    `<selected-runtime>`,
    `Model: **${sel.model}** — benchmark-seçili (${sel.tokS} tok/s, doğru; correctness-gate ✓; skor ${sel.score}).`,
    `Gerekçe: ${sel.reason}`,
    `Optimal Ollama/MLX config:`,
    `  num_ctx=${c.num_ctx}  num_gpu=${c.num_gpu}  num_thread=${c.num_thread}  keep_alive=${c.keep_alive}  quant=${c.quant}`,
    `Runtime: Apple Silicon → Ollama ≥0.19 MLX backend (num_gpu=999 tüm-Metal); warm-model (keep_alive) reload latency'yi siler.`,
    `</selected-runtime>`,
    ``,
    `<task>`,
    `Verilen görevi bu model+config ile yürüt. Yeni görev gelince önce \`tsx orchestration/bin/optimize.ts\` koş → o anki en-verimli seçimi al.`,
    `</task>`,
    ``,
    `<constraints>`,
    `- Kod-bütünlüğü: ollamas choke-point (ToolRegistry.execute) tek-dispatch; TDD (test önce); evidence-first (çalışıyor=komut çıktısı göster).`,
    `- No vibe-code: hazır OSS adopt (MIT/Apache kopya+attribution, GPL ref-only); zero-dep tercih.`,
    `- Correctness > hız: yanlış-ama-hızlı model diskalifiye (correctness-gate ${CORRECT_GATE}).`,
    `- Kalite kapısı: typecheck + lint + test taze koşu → conventional commit.`,
    `</constraints>`,
    ``,
    `<format>`,
    `Sıra: READ → PLAN → TDD → BUILD → VERIFY(kanıt) → SHIP. Çıktı net, token-yalın.`,
    `</format>`,
    ``,
    `<example>`,
    `İyi: "${sel.model} num_ctx=${c.num_ctx} ile koştum → test 12/12 yeşil (çıktı altta)."`,
    `Kötü: "Çalışıyor." (kanıtsız — reddet.)`,
    `</example>`,
  ].join("\n");
}
