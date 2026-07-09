#!/usr/bin/env tsx
/**
 * orchestration/bin/dod.ts — Definition-of-Done + Concurrent-Task detector (vO12 → v1.29.1 lane-aware).
 *
 * READ-ONLY: çalışma alanını deterministik tarar → yarım-iş (test'siz kod), eksik (uncommitted,
 * governance-geride), eş-zamanlı-gereken (yeni tool ⇒ test+roadmap+SEYIR), marker. "Tamamlamadan
 * geçme"yi enforce eder → DOD.md + DOD.json (conduct COMPLETENESS beslemesi).
 *
 * R1..R6 gövdesi artık `./lib/dod-lanes.ts::auditLane` içinde (lane-parametrik). Flag'siz `dod.ts`
 * orchestration legacy-cfg ile çağırır → pre-refactor davranışı BİREBİR korunur (backward-compat).
 *
 * Çalıştır:
 *   tsx orchestration/bin/dod.ts [--strict]          → orchestration (legacy, DOD.md/DOD.json)
 *   tsx orchestration/bin/dod.ts --lane <id>         → tek lane skoru
 *   tsx orchestration/bin/dod.ts --all [--strict]    → 7-lane aggregate → DOD_LANES.md/DOD_LANES.json
 */
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreDoD, type Lapse } from "./lib/dod";
import { auditLane, laneRegistry, type LaneConfig, type LaneAudit } from "./lib/dod-lanes";
import { loadSuppress, applySuppress, suppressedBlock } from "./lib/suppress";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO_ROOT = join(ORCH_DIR, "..");
const STRICT = process.argv.includes("--strict");
const laneIdx = process.argv.indexOf("--lane");
const LANE_ARG = laneIdx >= 0 ? process.argv[laneIdx + 1] : undefined;
const ALL = process.argv.includes("--all");

// --strict eşiği: high-lapse veya skor bu değerin altında ise exit1.
const STRICT_SCORE_FLOOR = 50;

