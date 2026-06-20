#!/usr/bin/env tsx
/**
 * orchestration/bin/benchprompt.ts — Benchmark → taşınabilir model-seçim PROMPT'u (vO6.1).
 *
 * READ-ONLY: worker bench-core'unun ürettiği `orchestration/BENCH.json`'ı CONSUME eder
 * (re-run YOK, clobber YOK), Tier-A routing (plan.md §1) ile füzyon eder →
 * `orchestration/MODEL_PROMPT.md` + stdout. Nereye yapıştırılırsa en-verimli seçimle
 * çalışmaya başlayan self-contained prompt. Self-update: BENCH.json değişince prompt tazelenir.
 *
 * Çalıştır: tsx orchestration/bin/benchprompt.ts
 */
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { buildModelSelectionPrompt, DEFAULT_ROUTING, type BenchPromptInput, type BenchAgg, type BenchRegression } from "./lib/benchprompt";

const ORCH_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const BENCH_JSON = join(ORCH_DIR, "BENCH.json");
const OUT = join(ORCH_DIR, "MODEL_PROMPT.md");

/** BENCH.json (worker bench.ts çıktısı) → prompt girdisi. Yoksa graceful boş (fallback prompt). */
function readBench(): BenchPromptInput {
  // ts = ölçüm zamanı kararlı işaret (dosya mtime); her koşuda churn yapmaz, bench re-run'da tazelenir.
  let chip = "?", aggs: BenchAgg[] = [], best: Record<string, BenchAgg> = {}, regressions: BenchRegression[] = [], ts = "no-bench";
  if (existsSync(BENCH_JSON)) {
    try {
      const j = JSON.parse(readFileSync(BENCH_JSON, "utf8"));
      chip = j.chip || "?";
      aggs = Array.isArray(j.aggs) ? j.aggs : [];
      best = j.best && typeof j.best === "object" ? j.best : {};
      regressions = Array.isArray(j.regressions) ? j.regressions : [];
      ts = statSync(BENCH_JSON).mtime.toISOString();
    } catch { /* bozuk → boş fallback */ }
  }
  return { chip, best, aggs, regressions, routing: DEFAULT_ROUTING, ts };
}

function main(): void {
  const input = readBench();
  const prompt = buildModelSelectionPrompt(input);
  writeFileSync(OUT, prompt.endsWith("\n") ? prompt : prompt + "\n");
  process.stdout.write(prompt + "\n");
  const champ = Object.entries(input.best).map(([d, a]) => `${d}:${a.model}`).join(", ") || "fallback qwen3:8b";
  console.error(`[benchprompt] MODEL_PROMPT.md yazıldı · ${input.aggs.length} model · champ ${champ}`);
}

if (process.argv[1] && /benchprompt\.ts$/.test(process.argv[1])) main();
