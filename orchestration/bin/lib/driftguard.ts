/**
 * orchestration/bin/lib/driftguard.ts — vO8 Drift-Guard: deterministik tutarlılık GATE (0-manuel).
 *
 * Üç eksen (declared ⇒ actual, Terraform-drift diff şekli):
 *   1. branch-lane (HARD)   — worktree path lane-id'si ≟ branch lane-id (ERR-ORCH-004 branch-hijack guard)
 *   2. version-source (HARD) — single-source-of-truth: ROADMAP current ≟ VERSION sabiti ≟ git tag
 *      (release-please/changesets deseni; UK-07/UK-10 sürüm-drift gotcha'sı)
 *   3. choke-point (HARD)   — yasak ikinci-dispatch/raw-fetch (mevcut detectors REUSE, yeni detector YOK)
 *   + branch-coherence (SOFT) — branch sürüm-token'ı ≠ ROADMAP major (feature-branch meşru → uyarı)
 *
 * Pure (test edilebilir); canlı toplama CLI'da. Reuse: plan-next parseVersions/currentAndNext +
 * detectors chokepointBypass/Exec. Zero-dep. Scope §3: yalnız okur. conduct.ts (worker) bunu GATE çağırabilir.
 */
import { parseVersions, currentAndNext } from "../plan-next";
import { chokepointBypass, chokepointBypassExec, type Finding } from "./detectors";

export type DriftSeverity = "hard" | "soft";
export type DriftCheck = "branch-lane" | "version-source" | "choke-point" | "branch-coherence";
export interface DriftRow {
  lane: string;
  check: DriftCheck;
  source: string;     // "branch" | "VERSION" | "git-tag" | "file:line"
  declared: string;   // beklenen (single source of truth)
  actual: string;     // bulunan
  severity: DriftSeverity;
  note?: string;
}

// ── Pure çekirdek ────────────────────────────────────────────────────────────

/** Sürüm string'ini sayısal çekirdeğe indir: vO8→8, vF9→9, v2.4→2.4, v10.0.0→10.0.0. Sayı yoksa "". */
export function normVer(s: string): string {
  const m = s.toLowerCase().match(/v?[a-z]?\.?(\d+(?:\.\d+)*)/);
  return m ? m[1] : "";
}

/** ROADMAP markdown'ından current (son DONE) sürümü (plan-next REUSE). */
export function declaredVersion(roadmapMd: string): string {
  const { current } = currentAndNext(parseVersions(roadmapMd));
  return current?.ver ?? "";
}

/** Worktree path → kanonik lane-id. ollamas-<id>-wt → id; ANCHOR (ollamas) → core. */
export function laneIdFromPath(wtPath: string): string {
  const base = wtPath.replace(/\/+$/, "").split("/").pop() || "";
  if (base === "ollamas") return "core";
  const m = base.match(/^ollamas-(.+)-wt$/);
  return m ? m[1] : base;
}

// Kanonik lane → branch'te beklenen desen (integrations↔gateway alias).
const LANE_BRANCH: Record<string, RegExp> = {
  orchestration: /orchestration/i,
  frontend: /front/i,
  cli: /\bcli\b|cli-/i,
  scripts: /scripts/i,
  tunnel: /tunnel/i,
  integrations: /gateway|integration/i,
  bench: /bench/i,
};

/** branch-lane HARD: worktree lane-id'si branch'te yok → branch-hijack (ERR-ORCH-004). */
export function checkBranchLane(wtPath: string, branch: string): DriftRow | null {
  const laneId = laneIdFromPath(wtPath);
  if (laneId === "core") return null;            // core branch sürüm-adlı (feat/vN) → atla
  const re = LANE_BRANCH[laneId];
  if (!re) return null;                          // bilinmeyen lane → assert etme
  if (re.test(branch)) return null;              // eşleşiyor → temiz
  return {
    lane: laneId, check: "branch-lane", source: "branch",
    declared: `lane:${laneId}`, actual: `branch:${branch}`, severity: "hard",
    note: "branch-hijack — worktree lane-id'si branch'te yok (ERR-ORCH-004/ERR-SCR-001)",
  };
}

