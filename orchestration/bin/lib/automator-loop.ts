// automator-loop (pure) — convergence-loop core for the daily-automation probe (IO-free → unit-tested).
//
// vO36 runs the daily probe ONCE. This is the "loop hesapla planla kodla" piece: each round it COMPUTES
// which models have NOT yet produced a recurring automation (hesapla), the CLI PLANS a retry-set with a
// bigger step budget (planla) and re-dispatches only those models to CODE the missing artifact (kodla).
// The loop stops when every model is recurring (converged), or is BOUNDED by a round cap + a dry-round
// cap (a round that adds no new recurring model → stop pushing models that can't). sustainable ≠ unstoppable.

import { renderDailyProbe, type DailyRow } from "./automator-probe";

/** Models that have NOT produced a recurring automation yet (nothing / one-off / failed) — the retry set. */
export function pendingModels(rows: DailyRow[]): string[] {
  return rows.filter((r) => !r.scheduled).map((r) => r.model);
}

/** Merge a round's fresh rows into the accumulated rows by model (a re-dispatched model's row replaces its
 *  previous one). Models not in the round keep their existing row — a recurring win is never lost. */
export function applyRound(rows: DailyRow[], roundRows: DailyRow[]): DailyRow[] {
  const byModel = new Map(roundRows.map((r) => [r.model, r]));
  return rows.map((r) => byModel.get(r.model) ?? r);
}

/** Converged = no models left pending (every model produced a recurring automation). */
export function isLoopConverged(rows: DailyRow[]): boolean {
  return rows.length > 0 && pendingModels(rows).length === 0;
}

/** Keep looping only while models are pending, under the round cap, and not stalled (dryRounds < maxDry).
 *  A "dry" round produced no NEW recurring model → the remainder likely can't, so stop (bounded). */
export function shouldContinueLoop(
  round: number, maxRounds: number, pendingCount: number, dryRounds: number, maxDry: number,
): boolean {
  return pendingCount > 0 && round < maxRounds && dryRounds < maxDry;
}

export interface AutomatorLoopRound {
  round: number;
  targets: number;       // models dispatched this round (all in r1, pending-only after)
  steps: number;         // step budget used this round
  recurring: number;     // total recurring models after this round
  newRecurring: number;  // models that BECAME recurring this round
  pending: number;       // models still pending after this round
}

/** Full AUTOMATOR_LOOP.md body: convergence verdict + per-round hesapla/planla/kodla + final matrix + honest gaps. */
export function renderAutomatorLoop(rounds: AutomatorLoopRound[], finalRows: DailyRow[], maxRounds: number, ts: string): string {
  const converged = isLoopConverged(finalRows);
  const pend = pendingModels(finalRows);
  const recurring = finalRows.filter((r) => r.scheduled);
  const L = [
    `# AUTOMATOR_LOOP.md — daily-automation convergence loop (auto-generated)`,
    ``,
    `> Auto: \`tsx orchestration/bin/automator-probe.ts --loop\` · ${ts}. Each round COMPUTES the pending`,
    `> (non-recurring) models, PLANS a retry-set with a bigger step budget, and re-dispatches only those to`,
    `> CODE the missing daily automation. Stops on convergence or after ${maxRounds} rounds / a dry round`,
    `> (bounded — sustainable ≠ unstoppable). "Recurring" = a real launchd/cron/Calendar schedule.`,
    ``,
    `## Verdict: ${converged ? "CONVERGED ✅ (every model recurring)" : `NOT CONVERGED after ${rounds.length} round(s)`} — ${recurring.length}/${finalRows.length} recurring`,
    ``,
    `## Rounds (hesapla → planla → kodla)`,
    ...rounds.map((r) =>
      `- round ${r.round}: dispatched ${r.targets} (steps ${r.steps}) → +${r.newRecurring} new recurring · ${r.recurring}/${finalRows.length} total · ${r.pending} pending`
    ),
    ``,
  ];
  if (!converged && pend.length) {
    L.push(
      `## Remaining (honest — no infinite loop)`,
      `- ${pend.length} model(s) never produced a recurring automation within ${maxRounds} rounds: ${pend.map((m) => `\`${m}\``).join(", ")}`,
      ``,
    );
  }
  L.push(`## Final per-model state`, ``, renderDailyProbe(finalRows, ts));
  return L.join("\n");
}
