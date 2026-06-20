#!/usr/bin/env tsx
/**
 * orchestration/bin/bench.ts — Benchmark agregasyon raporu (vO6).
 *
 * READ-ONLY: ~/.llm-mission-control/{benchmark,cli-bench,calibration}.json tok/s
 * snapshot'larını okur, model×device agrege eder (median/p95/MAD), cihaz başına
 * en-verimli-DOĞRU modeli sıralar, calibration baseline'a göre regresyon işaretler →
 * orchestration/{BENCH.md,BENCH.json}. Yeni runner KOŞMAZ — yalnız mevcut çıktıyı agrege.
 *
 * Çalıştır: tsx orchestration/bin/bench.ts [--strict]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  normalizeBenchmark, normalizeCliBench, baselineFromCalibration,
  aggregate, rankEfficient, regressions, sparkline,
  type BenchRecord, type Agg,
} from "./lib/bench";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const MC = join(homedir(), ".llm-mission-control");
const STRICT = process.argv.includes("--strict");

function readJson(name: string): any {
  const f = join(MC, name);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
}

function main(): void {
  const benchmark = readJson("benchmark.json");
  const cliBench = readJson("cli-bench.json");
  const calibration = readJson("calibration.json");

  const records: BenchRecord[] = [
    ...(benchmark ? normalizeBenchmark(benchmark) : []),
    ...(cliBench ? normalizeCliBench(cliBench) : []),
  ];
  const baseline = calibration ? baselineFromCalibration(calibration) : new Map<string, number>();
  const aggs = aggregate(records);
  const best = rankEfficient(aggs);
  const regs = regressions(aggs, baseline);
  const chip = calibration?.chip || "?";

  // Cihaz başına ranking tablosu.
  const devices = [...new Set(aggs.map((a) => a.device))];
  const deviceTables: string[] = [];
  for (const dev of devices) {
    const rows = aggs.filter((a) => a.device === dev);
    const champ = best.get(dev);
    deviceTables.push(
      `### ${dev}${dev === "mac" ? ` (${chip})` : ""}`,
      ``,
      `| Model | Median tok/s | p95 | ±MAD | Koşu | Doğru% | Trend |`,
      `|---|--:|--:|--:|--:|--:|---|`,
      ...rows.map((a) => {
        const star = champ && a.model === champ.model ? " 🏆" : "";
        const trend = sparkline([a.min, a.medianTokS, a.max]);
        return `| ${a.model}${star} | ${a.medianTokS} | ${a.p95} | ${a.mad} | ${a.n} | ${Math.round(a.correctRatio * 100)} | ${trend} |`;
      }),
      ``,
    );
  }

  const champLines = devices
    .map((d) => { const c = best.get(d); return c ? `- **${d}**: 🏆 \`${c.model}\` — ${c.medianTokS} tok/s (doğru)` : `- **${d}**: doğru+hızlı aday yok`; });

  const regBlock = regs.length
    ? ["## ⚠️ Regresyon (baseline'a göre >%10 düşüş)", "",
       ...regs.map((r) => `- \`${r.model}\` @${r.device}: ${r.medianTokS} tok/s vs baseline ${r.baseTokS} → **-%${r.dropPct}**`)]
    : ["## ✅ Regresyon yok (baseline'a göre)"];

  const md = [
    `# BENCH — Benchmark Agregasyon (MacBook + iOS tok/s)`,
    ``,
    `> READ-ONLY \`bench.ts\` üretti. Kaynak: ${[benchmark && "benchmark.json", cliBench && "cli-bench.json", calibration && "calibration.json"].filter(Boolean).join(", ") || "yok"}.`,
    `> ${records.length} kayıt · ${aggs.length} model×device grubu · ${devices.length} cihaz · chip ${chip}.`,
    ``,
    `## 🏆 Cihaz başına en-verimli DOĞRU model`,
    ...champLines,
    ``,
    ...deviceTables,
    ...regBlock,
    ``,
    `---`,
    `_Agregasyon read-only; runner'ı lane'ler koşar. tok/s=median (mean değil, outlier-robust). Trend=min·median·max sparkline._`,
  ].join("\n");

  console.log(md);
  writeFileSync(join(ORCH_DIR, "BENCH.md"), md + "\n");
  writeFileSync(join(ORCH_DIR, "BENCH.json"), JSON.stringify({ chip, records: records.length, aggs, best: Object.fromEntries(best), regressions: regs }, null, 2) + "\n");
  console.error(`[bench] ${records.length} kayıt, ${aggs.length} grup, ${regs.length} regresyon.`);
  if (STRICT && regs.length) process.exit(1);
}

if (process.argv[1] && /bench\.ts$/.test(process.argv[1])) main();
