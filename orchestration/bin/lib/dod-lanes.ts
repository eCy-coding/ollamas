/**
 * orchestration/bin/lib/dod-lanes.ts — Lane-aware Definition-of-Done auditor (v1.29.1).
 *
 * `auditLane(cfg)` bir lane'in kaynak/test/governance durumunu deterministik tarar ve R1..R6
 * kurallarını uygular. Pure R-fonksiyonları `./dod`'ta kalır (değişmez); bu modül yalnız IO+glue'yu
 * (dizin okuma, test toplama, git porcelain filtresi, roadmap/seyir okuma) lane-parametrik hale getirir.
 *
 * Kurallar:
 *   R1 auditTests            — HER ZAMAN (allowNoTests ise atlanır)
 *   R3 uncommitted-green     — HER ZAMAN (lane path-prefix'ine göre filtreli)
 *   R5 marker                — HER ZAMAN
 *   R2 roadmap-coherence     — yalnız roadmap set-ise
 *   R4 done-without-gov      — yalnız roadmap+seyir set-ise
 *   R6 concurrent-triad      — yalnız roadmap+seyir set-ise
 *
 * `dod.ts` bu modülü orchestration legacy-cfg ile çağırır → 0-davranış-değişim (backward-compat).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import {
  auditTests, auditMarkers, auditConcurrent, auditGovernance, auditRoadmapCoherence, scoreDoD,
  realMarkerCount, GENERATED_ARTIFACT,
  type Lapse,
} from "./dod";
import { parseVersions } from "../plan-next";

export interface LaneConfig {
  id: string;
  srcDirs: string[];   // absolute source dirs (flat scan, like legacy readdirSync per dir)
  testGlobs: string[]; // absolute globs: "<dir>/*.test.ts" (flat) | "<dir>/**/*.test.ts" (recursive) | "<dir>" (flat)
  roadmap?: string;    // absolute path to roadmap md (enables R2/R4/R6)
  seyir?: string;      // absolute path to seyir md (enables R4/R6)
  allowNoTests?: boolean; // skip R1 (harness lanes with few unit tests, e.g. @ts-check mjs bridges)
}

export interface LaneAudit {
  id: string;
  lapses: Lapse[]; // legacy order: [R1, R3, R4, R6, R2, R5]
  counts: { r1: number; r3: number; r4: number; r6: number; r2: number; r5: number };
  toolFileCount: number; // legacy binFiles.length (top-level tool files)
  libFileCount: number;  // legacy libFiles.length (helper/subdir files)
  score: number;         // scoreDoD over raw lapses (pre-suppress)
}

const baseName = (p: string) => p.replace(/^.*\//, "").replace(/\.test\.ts$/, "").replace(/\.ts$/, "");
const countFns = (src: string): number => (src.match(/export\s+function\s+/g) || []).length;

function read(p: string): string { try { return readFileSync(p, "utf8"); } catch { return ""; } }

/** Flat *.ts source files in `dir` (excludes *.test.ts and dod.ts), like legacy `ls(dir, /\.ts$/)`. */
function listSrc(dir: string): string[] {
  try { return readdirSync(dir).filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !/^dod\.ts$/.test(f)); }
  catch { return []; }
}

function walkTests(dir: string, recursive: boolean, out: string[]): void {
  let entries: import("node:fs").Dirent[];
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "dist") continue;
    const full = join(dir, e.name);
    if (e.isDirectory()) { if (recursive) walkTests(full, recursive, out); }
    else if (e.name.endsWith(".test.ts")) out.push(full);
  }
}

function collectTestFiles(globs: string[]): string[] {
  const out: string[] = [];
  for (const g of globs) {
    if (g.endsWith("/**/*.test.ts")) walkTests(g.slice(0, -"/**/*.test.ts".length), true, out);
    else if (g.endsWith("/*.test.ts")) walkTests(g.slice(0, -"/*.test.ts".length), false, out);
    else walkTests(g, false, out);
  }
  return out;
}

