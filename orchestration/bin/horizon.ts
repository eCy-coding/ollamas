#!/usr/bin/env tsx
/**
 * orchestration/bin/horizon.ts — vO12 Roadmap Horizon Auto-Generator CLI (0-manuel, deterministik).
 *
 * Roadmap tükendiğinde lane'in durmaması için: birikmiş sinyalleri (CRITIC.json + panel-report.json +
 * driftguard branch-lane HARD + lane backlog) TÜKET → sıralı vO(N+1..) horizon → ROADMAP_HORIZON.md.
 * Untracked worker dosyalarını import ETMEZ; JSON'ları runtime okur. Yalnız committed plan-next/shared/
 * driftguard'a bağlı. Scope §3: yalnız okur + ROADMAP_HORIZON.md yazar.
 *
 * Çalıştır:  ~/Desktop/ollamas/node_modules/.bin/tsx orchestration/bin/horizon.ts [--json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverWorktrees, findFile } from "./shared";
import { parseVersions, currentAndNext } from "./plan-next";
import { checkBranchLane, laneIdFromPath } from "./lib/driftguard";
import {
  normalizeCritic, normalizePanel, normalizeDrift, normalizeBacklog,
  synthesizeHorizon, buildHorizonReport, type HorizonSignal,
} from "./lib/horizon";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const PLANS_DIR = join(ORCH_DIR, "plans");

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try { return JSON.parse(readFileSync(path, "utf8")) as T; } catch { return fallback; }
}

/** Orchestration ROADMAP'ten en büyük vO majör → sonraki başlangıç numarası. */
function nextStartNum(): number {
  const f = findFile(ORCH_DIR, /^ROADMAP_ORCHESTRATION\.md$/) || findFile(ORCH_DIR, /roadmap.*\.md$/i);
  if (!f) return 12;
  let max = 0;
  for (const v of parseVersions(readFileSync(f, "utf8"))) {
    const m = v.ver.match(/^vO(\d+)/i);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return (max || 11) + 1;
}

function gatherSignals(): HorizonSignal[] {
  const sigs: HorizonSignal[] = [];

  // 1. critic completeness gap'leri (worker CRITIC.json — runtime JSON, import yok).
  const critic = readJson<{ findings?: unknown[] }>(join(ORCH_DIR, "CRITIC.json"), {});
  sigs.push(...normalizeCritic((critic.findings || []) as never));

  // 2. panel open finding'leri.
  const panel = readJson<{ notes?: unknown[] }>(join(PLANS_DIR, "panel-report.json"), {});
  sigs.push(...normalizePanel((panel.notes || []) as never));

  // 3. driftguard branch-lane HARD (cheap; choke-point zaten panel'de) + 4. lane backlog.
  const driftRows: { lane: string; check: string; actual: string; severity: string }[] = [];
  const backlog: { lane: string; next: string }[] = [];
  for (const wt of discoverWorktrees()) {
    const laneId = laneIdFromPath(wt.path);
    const bl = checkBranchLane(wt.path, wt.branch);
    if (bl) driftRows.push({ lane: bl.lane, check: bl.check, actual: bl.actual, severity: bl.severity });
    const rf = findFile(wt.path, /roadmap.*\.md$/i) || findFile(wt.path, /_AGENTS\.md$/i);
    if (rf) {
      const { next } = currentAndNext(parseVersions(readFileSync(rf, "utf8")));
      if (next) backlog.push({ lane: laneId, next: `${next.ver} ${next.title}` });
    }
  }
  sigs.push(...normalizeDrift(driftRows));

  // 5. dispatch-selection gap (vO19): bir makine için variant=null (ölçüm yok / aday gate geçmedi)
  // → o makinede dispatch-bench koşulması gereken bir cli-lane backlog sinyali (normalizeBacklog REUSE).
  const dispatch = readJson<{ machines?: { machine?: string; variant?: string | null }[] }>(
    join(ORCH_DIR, "DISPATCH_SELECTION.json"), {});
  for (const m of dispatch.machines || []) {
    if (m && m.machine && (m.variant === null || m.variant === undefined)) {
      backlog.push({ lane: "cli", next: `dispatch-bench needed for ${m.machine} (variant unselected)` });
    }
  }

  sigs.push(...normalizeBacklog(backlog));
  return sigs;
}

function main(): void {
  const ts = new Date().toISOString();
  const signals = gatherSignals();
  const items = synthesizeHorizon(signals, nextStartNum(), 10);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ts, startNum: nextStartNum(), items }, null, 2));
  } else {
    const md = buildHorizonReport(items, ts);
    console.log(md);
    writeFileSync(join(ORCH_DIR, "ROADMAP_HORIZON.md"), md + "\n");
  }
  console.error(`\n[horizon] ${signals.length} sinyal → ${items.length} versiyon (vO${nextStartNum()}+). ROADMAP_HORIZON.md yazıldı.`);
}

if (process.argv[1] && /horizon\.ts$/.test(process.argv[1])) main();
