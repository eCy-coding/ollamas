#!/usr/bin/env tsx
/**
 * adopt-gate.ts — vO4 OSS Adoption License-Discipline Gate (CLI).
 *
 * İKİ katman:
 *   (1) MATRİS gate — ADOPTIONS_ORCHESTRATION.md'deki her satırın karar↔lisans uyumu
 *       (adopt.ts parseAdoptionRows + gate REUSE; GPL+ADOPT → İHLAL). Hard fail (exit 1).
 *   (2) GERÇEK-dep audit (--sbom) — her lane'in package.json runtime dep'lerini syft SBOM
 *       lisanslarıyla denetle (sbom.ts); copyleft runtime dep → uyarı (soft).
 *
 * READ-ONLY: yalnız ADOPTIONS + lane package.json okur, syft read-only tarar, tek yazım
 * `orchestration/ADOPT_GATE.md`. Zero-dep: syft opsiyonel (yoksa SBOM atlanır). §3 scope korunur.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseAdoptionRows, gate, type Violation } from "./adopt";
import { discoverWorktrees, findFile } from "./shared";
import { parseSyftSbom, auditLaneDeps, type DepAudit } from "./lib/sbom";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const ADOPTIONS = join(ORCH_DIR, "ADOPTIONS_ORCHESTRATION.md");
const DO_SBOM = process.argv.includes("--sbom");

function sh(file: string, args: string[]): string {
  try { return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20000 }); }
  catch { return ""; }
}

interface LaneAudit { lane: string; path: string; flagged: DepAudit[]; total: number; note: string; }

/** Bir worktree'nin runtime dep'lerini syft SBOM ile denetle (syft yoksa note + boş). */
function auditWorktree(path: string, branch: string, syftOk: boolean): LaneAudit {
  const pkgPath = findFile(path, /^package\.json$/, 1);
  if (!pkgPath) return { lane: branch, path, flagged: [], total: 0, note: "package.json yok" };
  const pkgText = readFileSync(pkgPath, "utf8");
  if (!syftOk) {
    const all = auditLaneDeps(pkgText); // SBOM yok → lisans unknown, flagged=false
    return { lane: branch, path, flagged: [], total: all.length, note: "syft yok → SBOM atlandı" };
  }
  const sbom = parseSyftSbom(sh("syft", [path, "-o", "json", "-q"]));
  const audited = auditLaneDeps(pkgText, sbom);
  return { lane: branch, path, flagged: audited.filter(d => d.flagged), total: audited.length, note: "" };
}

function main(): void {
  // ── Katman 1: ADOPTIONS matris gate ──────────────────────────────────────
  let violations: Violation[] = [];
  if (existsSync(ADOPTIONS)) {
    violations = gate(parseAdoptionRows(readFileSync(ADOPTIONS, "utf8")), "ADOPTIONS_ORCHESTRATION.md");
  }

  // ── Katman 2: gerçek-dep audit (--sbom) ──────────────────────────────────
  const syftOk = DO_SBOM && !!sh("which", ["syft"]).trim();
  const laneAudits: LaneAudit[] = DO_SBOM
    ? discoverWorktrees().map(w => auditWorktree(w.path, w.branch, syftOk))
    : [];

  // ── Rapor ────────────────────────────────────────────────────────────────
  const vioRows = violations.length
    ? violations.map(v => `| ${v.repo} | ${v.license} | ${v.decision} | ${v.reason} |`)
    : ["| _(yok)_ | | | matris temiz |"];
  const depFlagged = laneAudits.flatMap(l => l.flagged.map(d => `| ${l.lane} | ${d.dep}@${d.version} | ${d.license} | ${d.category} |`));
  const md = [
    `# ADOPT_GATE.md — vO4 Lisans-Disiplini Gate`,
    ``,
    `> READ-ONLY. \`tsx orchestration/bin/adopt-gate.ts [--sbom]\`. RISK-ORCH-005 kodlanmış kapı.`,
    ``,
    `## Katman 1 — ADOPTIONS matris (karar↔lisans)`,
    `Durum: ${violations.length ? `❌ ${violations.length} İHLAL` : "✅ temiz"}`,
    ``,
    `| Repo | Lisans | Karar | Sebep |`,
    `|---|---|---|---|`,
    ...vioRows,
    ``,
    `## Katman 2 — gerçek runtime-dep (syft SBOM)`,
    DO_SBOM
      ? (syftOk
          ? `Durum: ${depFlagged.length ? `⚠️ ${depFlagged.length} copyleft runtime dep` : "✅ copyleft runtime dep yok"} (${laneAudits.length} lane tarandı)`
          : `⏭️ syft kurulu değil → SBOM atlandı (\`brew install syft\`). Matris-gate yine de çalıştı.`)
      : `⏭️ atlandı (\`--sbom\` ile çalıştır).`,
    ``,
    ...(depFlagged.length ? [`| Lane | Dep | Lisans | Sınıf |`, `|---|---|---|---|`, ...depFlagged, ``] : []),
    `**Lejant:** Katman1 İHLAL=hard fail (exit 1). Katman2 copyleft runtime dep=uyarı (soft).`,
  ].join("\n");

  console.log(md);
  writeFileSync(join(ORCH_DIR, "ADOPT_GATE.md"), md + "\n");
  console.error(`\n[adopt-gate] matris ${violations.length} ihlal, SBOM ${syftOk ? `${depFlagged.length} flagged` : "skip"}.`);
  process.exit(violations.length ? 1 : 0); // yalnız matris-ihlali hard fail
}

main();
