// Autonomous brain maintenance (Tur 12) — the "sleep-time compute" loop the agent
// never has to call. Implements the four-lever framework on a schedule:
//   decay + eviction  → sweep()      (expired working-tier memories fall off)
//   merge + promote   → consolidate() (dup learned merged; hot episodic → learned)
//   drift detection   → health()     (probe self-recall; report-only, never auto-destroys)
// Run by launchd (com.ollamas.brain-maintain.plist, daily/idle) or `make brain-maintain`.
// Best-effort: a failure warns and exits 0 EXCEPT drift, which exits 3 so a cron can alarm.
// Skip per-shell with BRAIN_MAINTAIN=0. Safety (SSGM): core/learned/procedural are never
// evicted — only episodic/working decay (P4 importance-prune, BRAIN_PRUNE=0 opts out) —
// and merge only collapses byte-identical (normalized) content.
// Order matters: consolidate FIRST (hot episodic promotes to learned = immune), THEN
// sweep prunes whatever stayed cold.
import { createBrainStore } from "../server/brain";
import { resolveEmbedder } from "../server/rag";
import { backupBrain } from "./brain-backup";

export interface MaintainInputs {
  sweep: { swept: number; pruned?: number; factsPruned?: number; embedEvicted?: number };
  consolidate: { promoted: number; merged: number };
  health: { selfHitRate: number; drift: boolean; probes: number };
  /** S25: consistency sentinel violation total (report-only — never alarms). */
  consistency?: { total: number; error?: string };
}

export interface MaintainReport {
  swept: number;
  pruned: number;
  factsPruned: number;
  embedEvicted: number;
  promoted: number;
  merged: number;
  drift: boolean;
  selfHitRate: number;
  consistencyViolations: number;
  action: "noop" | "consolidated" | "re-embed-suggested";
  exitCode: 0 | 3;
}

/** Pure: fold the lever outcomes into one report. Drift dominates the action
 *  and the exit code (cron alarm) regardless of how much housekeeping happened;
 *  consistency violations are surfaced but stay report-only (SSGM). */
export function buildMaintainReport(i: MaintainInputs): MaintainReport {
  const worked =
    i.sweep.swept + (i.sweep.pruned ?? 0) + (i.sweep.factsPruned ?? 0) +
    i.consolidate.promoted + i.consolidate.merged > 0;
  const action = i.health.drift ? "re-embed-suggested" : worked ? "consolidated" : "noop";
  return {
    swept: i.sweep.swept,
    pruned: i.sweep.pruned ?? 0,
    factsPruned: i.sweep.factsPruned ?? 0,
    embedEvicted: i.sweep.embedEvicted ?? 0,
    promoted: i.consolidate.promoted,
    merged: i.consolidate.merged,
    drift: i.health.drift,
    selfHitRate: i.health.selfHitRate,
    consistencyViolations: i.consistency?.total ?? 0,
    action,
    exitCode: i.health.drift ? 3 : 0,
  };
}