function escapeRe(s: string): string { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

/** R3 lane-scoped: git porcelain → unshipped, filtered to lane path-prefixes. Generated artefacts exempt.
 *  For prefixes=["orchestration"] this is byte-identical to legacy dod.auditUncommitted. */
function auditUncommittedLane(porcelainLines: string[], prefixes: string[]): Lapse[] {
  const files = porcelainLines
    .map((l) => l.trim().replace(/^\S+\s+/, ""))
    .filter((f) =>
      prefixes.some((p) => new RegExp(`${escapeRe(p)}\\/.*\\.(ts|md|json)$`).test(f)) &&
      !/\.(bak|tmp)$/.test(f) &&
      !GENERATED_ARTIFACT.test(f));
  if (!files.length) return [];
  return [{
    rule: "uncommitted-green", severity: "med", target: `${files.length} dosya`,
    detail: `Commit'siz yeşil iş (built-not-shipped): ${files.slice(0, 6).map(baseName).join(", ")}${files.length > 6 ? "…" : ""}`,
    action: `yeşil parçayı commit'le (per-file git add + conventional)`,
  }];
}

/** Lane path-prefixes (repo-relative first segment) derived from srcDirs, for R3 scoping. */
export function lanePrefixes(repoRoot: string, srcDirs: string[]): string[] {
  const set = new Set<string>();
  for (const d of srcDirs) {
    const rel = relative(repoRoot, d).replace(/\\/g, "/");
    const seg = rel.split("/")[0];
    if (seg && seg !== "..") set.add(seg);
  }
  return [...set];
}

/**
 * Bir lane'i denetle. `dod.ts`'ten taşınan R1..R6 gövdesi; orchestration legacy-cfg ile
 * çağrıldığında pre-refactor davranışı birebir korunur.
 */
export function auditLane(cfg: LaneConfig, porcelainLines: string[], repoRoot: string): LaneAudit {
  const base = cfg.srcDirs[0] ?? "";

  // Kaynak dosyaları topla; label = base'e göre relatif (bin/x.ts → "x.ts"; bin/lib/y.ts → "lib/y.ts").
  // "tool" = base seviyesinde (label'da "/" yok); "helper" = alt-dizinde (label'da "/" var).
  type SrcFile = { label: string; stem: string; fnCount: number; markers: number; isTool: boolean };
  const seen = new Set<string>();
  const files: SrcFile[] = [];
  for (const dir of cfg.srcDirs) {
    for (const name of listSrc(dir)) {
      const full = join(dir, name);
      if (seen.has(full)) continue;
      seen.add(full);
      const label = relative(base, full).replace(/\\/g, "/");
      const src = read(full);
      files.push({ label, stem: baseName(label), fnCount: countFns(src), markers: realMarkerCount(src), isTool: !label.includes("/") });
    }
  }
  const tools = files.filter((f) => f.isTool);
  const helpers = files.filter((f) => !f.isTool);

  // Test metni + stem seti.
  const testFiles = collectTestFiles(cfg.testGlobs);
  const testText = testFiles.map((f) => read(f)).join("\n");
  const testStems = new Set(testFiles.map((f) => baseName(f)));

  // R1: export'lu modüller test'te anılıyor mu (helper-then-tool order = legacy lib-then-bin).
  const modules = [...helpers, ...tools].map((f) => ({ file: f.label, fnCount: f.fnCount }));
  const lapsesR1 = cfg.allowNoTests ? [] : auditTests(modules, testText);

  // R3: uncommitted (lane path-prefix'ine göre).
  const prefixes = lanePrefixes(repoRoot, cfg.srcDirs);
  const lapsesR3 = auditUncommittedLane(porcelainLines, prefixes);

  // R5: markerlar (tool-then-helper order = legacy bin-then-lib).
  const markerCounts = [...tools, ...helpers].map((f) => ({ file: f.label, count: f.markers }));
  const lapsesR5 = auditMarkers(markerCounts);

  // R2/R4/R6: tool stem'leri (helper hariç, -hook hariç) + roadmap/seyir bağlamı.
  const toolStems = tools.map((f) => f.stem).filter((s) => !/-hook$/.test(s));
  let lapsesR2: Lapse[] = [], lapsesR4: Lapse[] = [], lapsesR6: Lapse[] = [];
  if (cfg.roadmap) {
    const roadmapText = read(cfg.roadmap);
    lapsesR2 = auditRoadmapCoherence(toolStems, roadmapText);
    if (cfg.seyir) {
      const seyirText = read(cfg.seyir);
      const doneVersions = parseVersions(roadmapText).filter((v) => v.status === "done").map((v) => v.ver);
      lapsesR4 = auditGovernance(doneVersions, seyirText);
      lapsesR6 = auditConcurrent(toolStems, testStems, roadmapText, seyirText);
    }
  }

  const lapses = [...lapsesR1, ...lapsesR3, ...lapsesR4, ...lapsesR6, ...lapsesR2, ...lapsesR5];
  return {
    id: cfg.id,
    lapses,
    counts: { r1: lapsesR1.length, r3: lapsesR3.length, r4: lapsesR4.length, r6: lapsesR6.length, r2: lapsesR2.length, r5: lapsesR5.length },
    toolFileCount: tools.length,
    libFileCount: helpers.length,
    score: scoreDoD(lapses),
  };
}

/** 7-lane registry (orchestration = legacy reference + 6 lane-cfg). Absolute paths from repoRoot. */
export function laneRegistry(repoRoot: string): LaneConfig[] {
  const O = join(repoRoot, "orchestration");
  const rootTests = join(repoRoot, "tests", "*.test.ts");
  return [
    {
      id: "orchestration",
      srcDirs: [join(O, "bin"), join(O, "bin", "lib")],
      testGlobs: [join(O, "tests", "*.test.ts")],
      roadmap: join(O, "ROADMAP_ORCHESTRATION.md"),
      seyir: join(O, "SEYIR_DEFTERI_ORCHESTRATION.md"),
    },
    { id: "server", srcDirs: [join(repoRoot, "server"), join(repoRoot, "server", "lib")], testGlobs: [rootTests] },
    { id: "cli", srcDirs: [join(repoRoot, "cli", "bin"), join(repoRoot, "cli", "lib"), join(repoRoot, "cli", "commands")], testGlobs: [rootTests] },
    { id: "src", srcDirs: [join(repoRoot, "src"), join(repoRoot, "src", "lib")], testGlobs: [join(repoRoot, "tests", "**/*.test.ts")] },
    { id: "contract", srcDirs: [join(repoRoot, "contract", "src"), join(repoRoot, "contract", "scripts")], testGlobs: [join(repoRoot, "contract", "src", "**/*.test.ts")] },
    { id: "tunnel", srcDirs: [join(repoRoot, "tunnel", "src")], testGlobs: [join(repoRoot, "tunnel", "src", "**/*.test.ts")] },
    { id: "bridge", srcDirs: [join(repoRoot, "bin", "host-bridge"), join(repoRoot, "bin", "ios-bridge")], testGlobs: [rootTests], allowNoTests: true },
  ];
}
