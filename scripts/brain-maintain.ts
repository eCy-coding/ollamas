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
  sweep: { swept: number; pruned?: number; embedEvicted?: number };
  consolidate: { promoted: number; merged: number };
  health: { selfHitRate: number; drift: boolean; probes: number };
}

export interface MaintainReport {
  swept: number;
  pruned: number;
  embedEvicted: number;
  promoted: number;
  merged: number;
  drift: boolean;
  selfHitRate: number;
  action: "noop" | "consolidated" | "re-embed-suggested";
  exitCode: 0 | 3;
}

/** Pure: fold the three lever outcomes into one report. Drift dominates the action
 *  and the exit code (cron alarm) regardless of how much housekeeping happened. */
export function buildMaintainReport(i: MaintainInputs): MaintainReport {
  const worked =
    i.sweep.swept + (i.sweep.pruned ?? 0) + i.consolidate.promoted + i.consolidate.merged > 0;
  const action = i.health.drift ? "re-embed-suggested" : worked ? "consolidated" : "noop";
  return {
    swept: i.sweep.swept,
    pruned: i.sweep.pruned ?? 0,
    embedEvicted: i.sweep.embedEvicted ?? 0,
    promoted: i.consolidate.promoted,
    merged: i.consolidate.merged,
    drift: i.health.drift,
    selfHitRate: i.health.selfHitRate,
    action,
    exitCode: i.health.drift ? 3 : 0,
  };
}

async function main() {
  if (process.env.BRAIN_MAINTAIN === "0") return;
  const r = resolveEmbedder();
  const b = createBrainStore({ embed: r.embed, embedProvider: r.providerId });
  try {
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
    const report = buildMaintainReport({ sweep, consolidate, health });
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
