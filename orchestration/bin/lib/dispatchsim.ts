/**
 * orchestration/bin/lib/dispatchsim.ts — vO20 Dispatch flow SIMULATOR (pure, zero-IO, deterministic).
 *
 * Proves the Hybrid distributed-dispatch protocol (split→assign→claim→heartbeat→failover→merge) CORRECT
 * over a VIRTUAL CLOCK — no live machines, no Date.now. Doubles as the cli lane's executable spec / test
 * oracle (spec-to-code-compliance): the cli implementation must reproduce these assignments + failovers.
 *
 * NOT a perf benchmark: validates FLOW LOGIC only (routing + failover + merge). Does NOT fabricate tok/s
 * nor seed dispatch-bench.json — the variant=null gap stays honest until real cli/live runs (evidence-law).
 *
 * REUSE: assignWorker + DispatchTask/FleetWorker/TaskKind/Assignment from ./dispatchbench (fleet.ts:30 pattern).
 * Ledger model mirrors claims.ts:65/76/81 (fold last-status per key + TTL stale→takeover), keyed on taskId.
 */
import { assignWorker, type DispatchTask, type FleetWorker, type TaskKind } from "./dispatchbench";

// ── Types ──────────────────────────────────────────────────────────────────────

/** A task plus how many virtual ticks it needs to finish on a worker. */
export interface SimTask extends DispatchTask { durationTicks: number; }

/** A worker health change at a virtual tick (the timeline that drives failover/failback). */
export interface HealthEvent { tick: number; worker: string; healthy: boolean; }

export type SimStatus = "claimed" | "failed" | "done" | "blocked";
export interface SimEvent { tick: number; taskId: string; worker: string | null; status: SimStatus; reason: string; }
export interface Failover { taskId: string; fromWorker: string; toWorker: string | null; atTick: number; }
export interface TaskOutcome {
  taskId: string; kind: TaskKind; finalWorker: string | null;
  status: "done" | "failed" | "blocked"; failedOver: boolean;
}
export interface SimResult {
  assignments: { taskId: string; worker: string | null; reason: string }[];
  events: SimEvent[];
  failovers: Failover[];
  epicReport: { tasks: TaskOutcome[]; allOk: boolean; verdict: "DONE" | "INCOMPLETE" };
}

// ── Pure helpers ────────────────────────────────────────────────────────────────

/** Worker health AS OF `tick`: apply the latest timeline event per worker with event.tick ≤ tick. */
export function healthAt(workers: FleetWorker[], timeline: HealthEvent[], tick: number): FleetWorker[] {
  return workers.map((w) => {
    const evs = timeline.filter((e) => e.worker === w.name && e.tick <= tick).sort((a, b) => a.tick - b.tick);
    const last = evs[evs.length - 1];
    return last ? { ...w, healthy: last.healthy } : w;
  });
}

/** First tick in (start, end] where `worker` goes unhealthy (the heartbeat-miss point), else null. */
export function firstFailTick(timeline: HealthEvent[], worker: string, start: number, end: number): number | null {
  const evs = timeline
    .filter((e) => e.worker === worker && e.tick > start && e.tick <= end && !e.healthy)
    .sort((a, b) => a.tick - b.tick);
  return evs.length ? evs[0].tick : null;
}

// ── Simulator ────────────────────────────────────────────────────────────────────

/**
 * Drive the full Hybrid flow deterministically. Tasks run sequentially on a virtual clock (deterministic
 * ordering); within a task, a mid-run worker failure triggers re-assign (assignWorker now sees it unhealthy
 * → mac substrate) = the failover. Re-tries until a worker completes it or none is eligible (→ blocked).
 */
