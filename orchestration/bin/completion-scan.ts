#!/usr/bin/env tsx
/**
 * orchestration/bin/completion-scan.ts — scan ollamas end-to-end and report what's still needed to complete
 * the project (missing code / folders / languages) with justifications + a task distribution across the
 * fleet streams → COMPLETION_GAPS.md. Evidence only: the census is real (git ls-files + grep + route drift
 * via graph.gapAnalysis). This is the deterministic layer of the council's collective scan.
 *
 * Run:  tsx orchestration/bin/completion-scan.ts [--json]
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { analyzeCompletion, renderCompletionReport, filterProxiedMissing, isRealMarkerLine, type CensusInput } from "./lib/completion";
import { extractRoutes, extractCalls, gapAnalysis } from "./lib/graph";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const REPO = join(ORCH_DIR, "..");
const JSON_OUT = process.argv.includes("--json");

function git(args: string[]): string[] {
  try { return execFileSync("git", args, { cwd: REPO, encoding: "utf8", timeout: 15000 }).split("\n").filter(Boolean); }
  catch { return []; }
}
function nowIso(): string { try { return execFileSync("date", ["-u", "+%Y-%m-%dT%H:%M:%SZ"], { encoding: "utf8" }).trim(); } catch { return "unknown"; } }

/** All tracked files once; everything else is derived from this (single source, deterministic). */
function census(): CensusInput {
  const files = git(["ls-files"]);
  const notVendored = files.filter((f) => !f.startsWith("node_modules/") && !f.startsWith("dist"));

  // language breakdown by extension
  const extCount = new Map<string, number>();
  for (const f of notVendored) { const m = f.match(/\.([A-Za-z0-9]+)$/); if (m) extCount.set(m[1], (extCount.get(m[1]) ?? 0) + 1); }
  const langs = [...extCount.entries()].map(([ext, count]) => ({ ext, count })).sort((a, b) => b.count - a.count);

  // .mjs migration targets by directory
  const mjs = notVendored.filter((f) => f.endsWith(".mjs"));
  const dirCount = new Map<string, number>();
  for (const f of mjs) { const d = f.includes("/") ? f.slice(0, f.lastIndexOf("/")) : "."; dirCount.set(d, (dirCount.get(d) ?? 0) + 1); }
  const mjsByDir = [...dirCount.entries()].map(([dir, count]) => ({ dir, count })).sort((a, b) => b.count - a.count);

  const shCount = notVendored.filter((f) => f.endsWith(".sh")).length;
  const centralTests = notVendored.filter((f) => f.startsWith("tests/") && f.endsWith(".test.ts")).length;
  // in-place migration progress: a .mjs is type-checked when it carries `// @ts-check`, OR it lives under a
  // subsystem whose tsconfig sets `checkJs:true` (scripts/, bin/host-bridge/ — the whole tree is checked).
  const hasCheckJs = (/** @type {string} */ cfg) => { try { return /"checkJs"\s*:\s*true/.test(readFileSync(join(REPO, cfg), "utf8")); } catch { return false; } };
  const scriptsChecked = hasCheckJs("scripts/tsconfig.json");
  const bridgeChecked = hasCheckJs("bin/host-bridge/tsconfig.json");
  const mjsChecked = mjs.filter((f) => {
    if (scriptsChecked && /^scripts\/[^/]+\.mjs$/.test(f)) return true;
    if (bridgeChecked && f.startsWith("bin/host-bridge/")) return true;
    try { return /\/\/\s*@ts-check/.test(readFileSync(join(REPO, f), "utf8").slice(0, 200)); } catch { return false; }
  }).length;

  // stub markers — REAL code comments only (`// TODO`, `# FIXME:`), not the word inside a string/regex.
  // grep -rn (with line text) → keep files that have ≥1 line passing isRealMarkerLine. Exclude the detector
  // files themselves (they legitimately contain the words TODO/FIXME as grep args / marker regexes).
  const DETECTORS = /(completion-scan|completion\.ts|\/dod\.ts|lib\/dod\.ts)/;
  let stubFiles: string[] = [];
  try {
    const lines = execFileSync("grep", ["-rn", "--include=*.ts", "--include=*.mjs", "-E", "TODO|FIXME|HACK|XXX", "server", "cli", "scripts", "orchestration"],
      { cwd: REPO, encoding: "utf8", timeout: 15000 }).split("\n").filter(Boolean);
    const hit = new Set<string>();
    for (const l of lines) {
      const m = l.match(/^([^:]+):\d+:(.*)$/);
      if (!m) continue;
      const [, file, text] = m;
      if (DETECTORS.test(file)) continue;            // detector self-reference — skip
      if (isRealMarkerLine(text)) hit.add(file);
    }
    stubFiles = [...hit].slice(0, 20);
  } catch { stubFiles = []; }

  // sparse top-level folders (few tracked files → suspected stub lane)
  const topCount = new Map<string, number>();
  for (const f of notVendored) { const top = f.includes("/") ? f.slice(0, f.indexOf("/")) : f; topCount.set(top, (topCount.get(top) ?? 0) + 1); }
  const KNOWN_DIRS = new Set(["assets", "backend", "client", "deploy", "ops", "web", "public", "packaging", "tokens", "tokens-light"]);
  const sparseDirs = [...topCount.entries()].filter(([d, n]) => KNOWN_DIRS.has(d) && n <= 5).map(([dir, count]) => ({ dir, count })).sort((a, b) => a.count - b.count);

  // backend ↔ frontend route drift (reuse graph primitives)
  const serverFiles = notVendored.filter((f) => f === "server.ts" || (f.startsWith("server/") && f.endsWith(".ts") && !f.endsWith(".test.ts")));
  const serverSrc = serverFiles.map((f) => { try { return readFileSync(join(REPO, f), "utf8"); } catch { return ""; } });
  const routes = serverSrc.flatMap((s) => extractRoutes(s));
  // proxy/router MOUNTS: `app.use("/api/prefix", …)` — graph.extractRoutes misses these, so their sub-paths
  // must not be flagged missing. Collect the mounted /api prefixes.
  const proxyPrefixes = serverSrc.flatMap((s) => [...s.matchAll(/\bapp\.use\(\s*['"`](\/api\/[^'"`]+)['"`]/g)].map((m) => m[1]));
  const calls = notVendored.filter((f) => (f.startsWith("src/") || f.startsWith("web/") || f.startsWith("client/")) && /\.(ts|tsx|js|jsx)$/.test(f))
    .flatMap((f) => { try { return extractCalls(readFileSync(join(REPO, f), "utf8")); } catch { return []; } });
  const g = gapAnalysis(routes, calls);
  // drop proxy-served calls from "missing" (false positives), then cap the lists (surface count honestly).
  const routeGap = { missing: filterProxiedMissing(g.missing, proxyPrefixes).slice(0, 15), unused: g.unused.slice(0, 15) };

  return { langs, mjsByDir, mjsTotal: mjs.length, shCount, stubFiles, sparseDirs, routeGap, centralTests, mjsChecked };
}

function main(): void {
  if (!existsSync(join(REPO, ".git"))) { console.error("completion-scan: not a git repo (need git ls-files)."); process.exit(2); }
  const c = census();
  const gaps = analyzeCompletion(c);
  const ts = nowIso();

  writeFileSync(join(ORCH_DIR, "COMPLETION_GAPS.md"), renderCompletionReport(gaps, c, ts) + "\n");
  writeFileSync(join(ORCH_DIR, "COMPLETION_GAPS.json"), JSON.stringify({ ts, census: c, gaps }, null, 2) + "\n");

  if (JSON_OUT) { console.log(JSON.stringify({ ts, gaps })); return; }

  const p1 = gaps.filter((g) => g.severity === "P1").length, p2 = gaps.filter((g) => g.severity === "P2").length, p3 = gaps.filter((g) => g.severity === "P3").length;
  console.log(`\nCOMPLETION SCAN — ${gaps.length} gap (${p1} P1 · ${p2} P2 · ${p3} P3):`);
  console.log(`  diller: ${c.langs.slice(0, 5).map((l) => `.${l.ext}:${l.count}`).join("  ")}`);
  console.log(`  .mjs→TS: ${c.mjsTotal} · .sh: ${c.shCount} · route-drift: ${c.routeGap.missing.length} missing/${c.routeGap.unused.length} unused · stub: ${c.stubFiles.length} · sparse-lane: ${c.sparseDirs.length}`);
  for (const g of gaps.slice(0, 8)) console.log(`  [${g.severity}] ${g.title.slice(0, 70)} → ${g.ownerStream}`);
  console.log(`\nRapor: orchestration/COMPLETION_GAPS.md (§A dil · §B eksik-kod · §C klasör · §D dil-göç · §E görev-dağıtım)`);
}

main();
