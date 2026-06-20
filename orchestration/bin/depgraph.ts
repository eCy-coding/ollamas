#!/usr/bin/env tsx
/**
 * orchestration/bin/depgraph.ts — Cross-lane bağımlılık grafiği + API-gap raporu (vO5).
 *
 * READ-ONLY: backend route'ları (server.ts) + frontend çağrıları (src/**) + script tool
 * kayıtlarını regex'le çıkarır, drift hesaplar (MISSING=frontend-call∉backend-route,
 * UNUSED=route never-called), Mermaid graph + backlog üretir → orchestration/DEPGRAPH.md.
 * Gap'i bu sekme FIXLEMEZ — sahibi lane'in sekmesine backlog verir (§3).
 *
 * Çalıştır: tsx orchestration/bin/depgraph.ts [--strict]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverWorktrees, findFile, ANCHOR, type Worktree } from "./shared";
import { extractRoutes, extractCalls, extractRegistrations, gapAnalysis, toMermaid, type Route, type Edge } from "./lib/graph";
import { laneDepMap, detectVersionDrift, toDriftTable, type LaneDeps } from "./lib/drift";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const STRICT = process.argv.includes("--strict");

/** Bounded dosya toplayıcı (read-only): ad-regex eşleşen .ts/.tsx, node_modules/.git/dist atla. */
function collectFiles(root: string, re: RegExp, max = 200, depth = 5): string[] {
  const acc: string[] = [];
  const walk = (dir: string, d: number) => {
    if (d < 0 || acc.length >= max || !existsSync(dir)) return;
    let entries: string[] = [];
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (acc.length >= max) break;
      if (name === "node_modules" || name === ".git" || name === "dist" || name === "test-results") continue;
      const full = join(dir, name);
      let s; try { s = statSync(full); } catch { continue; }
      if (s.isDirectory()) walk(full, d - 1);
      else if (re.test(name)) acc.push(full);
    }
  };
  walk(root, depth);
  return acc;
}

function readAll(files: string[]): string {
  return files.map((f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } }).join("\n");
}

function laneByKey(wts: Worktree[], re: RegExp): Worktree | undefined {
  return wts.find((w) => re.test(w.branch) || re.test(w.path));
}

function main(): void {
  const wts = discoverWorktrees();

  // Backend routes: ana repo server.ts + server/**/*.ts (route tanımları).
  const backendSrc = readAll([
    join(ANCHOR, "server.ts"),
    ...collectFiles(join(ANCHOR, "server"), /\.ts$/, 80),
  ].filter(existsSync));
  const routes: Route[] = extractRoutes(backendSrc);

  // Frontend calls: frontend worktree src/**.
  const fe = laneByKey(wts, /front/i);
  const feSrc = fe ? readAll(collectFiles(join(fe.path, "src"), /\.(ts|tsx)$/, 200)) : "";
  const calls = extractCalls(feSrc);

  // Scripts registrations: scripts worktree register-seam.
  const sc = laneByKey(wts, /scripts/i);
  const scSrc = sc ? readAll([
    ...collectFiles(join(sc.path, "bin"), /\.(ts|mjs|js)$/, 120),
    ...collectFiles(join(sc.path, "scripts"), /\.ts$/, 60),
  ]) : "";
  const regs = extractRegistrations(scSrc);

  const gap = gapAnalysis(routes, calls);
  const edges: Edge[] = [];
  if (fe) edges.push({ from: "frontend", to: "backend", matched: gap.matched.length, missing: gap.missing.length });
  if (sc) edges.push({ from: "scripts", to: "backend(registry)", matched: regs.length, missing: 0 });

  // vO5 ikinci boyut: cross-package version-drift (her lane'in package.json'ı, drift.ts).
  const laneDeps: LaneDeps[] = wts
    .map((w) => { const pj = findFile(w.path, /^package\.json$/, 1); return pj ? { lane: w.branch, deps: laneDepMap(readFileSync(pj, "utf8")) } : null; })
    .filter((x): x is LaneDeps => !!x && Object.keys(x.deps).length > 0);
  const drift = detectVersionDrift(laneDeps);
  const driftedN = drift.filter((d) => d.drifted).length;

  const missTbl = gap.missing.length
    ? ["| Frontend çağrısı | Durum | Backlog |", "|---|---|---|",
       ...gap.missing.map((p) => `| \`${p}\` | ❌ backend route yok | → backend: route ekle VEYA → frontend: çağrıyı kaldır |`)].join("\n")
    : "_MISSING yok — tüm frontend çağrıları backend route'una eşleşti._";
  const unusedTbl = gap.unused.length
    ? gap.unused.map((p) => `- \`${p}\` (hiç çağrılmıyor — dead route olabilir; → backend: doğrula/kaldır)`).join("\n")
    : "_UNUSED yok._";

  const md = [
    `# DEPGRAPH — Cross-Lane Bağımlılık + API Gap`,
    ``,
    `> READ-ONLY \`depgraph.ts\` üretti. Backend route: ${routes.length} · Frontend çağrı: ${calls.length} · Script kayıt: ${regs.length}.`,
    `> Eşleşen: ${gap.matched.length} · **MISSING: ${gap.missing.length}** · UNUSED: ${gap.unused.length}.`,
    ``,
    `## MISSING (frontend → backend gap; yüksek öncelik)`,
    missTbl,
    ``,
    `## UNUSED (çağrılmayan backend route)`,
    unusedTbl,
    ``,
    `## Lane-kontrat grafiği (Mermaid)`,
    "```mermaid",
    toMermaid(edges),
    "```",
    ``,
    `## Cross-Package Version Drift (${driftedN} drifted / ${laneDeps.length} lane)`,
    `> Aynı bağımlılık lane'ler arası farklı versiyona pinli mi (syncpack single-version-policy). Salt-string eşitlik (RISK-ORCH-011).`,
    ``,
    toDriftTable(drift),
    ``,
    `---`,
    `_Gap'leri bu sekme fixlemez — sahibi lane sekmesine backlog (§3)._`,
  ].join("\n");

  console.log(md);
  writeFileSync(join(ORCH_DIR, "DEPGRAPH.md"), md + "\n");
  console.error(`[depgraph] routes=${routes.length} calls=${calls.length} missing=${gap.missing.length} unused=${gap.unused.length}`);
  if (STRICT && gap.missing.length) process.exit(1);
}

if (process.argv[1] && /depgraph\.ts$/.test(process.argv[1])) main();