export function simulateDispatch(
  epic: SimTask[], workers: FleetWorker[], timeline: HealthEvent[], opts?: { maxHops?: number },
): SimResult {
  const maxHops = opts?.maxHops ?? workers.length + 1;
  const assignments: SimResult["assignments"] = [];
  const events: SimEvent[] = [];
  const failovers: Failover[] = [];
  const outcomes: TaskOutcome[] = [];

  let clock = 0;
  for (const task of epic) {
    let startTick = clock;
    let failedOver = false;
    let current: string | null = null;
    let firstAssignmentRecorded = false;
    let settled = false;

    for (let hop = 0; hop < maxHops && !settled; hop++) {
      const avail = healthAt(workers, timeline, startTick);
      const a = assignWorker(task, avail, { current: undefined });
      const worker = a.worker;

      if (!firstAssignmentRecorded) {
        assignments.push({ taskId: task.id, worker, reason: a.reason });
        firstAssignmentRecorded = true;
      }

      if (worker === null) {
        events.push({ tick: startTick, taskId: task.id, worker: null, status: "blocked", reason: a.reason });
        outcomes.push({ taskId: task.id, kind: task.kind, finalWorker: null, status: "blocked", failedOver });
        settled = true;
        break;
      }

      events.push({ tick: startTick, taskId: task.id, worker, status: "claimed", reason: a.reason });
      const endTick = startTick + task.durationTicks;
      const failTick = firstFailTick(timeline, worker, startTick, endTick);

      if (failTick === null) {
        // Worker stayed healthy through the run → done.
        events.push({ tick: endTick, taskId: task.id, worker, status: "done", reason: "completed" });
        outcomes.push({ taskId: task.id, kind: task.kind, finalWorker: worker, status: "done", failedOver });
        clock = endTick;
        settled = true;
      } else {
        // Worker died mid-run → failed → failover (re-assign from failTick).
        events.push({ tick: failTick, taskId: task.id, worker, status: "failed", reason: "worker unhealthy mid-run (heartbeat miss)" });
        const next = assignWorker(task, healthAt(workers, timeline, failTick), { current: undefined });
        failovers.push({ taskId: task.id, fromWorker: worker, toWorker: next.worker, atTick: failTick });
        failedOver = true;
        current = next.worker;
        startTick = failTick;
        // loop continues: re-claim on the substrate worker (or blocked if none).
      }
    }

    if (!settled) {
      // Exhausted hops without completing → blocked (defensive; deterministic).
      events.push({ tick: startTick, taskId: task.id, worker: current, status: "blocked", reason: "max failover hops exhausted" });
      outcomes.push({ taskId: task.id, kind: task.kind, finalWorker: current, status: "blocked", failedOver });
    }
  }

  const allOk = outcomes.length === epic.length && outcomes.every((o) => o.status === "done");
  return { assignments, events, failovers, epicReport: { tasks: outcomes, allOk, verdict: allOk ? "DONE" : "INCOMPLETE" } };
}

// ── Report renderer (deterministic markdown) ─────────────────────────────────────

/** Render the simulated flow trace as markdown (the cli lane's golden trace / compliance oracle). */
export function renderSimReport(result: SimResult, scenario: string): string {
  const L: string[] = [];
  L.push(`# DISPATCH_SIM — Hybrid dispatch flow trace (vO20)`);
  L.push(``);
  L.push(`> ⚠️ **Simulated flow-LOGIC proof, NOT a live perf measurement.** \`dispatchsim.ts\` üretti —`);
  L.push(`> saf, deterministik (sanal saat, Date.now YOK). tok/s UYDURULMAZ; \`dispatch-bench.json\` SEED edilmez.`);
  L.push(`> Bu = cli lane'in **executable spec / compliance oracle**'ı: cli implementasyonu bu izi üretmeli.`);
  L.push(``);
  L.push(`**Senaryo:** ${scenario}`);
  L.push(``);
  L.push(`## Atamalar (assignWorker, ilk hop)`);
  L.push(`| Task | Worker | Gerekçe |`);
  L.push(`|------|--------|---------|`);
  for (const a of result.assignments) L.push(`| ${a.taskId} | ${a.worker ?? "—"} | ${a.reason} |`);
  L.push(``);
  L.push(`## Ledger event akışı (sanal tick)`);
  L.push(`| tick | task | worker | status | not |`);
  L.push(`|-----:|------|--------|--------|-----|`);
  for (const e of result.events) L.push(`| ${e.tick} | ${e.taskId} | ${e.worker ?? "—"} | ${e.status} | ${e.reason} |`);
  L.push(``);
  if (result.failovers.length) {
    L.push(`## Failover (worker down → substrate re-route)`);
    for (const f of result.failovers) L.push(`- \`${f.taskId}\`: ${f.fromWorker} → ${f.toWorker ?? "—"} @ tick ${f.atTick}`);
    L.push(``);
  }
  L.push(`## Epic verdict`);
  for (const o of result.epicReport.tasks) {
    L.push(`- \`${o.taskId}\` (${o.kind}) → ${o.finalWorker ?? "—"} · **${o.status}**${o.failedOver ? " (failed-over)" : ""}`);
  }
  L.push(``);
  L.push(`**allOk=${result.epicReport.allOk} · VERDICT: ${result.epicReport.verdict}**`);
  return L.join("\n");
}
