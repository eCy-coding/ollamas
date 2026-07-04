#!/usr/bin/env tsx
/**
 * orchestration/bin/dod.ts — Definition-of-Done + Concurrent-Task detector (vO12).
 *
 * READ-ONLY: çalışma alanını deterministik tarar → yarım-iş (test'siz kod), eksik (uncommitted,
 * governance-geride), eş-zamanlı-gereken (yeni tool ⇒ test+roadmap+SEYIR), marker. "Tamamlamadan
 * geçme"yi enforce eder → DOD.md + DOD.json (conduct COMPLETENESS beslemesi). Lane denetlemez (§3).
 *
 * Çalıştır: tsx orchestration/bin/dod.ts [--strict]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditTests, auditUncommitted, auditMarkers, auditConcurrent, auditGovernance, auditRoadmapCoherence, scoreDoD,
  realMarkerCount,
  type Lapse,
} from "./lib/dod";
import { parseVersions } from "./plan-next";
import { loadSuppress, applySuppress, suppressedBlock } from "./lib/suppress";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const BIN = HERE;
const LIB = join(HERE, "lib");
const TESTS = join(ORCH_DIR, "tests");
const STRICT = process.argv.includes("--strict");

function read(p: string): string { try { return readFileSync(p, "utf8"); } catch { return ""; } }
function ls(dir: string, re: RegExp): string[] { try { return readdirSync(dir).filter((f) => re.test(f)); } catch { return []; } }
function countFns(src: string): number { return (src.match(/export\s+function\s+/g) || []).length; }
function git(args: string[]): string { try { return execFileSync("git", ["-C", ORCH_DIR, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }); } catch { return ""; } }

function main(): void {
  const binFiles = ls(BIN, /\.ts$/).filter((f) => !/dod\.ts$/.test(f));
  const libFiles = ls(LIB, /\.ts$/).filter((f) => !/dod\.ts$/.test(f));
  const testText = ls(TESTS, /\.test\.ts$/).map((f) => read(join(TESTS, f))).join("\n");
  const testStems = new Set(ls(TESTS, /\.test\.ts$/).map((f) => f.replace(/\.test\.ts$/, "")));

  // R1: export'lu modüller (lib + bin) test'te geçiyor mu.
  const modules = [
    ...libFiles.map((f) => ({ file: "lib/" + f, fnCount: countFns(read(join(LIB, f))) })),
    ...binFiles.map((f) => ({ file: f, fnCount: countFns(read(join(BIN, f))) })),
  ];
  const lapsesR1 = auditTests(modules, testText);

  // R3: uncommitted.
  const porcelain = git(["status", "--porcelain"]).split("\n").filter(Boolean);
  const lapsesR3 = auditUncommitted(porcelain);

  // R5: markerlar — yalnız gerçek yorum-marker satırları (pattern-string mention'ları FP, vO46 kuralı).
  const markerCounts = [...binFiles, ...libFiles.map((f) => "lib/" + f)].map((rel) => {
    const path = rel.startsWith("lib/") ? join(LIB, rel.slice(4)) : join(BIN, rel);
    return { file: rel, count: realMarkerCount(read(path)) };
  });
  const lapsesR5 = auditMarkers(markerCounts);

  // R2/R4/R6: çekirdek araç stem'leri (CLI bin dosyaları, lib helper hariç).
  const toolStems = binFiles.map((f) => f.replace(/\.ts$/, "")).filter((s) => !/-hook$/.test(s));
  const roadmapText = read(join(ORCH_DIR, "ROADMAP_ORCHESTRATION.md"));
  const seyirText = read(join(ORCH_DIR, "SEYIR_DEFTERI_ORCHESTRATION.md"));
  const doneVersions = parseVersions(roadmapText).filter((v) => v.status === "done").map((v) => v.ver);

  const lapsesR2 = auditRoadmapCoherence(toolStems, roadmapText);
  const lapsesR4 = auditGovernance(doneVersions, seyirText);
  const lapsesR6 = auditConcurrent(toolStems, testStems, roadmapText, seyirText);

  const allLapses: Lapse[] = [...lapsesR1, ...lapsesR3, ...lapsesR4, ...lapsesR6, ...lapsesR2, ...lapsesR5];

  // vO14 detector precision: gerekçeli-istisna (IO-wrapper/data-only) suppress (silent-değil).
  const lapseKind = (l: Lapse) => `dod:${l.rule}:${l.target}`;
  const rules = loadSuppress(join(ORCH_DIR, ".policy-suppress.json"));
  const { suppressed } = applySuppress(allLapses.map((l) => ({ kind: lapseKind(l) })), rules, "dod");
  const suppressedKinds = new Set(suppressed.map((s) => s.kind));
  const lapses = allLapses.filter((l) => !suppressedKinds.has(lapseKind(l))); // GERÇEK lapse'ler
  const score = scoreDoD(lapses);

  const cat = (title: string, rules: string[]) => {
    const g = lapses.filter((l) => rules.includes(l.rule));
    return [`### ${title} (${g.length})`, ...(g.length ? g.map((x) => `- **[${x.severity}]** ${x.target}: ${x.detail}\n  → ${x.action}`) : ["- _temiz_"]), ``];
  };

  const md = [
    `# DOD — Definition-of-Done & Loose-Ends (öz-denetim)`,
    ``,
    `> READ-ONLY \`dod.ts\` üretti. "Yarım bırakma, tamamlamadan geçme" deterministik enforce.`,
    `> **Tamamlanmışlık: ${score}/100** · ${lapses.length} lapse (${binFiles.length} araç, ${libFiles.length} lib).`,
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
  console.error(`[dod] tamamlanmışlık ${score}/100, ${lapses.length} lapse (yarım ${lapsesR1.length}, uncommitted ${lapsesR3.length}, concurrent ${lapsesR6.length}, gov ${lapsesR4.length}, marker ${lapsesR5.length}).`);

  if (STRICT && lapses.some((l) => l.severity === "high")) process.exit(1);
}

main();
