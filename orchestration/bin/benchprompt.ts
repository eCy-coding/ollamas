#!/usr/bin/env tsx
/**
 * orchestration/bin/benchprompt.ts — FÜZYON: 0-manuel optimal model+config → TEK portable prompt (vO6.1).
 *
 * READ-ONLY conductor: canlı sysctl (M4 RAM/cores algıla) + `~/.llm-mission-control/{benchmark,cli-bench,
 * calibration}.json` tüket → bench.aggregate → **optimize.selectBest** (donanım-duyarlı: correctness-gate +
 * VRAM-fit + tok/s) + optimalConfig (RAM-tier) → benchprompt.buildModelSelectionPrompt (Tier-A Claude routing
 * FÜZYON) → `MODEL_PROMPT.md` + `MODEL_SELECTION.json`. Nereye yapıştırılırsa en-verimli seçimle çalışır.
 *
 * 0-manuel-SEÇİM: selectBest insan-girdisiz. Staleness: bayatsa uyarır; `--refresh`/OPTIMIZE_REFRESH=1 opt-in
 * → server :3000 açıksa `bin/host-bridge/benchmark.mjs` koş (ağır bench = bench-lane işi; default tüket+uyar §3).
 *
 * Çalıştır: tsx orchestration/bin/benchprompt.ts [--refresh] [--explain]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import {
  normalizeBenchmark, normalizeCliBench, baselineFromCalibration, aggregate, rankEfficient,
  regressions, isStale, type BenchRecord, type Agg,
} from "./lib/bench";
import { parseSysctl, selectBest, optimalConfig, type SysInfo } from "./lib/optimize";
import {
  buildModelSelectionPrompt, DEFAULT_ROUTING,
  type BenchPromptInput, type BenchAgg, type BenchRegression, type LocalSelection, type FreeApiProvider,
} from "./lib/benchprompt";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const WT_ROOT = join(ORCH_DIR, "..");
const MC = join(homedir(), ".llm-mission-control");
const REFRESH = process.argv.includes("--refresh") || process.env.OPTIMIZE_REFRESH === "1";
const EXPLAIN = process.argv.includes("--explain");
const STALE_DAYS = Number(process.env.OPTIMIZE_STALE_DAYS || 2);

function sysctl(key: string): string {
  try { return execFileSync("sysctl", ["-n", key], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return ""; }
}
function readJson(name: string): any {
  const f = join(MC, name);
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
}

/** Bench verisini topla: benchmark.json + cli-bench.json normalize → records + en taze ts. */
function loadRecords(): { records: BenchRecord[]; ts: string } {
  const bench = readJson("benchmark.json");
  const cli = readJson("cli-bench.json");
  const records = [
    ...(bench ? normalizeBenchmark(bench) : []),
    ...(cli ? normalizeCliBench(cli) : []),
  ];
  const ts = bench?.ts || cli?.ts || records[0]?.ts || "no-bench";
  return { records, ts };
}

/** opt-in refresh: server :3000 açıksa benchmark.mjs koş (never-throw). */
async function maybeRefresh(stale: boolean): Promise<boolean> {
  if (!REFRESH || !stale) return false;
  try {
    const r = await fetch("http://127.0.0.1:3000/api/health", { signal: AbortSignal.timeout(800) }); // nosemgrep: react-insecure-request -- localhost ollama/host loopback, no transport risk
    if (!r.ok) { console.error("[benchprompt] --refresh: server :3000 yanıt vermedi → mevcut veriyle devam."); return false; }
  } catch { console.error("[benchprompt] --refresh: server :3000 kapalı → mevcut veriyle devam (bench-lane'i koş)."); return false; }
  const mjs = join(WT_ROOT, "bin", "host-bridge", "benchmark.mjs");
  if (!existsSync(mjs)) { console.error("[benchprompt] --refresh: benchmark.mjs yok → atla."); return false; }
  try {
    console.error("[benchprompt] --refresh: benchmark.mjs koşuyor (birkaç dk; bench-lane ürünü)...");
    execFileSync("node", [mjs], { stdio: ["ignore", "ignore", "inherit"], timeout: 600_000 });
    return true;
  } catch { console.error("[benchprompt] --refresh: benchmark.mjs hata → mevcut veriyle devam."); return false; }
}

/** Key-canlı ücretsiz API tier: /api/keys/pool (HTTP choke-point — server-import yok).
 *  Server kapalı/hata → [] (bölüm render edilmez; benchprompt asla bloklanmaz). */
