#!/usr/bin/env tsx
/**
 * orchestration/bin/dispatchsim.ts — vO20 Dispatch flow simulator CLI (deterministic, zero live machine).
 *
 * Runs a canonical Hybrid scenario (mac + desktop-ert7724; desktop dies mid-run → mac substrate failover →
 * failback) through `simulateDispatch` and writes `DISPATCH_SIM.md` — the proven flow trace = cli lane's
 * executable spec / compliance oracle. NOT a perf bench (no tok/s fabrication, no dispatch-bench.json seed).
 *
 * Çalıştır:  ~/Desktop/ollamas/node_modules/.bin/tsx orchestration/bin/dispatchsim.ts [--json]
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { simulateDispatch, renderSimReport, type SimTask, type HealthEvent } from "./lib/dispatchsim";
import type { FleetWorker } from "./lib/dispatchbench";

const HERE = dirname(fileURLToPath(import.meta.url));
const ORCH_DIR = join(HERE, "..");

const SCENARIO = "mac + desktop-ert7724; t1 host-tool→mac, t2 codegen→desktop (desktop down @tick3 → mac substrate failover), t3 analysis, t5 codegen post-failback→desktop";

const WORKERS: FleetWorker[] = [
  { name: "mac", kind: "mac", healthy: true, tokS: 20 },
  { name: "desktop-ert7724", kind: "remote", healthy: true, tokS: 40 },
];

// desktop dies at tick 3 (mid t2), recovers at tick 100 (failback for a later task).
const TIMELINE: HealthEvent[] = [
  { tick: 3, worker: "desktop-ert7724", healthy: false },
  { tick: 100, worker: "desktop-ert7724", healthy: true },
];

const EPIC: SimTask[] = [
  { id: "t1", kind: "host-tool", durationTicks: 2 },
  { id: "t2", kind: "codegen", durationTicks: 3 },
  { id: "t3", kind: "analysis", durationTicks: 2 },
  { id: "t4", kind: "host-tool", durationTicks: 95 }, // pushes clock past failback @100
  { id: "t5", kind: "codegen", durationTicks: 2 },     // starts post-failback → back on desktop
];

function main(): void {
  const result = simulateDispatch(EPIC, WORKERS, TIMELINE);

  if (process.argv.includes("--json")) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const md = renderSimReport(result, SCENARIO);
  writeFileSync(join(ORCH_DIR, "DISPATCH_SIM.md"), md.endsWith("\n") ? md : md + "\n");
  process.stdout.write(md + "\n");
  console.error(`[dispatchsim] DISPATCH_SIM.md · ${EPIC.length} task · ${result.failovers.length} failover · VERDICT ${result.epicReport.verdict}`);
}

if (process.argv[1] && /dispatchsim\.ts$/.test(process.argv[1])) {
  try { main(); } catch (e) { console.error("[dispatchsim] hata:", (e as Error)?.message ?? e); process.exit(1); }
}
