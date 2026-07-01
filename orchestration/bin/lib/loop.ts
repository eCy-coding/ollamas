// loop (pure) — end-to-end convergence runner core (IO-free → unit-tested).
//
// The autopilot chain is a SINGLE pass (benchprompt→council→fleet→critic→dod→conduct→fuse→think→
// next→tasklist→status→dispatch→doctor). This is the missing piece: the logic that loops that pass
// until the system CONVERGES and detects convergence honestly (bounded — sustainable ≠ unstoppable).
//
// Convergence = every master-directive acceptance criterion ticked (acceptanceDone == total) AND the
// full-repo gate is clean (no GATE_SKIP) AND the safe-additive next-task queue is drained (nextP1 == 0).
// A stream that can't converge is reported honestly after `maxRounds`; no infinite loop.

export interface LoopState {
  acceptanceDone: number; // ticked master-directive acceptance criteria (from MASTER_TASKLIST.md)
  total: number;          // total acceptance criteria
  gateClean: boolean;     // full-repo gate green with NO GATE_SKIP
  nextP1: number;         // P1 safe-additive items still queued (from FLEET_NEXT.md)
  round: number;          // 1-based round index of the current pass
}

/** Converged = all acceptance ticked, gate clean, and no P1 safe-additive work left. */
export function isConverged(s: LoopState): boolean {
  return s.total > 0 && s.acceptanceDone === s.total && s.gateClean && s.nextP1 === 0;
}

/** Keep looping only while NOT converged AND under the round cap (bounded → never unstoppable). */
export function shouldContinue(s: LoopState, maxRounds: number): boolean {
  return !isConverged(s) && s.round < maxRounds;
}

/** Human-readable one-line summary of a round's state (for E2E_LOOP.md + stdout). */
export function renderRound(s: LoopState): string {
  const acc = `${s.acceptanceDone}/${s.total} acceptance`;
  const gate = s.gateClean ? "gate ✅" : "gate ⚠️ (GATE_SKIP)";
  const p1 = `${s.nextP1} P1 queued`;
  const verdict = isConverged(s) ? "CONVERGED ✅" : "not converged";
  return `round ${s.round}: ${acc} · ${gate} · ${p1} → ${verdict}`;
}

/** Full E2E_LOOP.md report body from the observed rounds + the final state. */
export function renderLoopReport(rounds: LoopState[], maxRounds: number, ts: string): string {
  const last = rounds[rounds.length - 1];
  const converged = last ? isConverged(last) : false;
  const L = [
    `# E2E_LOOP.md — end-to-end convergence loop (auto-generated)`,
    ``,
    `> Auto: \`tsx orchestration/bin/loop.ts\` · ${ts}. Runs the autopilot chain each round, reads`,
    `> MASTER_TASKLIST acceptance + FLEET_NEXT P1, stops on convergence or after ${maxRounds} rounds.`,
    `> Convergence = all acceptance ✅ + gate clean + P1 queue drained. Map: \`.claude/BRAIN.md\`.`,
    ``,
    `## Verdict: ${converged ? "CONVERGED ✅" : `NOT CONVERGED after ${rounds.length} round(s)`}`,
    ``,
    `## Rounds`,
    ...rounds.map((r) => `- ${renderRound(r)}`),
    ``,
  ];
  if (!converged && last) {
    const gaps: string[] = [];
    if (last.acceptanceDone < last.total) gaps.push(`${last.total - last.acceptanceDone} acceptance criteria unticked`);
    if (!last.gateClean) gaps.push(`full-repo gate needs GATE_SKIP (fix the flaky)`);
    if (last.nextP1 > 0) gaps.push(`${last.nextP1} P1 safe-additive items still queued (apply + gate them)`);
    L.push(`## Remaining (honest — no infinite loop)`, ...gaps.map((g) => `- ${g}`), ``);
  }
  return L.join("\n");
}
