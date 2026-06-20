#!/usr/bin/env tsx
/**
 * orchestration/bin/autofix.ts — Self-healing remediation (vO11).
 *
 * critic'in GÜVENLİ açıklarını (roadmap status-flip planned→DONE, evidence-backed) deterministik
 * onarır. dry-run DEFAULT (plan göster, yazma); --apply ile atomic+backup+line-anchored yaz.
 * GÜVENLİK: yalnız orchestration/ governance dosyaları + allowlist; kod/lane ASLA (§3+güvenlik).
 *
 * Çalıştır: tsx orchestration/bin/autofix.ts [--apply]
 */
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { planRoadmapFlips, applyFlip, isSafe, diffPreview, type CritGap, type FixOp } from "./lib/autofix";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const APPLY = process.argv.includes("--apply");
const TSX = join(HERE, "..", "..", "..", "ollamas", "node_modules", ".bin", "tsx");

function readJson(p: string): any { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }

/** CRITIC.json yoksa critic.ts koş → üret. */
function loadGaps(): CritGap[] {
  const f = join(ORCH_DIR, "CRITIC.json");
  if (!existsSync(f)) {
    try { execFileSync(TSX, [join(HERE, "critic.ts")], { stdio: "ignore", timeout: 20000 }); } catch { /* */ }
  }
  const j = readJson(f);
  return j?.findings ?? [];
}

/** Atomic + .bak: temp yaz → rename; önce backup. Reversible. */
function atomicWrite(file: string, content: string): void {
  const full = join(ORCH_DIR, file);
  if (existsSync(full)) copyFileSync(full, full + ".bak");
  const tmp = full + ".tmp";
  writeFileSync(tmp, content);
  renameSync(tmp, full);
}

function main(): void {
  const gaps = loadGaps();
  const roadmapFile = "ROADMAP_ORCHESTRATION.md";
  const roadmapPath = join(ORCH_DIR, roadmapFile);
  let roadmapMd = existsSync(roadmapPath) ? readFileSync(roadmapPath, "utf8") : "";

  const ops: FixOp[] = planRoadmapFlips(gaps, roadmapMd, roadmapFile).filter(isSafe);

  const header = [
    `# AUTOFIX — Self-Healing Remediation (${APPLY ? "APPLY" : "dry-run"})`,
    ``,
    `> critic gap'lerinden GÜVENLİ deterministik onarım. dry-run default; --apply ile yazar.`,
    `> Allowlist: roadmap status-flip. Kod/lane ASLA. ${gaps.length} gap, ${ops.length} güvenli fix.`,
    ``,
    `## Plan`,
    diffPreview(ops),
    ``,
  ];

  if (!APPLY) {
    header.push(`_dry-run: hiçbir dosya yazılmadı. Uygulamak için \`--apply\`._`);
    const md = header.join("\n");
    console.log(md);
    atomicWriteSafe("AUTOFIX.md", md + "\n");
    console.error(`[autofix] dry-run: ${ops.length} güvenli fix planlandı (yazılmadı).`);
    return;
  }

  // --apply: yalnız güvenli op'lar, atomic+backup, line-anchored.
  let applied = 0;
  for (const op of ops) {
    if (op.file !== roadmapFile) continue; // şu an sadece roadmap flip
    const res = applyFlip(roadmapMd, op.target);
    if (res.changed) { roadmapMd = res.md; applied++; }
  }
  if (applied) atomicWrite(roadmapFile, roadmapMd);

  // Verify: critic yeniden koş → drift düştü mü.
  let reScore = "?";
  try {
    execFileSync(TSX, [join(HERE, "critic.ts")], { stdio: "ignore", timeout: 20000 });
    const j = readJson(join(ORCH_DIR, "CRITIC.json"));
    reScore = j ? `${j.score}/100 (${j.findings.filter((f: any) => /roadmap-drift/.test(f.kind)).length} drift kaldı)` : "?";
  } catch { /* */ }

  header.push(`## Uygulandı`, `- ${applied} roadmap status-flip (atomic + .bak)`, `- Re-critic: ${reScore}`, ``, `_Idempotent: tekrar \`--apply\` → 0 op._`);
  const md = header.join("\n");
  console.log(md);
  atomicWriteSafe("AUTOFIX.md", md + "\n");
  console.error(`[autofix] --apply: ${applied} fix uygulandı, re-critic ${reScore}.`);
}

/** AUTOFIX.md kendi yazımı (backup'sız, üretilen rapor). */
function atomicWriteSafe(file: string, content: string): void {
  const full = join(ORCH_DIR, file);
  const tmp = full + ".tmp";
  writeFileSync(tmp, content);
  renameSync(tmp, full);
}

main();