function git(args: string[]): string {
  try { return execFileSync("git", ["-C", ORCH_DIR, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); }
  catch { return ""; }
}

function porcelain(): string[] {
  return git(["status", "--porcelain"]).split("\n").filter(Boolean);
}

/** Flag'siz varsayılan: orchestration lane, legacy DOD.md/DOD.json çıktısı (BİREBİR korunur). */
function runLegacy(orchCfg: LaneConfig): void {
  const audit = auditLane(orchCfg, porcelain(), REPO_ROOT);
  const allLapses = audit.lapses;

  // vO14 detector precision: gerekçeli-istisna (IO-wrapper/data-only) suppress (silent-değil).
  const lapseKind = (l: Lapse) => `dod:${l.rule}:${l.target}`;
  const rules = loadSuppress(join(ORCH_DIR, ".policy-suppress.json"));
  const { suppressed } = applySuppress(allLapses.map((l) => ({ kind: lapseKind(l) })), rules, "dod");
  const suppressedKinds = new Set(suppressed.map((s) => s.kind));
  const lapses = allLapses.filter((l) => !suppressedKinds.has(lapseKind(l))); // GERÇEK lapse'ler
  const score = scoreDoD(lapses);

  const cat = (title: string, ruleIds: string[]) => {
    const g = lapses.filter((l) => ruleIds.includes(l.rule));
    return [`### ${title} (${g.length})`, ...(g.length ? g.map((x) => `- **[${x.severity}]** ${x.target}: ${x.detail}\n  → ${x.action}`) : ["- _temiz_"]), ``];
  };

  const md = [
    `# DOD — Definition-of-Done & Loose-Ends (öz-denetim)`,
    ``,
    `> READ-ONLY \`dod.ts\` üretti. "Yarım bırakma, tamamlamadan geçme" deterministik enforce.`,
    `> **Tamamlanmışlık: ${score}/100** · ${lapses.length} lapse (${audit.toolFileCount} araç, ${audit.libFileCount} lib).`,
    ``,
    ...cat("🧩 Yarım iş (test'siz kod)", ["code-without-test"]),
    ...cat("📦 Commit'siz yeşil iş", ["uncommitted-green"]),
    ...cat("🔗 Eş-zamanlı gereken (concurrent)", ["concurrent-task"]),
    ...cat("📋 DONE ama governance eksik", ["done-without-governance"]),
    ...cat("🗺️ Roadmap izlenebilirlik", ["roadmap-coherence"]),
    ...cat("🚧 Marker (TODO/FIXME)", ["marker"]),
    suppressedBlock(suppressed),
    `---`,
    `_dod bulur+raporlar; commit/fix insan/conduct (§3). DOD.json → conduct COMPLETENESS._`,
  ].join("\n");

  console.log(md);
  writeFileSync(join(ORCH_DIR, "DOD.md"), md + "\n");
  writeFileSync(join(ORCH_DIR, "DOD.json"), JSON.stringify({
    ts: new Date().toISOString(), score,
    findings: lapses.map((l) => ({ tier: "COMPLETENESS", lane: "orchestration", kind: `dod:${l.rule}:${l.target}`, detail: l.detail, action: l.action, severity: l.severity === "high" ? 65 : l.severity === "med" ? 40 : 15, concurrent: !!l.concurrent })),
  }, null, 2) + "\n");
  console.error(`[dod] tamamlanmışlık ${score}/100, ${lapses.length} lapse (yarım ${audit.counts.r1}, uncommitted ${audit.counts.r3}, concurrent ${audit.counts.r6}, gov ${audit.counts.r4}, marker ${audit.counts.r5}).`);

  if (STRICT && lapses.some((l) => l.severity === "high")) process.exit(1);
}

/** --lane <id>: tek lane skoru + kısa özet. */
function runLane(id: string): void {
  const cfg = laneRegistry(REPO_ROOT).find((c) => c.id === id);
  if (!cfg) {
    console.error(`[dod] bilinmeyen lane '${id}'. Mevcut: ${laneRegistry(REPO_ROOT).map((c) => c.id).join(", ")}`);
    process.exit(2);
  }
  const a = auditLane(cfg, porcelain(), REPO_ROOT);
  const high = a.lapses.filter((l) => l.severity === "high").length;
  console.log(`# DOD lane: ${a.id}`);
  console.log(`> **${a.score}/100** · ${a.lapses.length} lapse (${a.toolFileCount} tool, ${a.libFileCount} helper) — R1:${a.counts.r1} R3:${a.counts.r3} R5:${a.counts.r5} R2:${a.counts.r2} R4:${a.counts.r4} R6:${a.counts.r6}`);
  for (const l of a.lapses.slice(0, 20)) console.log(`- **[${l.severity}]** ${l.rule} · ${l.target}: ${l.detail}`);
  if (a.lapses.length > 20) console.log(`- … +${a.lapses.length - 20} more`);
  console.error(`[dod] lane ${a.id} skor ${a.score}/100, ${a.lapses.length} lapse (${high} high).`);
  if (STRICT && (high > 0 || a.score < STRICT_SCORE_FLOOR)) process.exit(1);
}

/** --all: tüm lane'leri denetle → aggregate → DOD_LANES.md + DOD_LANES.json. */
function runAll(): void {
  const p = porcelain();
  const audits: LaneAudit[] = laneRegistry(REPO_ROOT).map((cfg) => auditLane(cfg, p, REPO_ROOT));
  const rows = audits.map((a) => {
    const high = a.lapses.filter((l) => l.severity === "high").length;
    return { lane: a.id, score: a.score, lapses: a.lapses.length, high, breach: high > 0 || a.score < STRICT_SCORE_FLOOR };
  });

  const md = [
    `# DOD_LANES — lane-aware Definition-of-Done aggregate`,
    ``,
    `> READ-ONLY. ${audits.length} lane · eşik skor<${STRICT_SCORE_FLOOR} veya high-lapse → --strict exit1.`,
    ``,
    `| lane | score | lapses | high | strict |`,
    `| --- | ---: | ---: | ---: | :---: |`,
    ...rows.map((r) => `| ${r.lane} | ${r.score} | ${r.lapses} | ${r.high} | ${r.breach ? "❌" : "✅"} |`),
    ``,
    `---`,
    `_dod --all bulur+raporlar; commit/fix insan/conduct. DOD_LANES.json → aggregate feed._`,
  ].join("\n");

  console.log(md);
  writeFileSync(join(ORCH_DIR, "DOD_LANES.md"), md + "\n");
  writeFileSync(join(ORCH_DIR, "DOD_LANES.json"), JSON.stringify({
    ts: new Date().toISOString(),
    floor: STRICT_SCORE_FLOOR,
    lanes: audits.map((a) => ({
      lane: a.id, score: a.score, lapses: a.lapses.length,
      high: a.lapses.filter((l) => l.severity === "high").length,
      counts: a.counts, toolFiles: a.toolFileCount, libFiles: a.libFileCount,
    })),
  }, null, 2) + "\n");

  const breached = rows.filter((r) => r.breach);
  console.error(`[dod] --all ${audits.length} lane; breach ${breached.length} (${breached.map((r) => r.lane).join(", ") || "yok"}).`);
  if (STRICT && breached.length) process.exit(1);
}

function main(): void {
  const registry = laneRegistry(REPO_ROOT);
  const orchCfg = registry.find((c) => c.id === "orchestration")!;
  if (ALL) return runAll();
  if (LANE_ARG) return runLane(LANE_ARG);
  return runLegacy(orchCfg);
}

main();