/** version-source HARD: mevcut sürüm kaynakları (ROADMAP/VERSION/tag) normVer eşit değilse drift. */
export function checkVersionSources(i: { lane: string; roadmapCurrent: string; versionConst?: string; gitTag?: string }): DriftRow[] {
  // Major bazlı karşılaştır: ROADMAP "v10" ile semver "10.0.0" aynı sürümdür (minor/patch farkı drift değil).
  const major = (raw: string) => normVer(raw).split(".")[0];
  const srcs: { source: string; raw: string; norm: string }[] = [];
  const add = (source: string, raw?: string) => { if (raw) { const n = major(raw); if (n) srcs.push({ source, raw, norm: n }); } };
  add("ROADMAP", i.roadmapCurrent);
  add("VERSION", i.versionConst);
  add("git-tag", i.gitTag);
  if (srcs.length < 2) return [];                 // karşılaştıracak ≥2 kaynak yok
  const truth = srcs[0];                          // ROADMAP = single source of truth
  const out: DriftRow[] = [];
  for (const s of srcs.slice(1)) {
    if (s.norm !== truth.norm) {
      out.push({
        lane: i.lane, check: "version-source", source: s.source,
        declared: `${truth.source}=${truth.raw}`, actual: `${s.source}=${s.raw}`, severity: "hard",
        note: "single-source-of-truth ihlali (sürüm kaynakları uyuşmuyor)",
      });
    }
  }
  return out;
}

/** branch-coherence SOFT: branch sürüm-token'ı ROADMAP current major'dan sapıyorsa uyar (meşru olabilir). */
export function checkBranchCoherence(branch: string, roadmapCurrent: string): DriftRow | null {
  const bt = normVer((branch.split(/[/-]/).find((p) => /v[a-z]?\d/i.test(p)) || ""));
  const rt = normVer(roadmapCurrent);
  if (!bt || !rt || bt === rt) return null;
  return {
    lane: branch, check: "branch-coherence", source: "branch",
    declared: `roadmap:${roadmapCurrent}`, actual: `branch-token:${bt}`, severity: "soft",
    note: "branch sürüm-token'ı ROADMAP'tan farklı (feature-branch için meşru olabilir; UK-07)",
  };
}

function findingToRow(lane: string, f: Finding): DriftRow {
  const ev = f.evidence[0];
  return {
    lane, check: "choke-point",
    source: ev ? `${ev.path}:${ev.lineHint}` : f.targetPath,
    declared: "tek choke-point (apiClient/ToolRegistry.execute)", actual: f.finding,
    severity: "hard", note: "yasak ikinci-dispatch yolu",
  };
}

/** choke-point HARD: mevcut detectors (chokepointBypass + chokepointBypassExec) REUSE. */
export function chokepointIntegrity(lane: string, files: { path: string; content: string }[]): DriftRow[] {
  const out: DriftRow[] = [];
  for (const f of files) {
    for (const finding of [...chokepointBypass(f.path, f.content), ...chokepointBypassExec(f.path, f.content)]) {
      out.push(findingToRow(lane, finding));
    }
  }
  return out;
}

/** hard-drift>0 → 1 (CI/conduct-gate fail); yalnız soft → 0. */
export function exitCode(rows: DriftRow[]): number {
  return rows.some((r) => r.severity === "hard") ? 1 : 0;
}

/** Deterministik markdown rapor (declared ⇒ actual). */
export function buildDriftReport(rows: DriftRow[]): string {
  if (!rows.length) {
    return [`# DRIFT — ollamas Drift-Guard (vO8)`, ``, `✅ drift yok — tüm lane'ler tutarlı (branch-lane + version-source + choke-point).`].join("\n");
  }
  const hard = rows.filter((r) => r.severity === "hard");
  const soft = rows.filter((r) => r.severity === "soft");
  const line = (r: DriftRow) => `- [${r.severity.toUpperCase()}] \`${r.lane}\` ${r.check} · ${r.source}: ${r.declared} ⇒ ${r.actual}${r.note ? `  _(${r.note})_` : ""}`;
  return [
    `# DRIFT — ollamas Drift-Guard (vO8)`,
    ``,
    `> Deterministik GATE (0-manuel). ${hard.length} HARD + ${soft.length} soft. exit=${exitCode(rows)}.`,
    ``,
    `## 🟥 HARD (tutarsızlık — düzeltilmeli)`,
    hard.length ? hard.map(line).join("\n") : "- (yok)",
    ``,
    `## 🟦 SOFT (uyarı — meşru olabilir)`,
    soft.length ? soft.map(line).join("\n") : "- (yok)",
  ].join("\n");
}
