#!/usr/bin/env tsx
/**
 * orchestration/bin/fuse.ts — Unified Critical Requirements (vO13).
 *
 * READ-ONLY: tüm analizör çıktılarını (conduct/critic/dod/quality) TEK critical-first
 * REQUIREMENTS görünümüne füzyonlar — dedupe + criticality-rank. Yeni analiz YOK (gereksiz iş yok).
 * "Tüm gereksinimleri + CRITICAL tespit et." Lane denetlemez (§3). conduct.ts edit YOK (standalone).
 *
 * Çalıştır: tsx orchestration/bin/fuse.ts [--strict]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  normalizeFindings, qualityToReqs, dedupe, rankCritical, scoreReadiness, topCritical, critRank, CRITICALITY,
  sourceFresh, staleWarning, normalizeFresh, staleFailLanes, guardStaleConduct,
  type Requirement, type Criticality,
} from "./lib/fuse";
import { parseSysctl, selectBest, optimalConfig, buildWorkingPrompt, type Selection } from "./lib/optimize";
import { normalizeBenchmark, normalizeCliBench, aggregate } from "./lib/bench";
import { homedir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const MC = join(homedir(), ".llm-mission-control");
const STRICT = process.argv.includes("--strict");
const JSON_OUT = process.argv.includes("--json");
const TSX = join(HERE, "..", "..", "..", "ollamas", "node_modules", ".bin", "tsx");

function readJson(p: string): any { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }
function readMcJson(n: string): any { const f = join(MC, n); return existsSync(f) ? readJson(f) : null; }
function sysctl(k: string): string { try { return execFileSync("sysctl", ["-n", k], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return ""; } }

/** conduct.ts --json canlı (findings). */
function conductFindings(): any[] {
  // conduct RED action'da process.exit(1) (gate) yapar → execFileSync throw eder ama stdout
  // GEÇERLİ JSON içerir. Non-zero exit'te stdout'u yakala (vO16: conduct kör-noktası fix).
  let raw = "";
  try {
    raw = execFileSync(TSX, [join(HERE, "conduct.ts"), "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30000 });
  } catch (e: any) {
    raw = typeof e?.stdout === "string" ? e.stdout : "";
  }
  try { return JSON.parse(raw).findings ?? []; } catch { return []; }
}

function optimalPromptFor(action: string): string {
  const sys = parseSysctl(sysctl("hw.memsize"), sysctl("hw.physicalcpu"), sysctl("machdep.cpu.brand_string"));
  const records = [
    ...(readMcJson("benchmark.json") ? normalizeBenchmark(readMcJson("benchmark.json")) : []),
    ...(readMcJson("cli-bench.json") ? normalizeCliBench(readMcJson("cli-bench.json")) : []),
  ].filter((r) => r.device === "mac");
  const aggs = aggregate(records);
  const best = aggs.length ? selectBest(aggs, sys.ramGb) : null;
  if (!best) return `_(bench verisi yok)_\n\n<next-action>\n${action}\n</next-action>`;
  const sel: Selection = { sys, model: best.model, score: best.score, tokS: best.tokS, config: optimalConfig(sys.ramGb, sys.cores, best.model), reason: best.reason };
  return `${buildWorkingPrompt(sel, "choke-point, TDD, evidence-first, no-vibe-code, zero-dep, correctness>hız.")}\n\n<next-action>\n${action}\n</next-action>`;
}

function main(): void {
  // OBSERVE — mevcut analizör çıktıları, TAZELİK-KONTROLLÜ (vO15: phantom-critical önle).
  const now = Date.now();
  const STALE_MIN = Number(process.env.FUSE_STALE_MIN || 60);
  const critic = readJson(join(ORCH_DIR, "CRITIC.json"));
  const dod = readJson(join(ORCH_DIR, "DOD.json"));
  const quality = readJson(join(ORCH_DIR, "QUALITY.json"));
  // conduct CANLI exec → daima taze; AMA conduct bayat-QUALITY'den türev-RED üretebilir →
  // staleFailLanes ile guard (vO16: bayat-türev phantom-CRITICAL önle).
  const staleLanes = staleFailLanes(quality ?? {}, STALE_MIN, now);
  const reqs: Requirement[] = [
    ...guardStaleConduct(normalizeFindings("conduct", conductFindings()), staleLanes),
    ...normalizeFresh("critic", critic?.findings ?? [], critic?.ts, "critic.ts", STALE_MIN, now),
    ...normalizeFresh("dod", dod?.findings ?? [], dod?.ts, "dod.ts", STALE_MIN, now),
    // quality: dosya-ts taze olsa bile qualityToReqs per-lane testTs'i kontrol eder (vO15 kök-fix).
    ...(sourceFresh(quality?.ts, STALE_MIN, now)
      ? qualityToReqs(quality ?? {}, STALE_MIN, now)
      : (quality?.lanes?.length ? [staleWarning("quality", quality?.ts, "quality.ts")] : [])),
  ];

  const fused = rankCritical(dedupe(reqs));
  const readiness = scoreReadiness(fused);
  const top = topCritical(fused);

  // Criticality-bölümlü tam liste.
  const byCrit = (c: Criticality) => fused.filter((r) => r.criticality === c);
  const sections = CRITICALITY.map((c) => {
    const g = byCrit(c);
    return g.length ? [`### ${c} (${g.length})`, ...g.map((r) => `- **${r.target}** [${r.source}]: ${r.detail}\n  → ${r.action}`), ``] : [];
  }).flat();

  const topBlock = top
    ? [`**Criticality:** ${top.criticality} · **Kaynak:** ${top.source}`, ``, `**Gereksinim:** ${top.detail}`, ``, `**Eylem:** ${top.action}`].join("\n")
    : "_Tüm gereksinimler karşılandı — proje hazır._";

  // vO15: kaynak tazelik tablosu (phantom-critical şeffaflığı).
  const freshRow = (name: string, ts: string | undefined) =>
    `| ${name} | ${ts || "—"} | ${sourceFresh(ts, STALE_MIN, now) ? "✓ taze" : "⚠️ BAYAT (füzyon-dışı)"} |`;
  const freshTable = [
    `## Kaynak tazelik (eşik ${STALE_MIN}dk)`,
    `| Kaynak | ts | Durum |`, `|---|---|---|`,
    `| conduct | (canlı exec) | ✓ taze |`,
    freshRow("critic", critic?.ts), freshRow("dod", dod?.ts), freshRow("quality", quality?.ts),
    ``,
  ];

  const md = [
    `# REQUIREMENTS — Birleşik Kritik Gereksinimler (füzyon)`,
    ``,
    `> READ-ONLY \`fuse.ts\`: tüm analizör (conduct/critic/dod/quality) → tek critical-first liste.`,
    `> **Proje hazırlık: ${readiness}/100** · ${fused.length} gereksinim (dedupe edilmiş). Kaynak: yeni analiz yok, mevcut füzyon.`,
    ``,
    `## 🎯 EN KRİTİK GEREKSİNİM`,
    topBlock,
    ``,
    `## Tüm gereksinimler (critical-first)`,
    ...(sections.length ? sections : ["_yok — proje hazır_", ""]),
    ...freshTable,
    `## Optimal working-prompt (en-kritik eyleme)`,
    optimalPromptFor(top?.action ?? "Tüm gereksinimler karşılandı."),
    ``,
    `---`,
    `_fuse füzyon yapar; eylem conduct/lane (§3). REQUIREMENTS.json → conduct beslemesi._`,
  ].join("\n");

  const jsonOut = { ts: new Date().toISOString(), readiness, top, requirements: fused };
  if (JSON_OUT) console.log(JSON.stringify(jsonOut, null, 2));
  else console.log(md);
  writeFileSync(join(ORCH_DIR, "REQUIREMENTS.md"), md + "\n");
  writeFileSync(join(ORCH_DIR, "REQUIREMENTS.json"), JSON.stringify(jsonOut, null, 2) + "\n");
  const crit = byCrit("CRITICAL").length;
  console.error(`[fuse] hazırlık ${readiness}/100, ${fused.length} gereksinim (CRITICAL ${crit}), top=${top ? top.criticality + ":" + top.target : "yok"}.`);

  if (STRICT && crit > 0) process.exit(1);
}

main();
