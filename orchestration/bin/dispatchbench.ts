#!/usr/bin/env tsx
/**
 * orchestration/bin/dispatchbench.ts — vO18 Distributed-Dispatch research→test→update harness (0-manuel).
 *
 * READ-ONLY conductor: tüket `~/.llm-mission-control/dispatch-bench.json` (candidate working-principle
 * varyant × makine, gerçek SSE dispatch ölçümleri) → aggregateDispatch → selectAllMachines (ordered gate:
 * correct → adım/dup → latency → tok/s) → buildDispatchPrompt → `DISPATCH_PROMPT.md` + `DISPATCH_SELECTION.json`.
 * Veri yoksa ASLA throw: önceki seçimi korur + STALE/no-data uyarısı (benchprompt deseni). Ağır gerçek-dispatch
 * = cli/scripts lane işi (orchestration koşmaz, §3). Scope §3: yalnız orchestration/ yazar.
 *
 * Çalıştır:  ~/Desktop/ollamas/node_modules/.bin/tsx orchestration/bin/dispatchbench.ts [--json]
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { isStale } from "./lib/bench";
import {
  parseDispatchRecords, aggregateDispatch, selectAllMachines, buildDispatchPrompt,
  type MachineSelection,
} from "./lib/dispatchbench";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");
const MC = join(homedir(), ".llm-mission-control");
const STALE_DAYS = Number(process.env.OPTIMIZE_STALE_DAYS || 2);

function readJson(path: string): unknown {
  if (!existsSync(path)) return null;
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; }
}

function main(): void {
  const data = readJson(join(MC, "dispatch-bench.json")) as { ts?: string; records?: unknown[] } | unknown[] | null;
  const records = parseDispatchRecords(data);
  const dataTs = (data && !Array.isArray(data) && typeof data.ts === "string") ? data.ts : (records[0]?.ts ?? "no-dispatch-bench");
  const noData = records.length === 0;
  const stale = noData || isStale(dataTs, STALE_DAYS);

  const aggs = aggregateDispatch(records);
  let machines = selectAllMachines(aggs);

  // Preserve a prior real selection when this run has no fresh data (benchprompt merge-guard parity):
  // an empty bench must not clobber a previously-measured variant choice to null.
  if (noData) {
    const prev = readJson(join(ORCH_DIR, "DISPATCH_SELECTION.json")) as { machines?: MachineSelection[] } | null;
    if (prev?.machines?.length) {
      const byMachine = new Map(prev.machines.map((m) => [m.machine, m]));
      machines = machines.map((m) => (m.variant === null && byMachine.get(m.machine)?.variant) ? byMachine.get(m.machine)! : m);
    }
  }

  const prompt = buildDispatchPrompt({ ts: dataTs, stale, machines });
  const selection = { ts: dataTs, stale, machines, gate: 0.7 };

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(selection, null, 2));
    return;
  }

  writeFileSync(join(ORCH_DIR, "DISPATCH_PROMPT.md"), prompt.endsWith("\n") ? prompt : prompt + "\n");
  writeFileSync(join(ORCH_DIR, "DISPATCH_SELECTION.json"), JSON.stringify(selection, null, 2) + "\n");

  process.stdout.write(prompt + "\n");
  const picks = machines.map((m) => `${m.machine}:${m.variant ?? "—"}`).join(" · ");
  console.error(`[dispatchbench] DISPATCH_PROMPT.md + DISPATCH_SELECTION.json · ${records.length} ölçüm · ${picks}${stale ? " · ⚠️ STALE/no-data" : ""}`);
}

if (process.argv[1] && /dispatchbench\.ts$/.test(process.argv[1])) {
  try { main(); } catch (e) { console.error("[dispatchbench] hata:", (e as Error)?.message ?? e); process.exit(1); }
}
