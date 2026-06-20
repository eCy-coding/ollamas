#!/usr/bin/env tsx
/**
 * orchestration/bin/backlog.ts — vO15 cross-lane CRITICAL backlog delivery (READ-ONLY).
 *
 * Conductor'ın cross-lane bulgularını (driftguard --json HARD + QUALITY.json RED + panel-report
 * high) TÜKETİR → sahibi lane'e göre yapıştır-hazır fix-prompt → CROSS_BACKLOG.md + stdout.
 * Conductor lane'i FIXLEMEZ (§3) — backlog üretir, sahibi sekme uygular.
 *
 * Çalıştır: tsx orchestration/bin/backlog.ts [<lane>]   (lane verilirse yalnız onun backlog'u)
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { ANCHOR } from "./shared";
import { aggregateBacklog, renderLaneBacklog, renderCrossBacklog } from "./lib/backlog";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const TSX = join(ANCHOR, "node_modules", ".bin", "tsx");
const LANE_ARG = process.argv.slice(2).find((a) => !a.startsWith("-"));

function readJson(p: string): any { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } }

/** driftguard --json spawn (read-only); {rows,exit} döner, hata→{rows:[]}. */
function driftRows(): any {
  try {
    const out = execFileSync(TSX, [join(HERE, "driftguard.ts"), "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, cwd: ORCH_DIR });
    return JSON.parse(out);
  } catch { return { rows: [] }; }
}

function main(): void {
  const quality = readJson(join(ORCH_DIR, "QUALITY.json")) || {};
  const panelRep = readJson(join(ORCH_DIR, "plans", "panel-report.json")) || {};
  const panel = panelRep.findings || panelRep.notes || [];
  const drift = driftRows();

  const map = aggregateBacklog(drift, quality, panel);

  if (LANE_ARG) {
    // Yalnız istenen lane'in yapıştır-hazır prompt'u.
    const out = renderLaneBacklog(LANE_ARG, map[LANE_ARG] || []);
    process.stdout.write(out + "\n");
    console.error(`[backlog] ${LANE_ARG}: ${(map[LANE_ARG] || []).length} critical`);
    return;
  }

  const md = renderCrossBacklog(map);
  writeFileSync(join(ORCH_DIR, "CROSS_BACKLOG.md"), md.endsWith("\n") ? md : md + "\n");
  process.stdout.write(md + "\n");
  const total = Object.values(map).reduce((s, a) => s + a.length, 0);
  console.error(`[backlog] CROSS_BACKLOG.md · ${Object.keys(map).length} lane · ${total} critical · ${Object.entries(map).map(([l, a]) => `${l}:${a.length}`).join(" ")}`);
}

if (process.argv[1] && /backlog\.ts$/.test(process.argv[1])) main();