async function liveFreeProviders(): Promise<FreeApiProvider[]> {
  try {
    const r = await fetch("http://127.0.0.1:3000/api/keys/pool", { signal: AbortSignal.timeout(2000) }); // nosemgrep: react-insecure-request -- localhost loopback, no transport risk
    if (!r.ok) return [];
    const j: any = await r.json();
    return Object.entries(j?.pool ?? {})
      .filter(([, v]: [string, any]) => (v?.live ?? 0) > 0 && v?.defaultModel)
      .map(([id, v]: [string, any]) => ({
        id, model: String(v.defaultModel),
        caps: Array.isArray(v.capabilities) ? v.capabilities.map(String) : [],
        trainsOnData: !!v.trainsOnData,
      }));
  } catch { return []; }
}

async function main(): Promise<void> {
  const sys: SysInfo = parseSysctl(sysctl("hw.memsize"), sysctl("hw.physicalcpu"), sysctl("machdep.cpu.brand_string"));

  let { records, ts } = loadRecords();
  let stale = isStale(ts, STALE_DAYS);
  if (await maybeRefresh(stale)) ({ records, ts } = loadRecords()), (stale = isStale(ts, STALE_DAYS));

  const aggs: Agg[] = aggregate(records);
  const baseline = baselineFromCalibration(readJson("calibration.json") || {});
  const regs = regressions(aggs, baseline);
  const best = Object.fromEntries(rankEfficient(aggs)); // device → champion

  // Donanım-duyarlı yerel pick (mac kayıtları): selectBest + optimalConfig → localSelection.
  const macAggs = aggs.filter((a) => a.device === "mac");
  let localSelection: LocalSelection | undefined;
  const sel = sys.ramGb > 0 ? selectBest(macAggs, sys.ramGb) : null;
  if (sel) {
    localSelection = {
      model: sel.model, score: sel.score, tokS: sel.tokS, reason: sel.reason,
      config: optimalConfig(sys.ramGb, sys.cores, sel.model),
    };
  }

  const freeProviders = await liveFreeProviders();
  const input: BenchPromptInput = {
    chip: sys.chip, best: best as Record<string, BenchAgg>, aggs: aggs as BenchAgg[],
    regressions: regs as BenchRegression[], routing: DEFAULT_ROUTING, ts, localSelection, stale,
    freeProviders,
  };
  const prompt = buildModelSelectionPrompt(input);

  writeFileSync(join(ORCH_DIR, "MODEL_PROMPT.md"), prompt.endsWith("\n") ? prompt : prompt + "\n");
  // Preserve cross-cutting blocks benchprompt does NOT own: champions.combination
  // (combo-bench correctness policy) and an existing agent-bench selection — otherwise
  // an empty throughput-bench run would clobber a real selection to null and drop the
  // combination policy that /api/pipeline reads. Merge instead of overwrite.
  let prevSel: any = {};
  try { prevSel = JSON.parse(readFileSync(join(ORCH_DIR, "MODEL_SELECTION.json"), "utf8")); } catch { /* first run */ }
  const mergedChampions: Record<string, unknown> = { ...best };
  if (prevSel?.champions?.combination) mergedChampions.combination = prevSel.champions.combination;
  writeFileSync(join(ORCH_DIR, "MODEL_SELECTION.json"), JSON.stringify({
    chip: sys.chip, ramGb: sys.ramGb, cores: sys.cores, ts, stale,
    selection: localSelection ?? prevSel?.selection ?? null,
    champions: mergedChampions, regressions: regs,
    // Key-canlı ücretsiz API tier (0 maliyet; /api/keys/pool anlık görüntüsü). Server kapalıyken
    // koşulduysa boş kalabilir → önceki değeri koru (clobber etme, bench-merge deseniyle aynı).
    freeApiTier: freeProviders.length ? freeProviders : (prevSel?.freeApiTier ?? []),
  }, null, 2) + "\n");

  process.stdout.write(prompt + "\n");
  if (EXPLAIN && localSelection) {
    console.error(`\n[explain] ${sys.chip} ${sys.ramGb}GB → 🏆 ${localSelection.model} ` +
      `(${localSelection.tokS} tok/s, skor ${localSelection.score}); config num_ctx=${localSelection.config.num_ctx}`);
  }
  const pick = localSelection?.model || Object.values(best).map((a) => (a as Agg).model).join(",") || "warm qwen3:8b";
  console.error(`[benchprompt] MODEL_PROMPT.md + MODEL_SELECTION.json · ${aggs.length} model · pick ${pick}${stale ? " · ⚠️ STALE" : ""}`);
}

if (process.argv[1] && /benchprompt\.ts$/.test(process.argv[1])) {
  main().catch((e) => { console.error("[benchprompt] hata:", e?.message ?? e); process.exit(1); });
}