async function main() {
  if (process.env.BRAIN_MAINTAIN === "0") return;
  const r = resolveEmbedder();
  const b = createBrainStore({ embed: r.embed, embedProvider: r.providerId });
  try {
    // S29/S36/S41/S38 durable-source bridges + S48 governor ride the same pass,
    // BEFORE consolidate so fresh ops-ns episodics can promote in later nights.
    // BRAIN_BRIDGES=0 opts out; bridge failures are per-source, never fatal.
    if (process.env.BRAIN_BRIDGES !== "0") {
      try {
        const { runMaintainBridges, assessPressure } = await import("../server/brain-bridges");
        const bridges = await runMaintainBridges(b);
        const pressure = assessPressure(b.stats());
        console.log(JSON.stringify({ event: "brain.bridges", ...bridges }));
        if (pressure.suggestions.length > 0) console.log(JSON.stringify({ event: "brain.pressure", ...pressure }));
      } catch (e: any) {
        console.warn(`[brain] bridges skipped (${e?.message ?? e})`);
      }
    }
    const consolidate = b.consolidate(); // promote hot episodic BEFORE prune can see it
    const sweep = b.sweep();
    const health = await b.health();
    // P4: daily verified snapshot rides the same sleep-time pass. Best-effort — a
    // failed backup warns loudly but never blocks the drift alarm path.
    if (process.env.BRAIN_BACKUP !== "0") {
      try {
        console.log(JSON.stringify({ event: "brain.backup", ...backupBrain() }));
      } catch (e: any) {
        console.warn(`[brain] backup FAILED (${e?.message ?? e})`);
      }
    }
    // S2 nightly retrieval-quality watch: the drift probe covers the embedding space,
    // not ranking regressions — a bad retrieval change can keep selfHitRate at 1.0
    // while recall quality craters. The golden-set MRR rides the same nightly pass
    // (throwaway db, live brain untouched); below-floor joins the exit-3 alarm path.
    // BRAIN_MRR_NIGHTLY=0 opts out; an eval failure (embedder hiccup) only warns.
    let mrrBelowFloor = false;
    if (process.env.BRAIN_MRR_NIGHTLY !== "0") {
      try {
        const { runMrrEval } = await import("./brain-eval-mrr");
        const mrr = await runMrrEval();
        console.log(JSON.stringify(mrr));
        mrrBelowFloor = !mrr.pass;
      } catch (e: any) {
        console.warn(`[brain] nightly mrr eval skipped (${e?.message ?? e})`);
      }
    }
    // S25 consistency sentinel — report-only cross-table invariants (fact
    // uniqueness, vec/fts sync). BRAIN_CONSISTENCY=0 opts out; its own failure
    // lands in `error` and never breaks the pass.
    let consistency: { total: number; error?: string } | undefined;
    if (process.env.BRAIN_CONSISTENCY !== "0") {
      try {
        const { checkConsistencyAt } = await import("../server/brain-consistency");
        const dbPath =
          process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;
        const c = checkConsistencyAt(dbPath);
        consistency = { total: c.total, error: c.error };
        if (c.total > 0 || c.error) console.log(JSON.stringify({ event: "brain.consistency", ...c }));
      } catch (e: any) {
        console.warn(`[brain] consistency check skipped (${e?.message ?? e})`);
      }
    }
    // S47 restore drill rides the pass WEEKLY (Monday) — a backup you never
    // restored is a hope. BRAIN_RESTORE_DRILL=1 forces, =0 disables; a failed
    // drill warns loudly but never blocks the alarm path (backup already ran).
    const drillEnv = process.env.BRAIN_RESTORE_DRILL;
    if (drillEnv !== "0" && (drillEnv === "1" || new Date().getDay() === 1)) {
      try {
        const { runRestoreDrill } = await import("./brain-restore-drill");
        const dbPath = process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;
        const drill = await runRestoreDrill(dbPath);
        console.log(JSON.stringify({ event: "brain.restore.drill", ...drill }));
        if (!drill.ok) console.warn("[brain] restore drill FAILED — the DR chain needs attention");
      } catch (e: any) {
        console.warn(`[brain] restore drill skipped (${e?.message ?? e})`);
      }
    }
    const report = buildMaintainReport({ sweep, consolidate, health, consistency });
    console.log(JSON.stringify({
      event: "brain.maintain",
      "gen_ai.operation.name": "memory_maintenance",
      ...report,
    }));
    if (report.drift) {
      console.warn(`[brain] DRIFT — self-hit ${(report.selfHitRate * 100).toFixed(0)}%; re-embed the store to realign.`);
    }
    if (mrrBelowFloor) {
      console.warn("[brain] MRR below floor — retrieval quality regressed; inspect the notTop1 list above.");
    }
    b.close();
    process.exit(mrrBelowFloor && report.exitCode === 0 ? 3 : report.exitCode);
  } catch (e: any) {
    b.close();
    console.warn(`[brain] maintain skipped (${e?.message ?? e})`);
    // Housekeeping failure is not fatal — never block/alarm on an embedder hiccup.
  }
}

if (process.argv[1] && process.argv[1].endsWith("brain-maintain.ts")) {
  main();
}
