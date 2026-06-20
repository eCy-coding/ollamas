#!/usr/bin/env tsx
/**
 * orchestration/bin/driftguard.ts — vO8 Drift-Guard CLI: deterministik tutarlılık GATE (0-manuel).
 *
 * Girdisiz koşar → her worktree için branch-lane (hijack) + version-source (single-source-of-truth) +
 * branch-coherence (soft) + choke-point (panel-report.json REUSE, best-effort) → DRIFT.md + stdout +
 * exit-code (HARD>0→1). conduct.ts (worker) GATE olarak çağırabilir. Scope §3: yalnız okur + plans/'a yazar.
 *
 * Çalıştır:  ~/Desktop/ollamas/node_modules/.bin/tsx orchestration/bin/driftguard.ts [--json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverWorktrees, git, findFile } from "./shared";
import {
  checkBranchLane, checkVersionSources, checkBranchCoherence, declaredVersion,
  laneIdFromPath, buildDriftReport, exitCode, type DriftRow,
} from "./lib/driftguard";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const PLANS_DIR = join(ORCH_DIR, "plans");

/** package.json version — placeholder (0.0.x) ise yok say (worktree paylaşımlı kök). */
function pkgVersion(wtPath: string): string | undefined {
  const f = join(wtPath, "package.json");
  if (!existsSync(f)) return undefined;
  try {
    const v = JSON.parse(readFileSync(f, "utf8")).version;
    return typeof v === "string" && !/^0\.0\./.test(v) ? v : undefined;
  } catch { return undefined; }
}

/** En yakın git tag (best-effort; yoksa undefined). */
function latestTag(wtPath: string): string | undefined {
  const t = git(wtPath, ["describe", "--tags", "--abbrev=0"]);
  return t || undefined;
}

/** Panel'in zaten ürettiği choke-point bulgularını REUSE (best-effort, yeni file-walk YOK). */
function chokepointFromPanel(): DriftRow[] {
  const f = join(PLANS_DIR, "panel-report.json");
  if (!existsSync(f)) return [];
  try {
    const j = JSON.parse(readFileSync(f, "utf8"));
    const notes = Array.isArray(j.notes) ? j.notes : [];
    return notes
      .filter((n: Record<string, unknown>) => typeof n.finding === "string" && /choke-point|bypass/i.test(n.finding as string))
      .map((n: Record<string, string>): DriftRow => ({
        lane: n.targetLane || "?", check: "choke-point", source: n.targetPath || "panel",
        declared: "tek choke-point", actual: String(n.finding).slice(0, 80), severity: "hard",
        note: "panel detected (REUSE)",
      }));
  } catch { return []; }
}

function main(): void {
  const rows: DriftRow[] = [];
  for (const wt of discoverWorktrees()) {
    const laneId = laneIdFromPath(wt.path);
    const bl = checkBranchLane(wt.path, wt.branch);
    if (bl) rows.push(bl);

    const roadmapF = findFile(wt.path, /roadmap.*\.md$/i) || findFile(wt.path, /_AGENTS\.md$/i) || findFile(wt.path, /^AGENTS\.md$/);
    const roadmapCurrent = roadmapF ? declaredVersion(readFileSync(roadmapF, "utf8")) : "";
    rows.push(...checkVersionSources({ lane: laneId, roadmapCurrent, versionConst: pkgVersion(wt.path), gitTag: latestTag(wt.path) }));

    const bc = checkBranchCoherence(wt.branch, roadmapCurrent);
    if (bc) { bc.lane = laneId; rows.push(bc); }
  }
  rows.push(...chokepointFromPanel());

  const code = exitCode(rows);
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ rows, exit: code }, null, 2));
  } else {
    const md = buildDriftReport(rows);
    console.log(md);
    writeFileSync(join(PLANS_DIR, "..", "DRIFT.md"), md + "\n");
  }
  const hard = rows.filter((r) => r.severity === "hard").length;
  console.error(`\n[driftguard] ${rows.length} satır (${hard} HARD); exit=${code}.`);
  process.exit(code);
}

if (process.argv[1] && /driftguard\.ts$/.test(process.argv[1])) main();
