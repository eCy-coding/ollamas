// fleet-run (pure) — the systematic end-to-end fleet driver core (IO-free → unit-tested).
//
// The fleet has all the pieces (launch --sequenced, persistent workers that read the repo and self-gate,
// conduct that snapshots + gates + re-dispatches), but no ONE command runs them to convergence with a
// preflight and a WHOLE-FLEET bounded round cap. This is that logic: preflight verdict, per-round
// convergence, a bounded "keep conducting" decision, and the final systematic report. The CLI wires the IO
// (fetch health, spawn fleet-launch / fleet-conduct). This module is the automated "lieutenant": it turns
// the conductor's directive (run the fleet) into rounds and reports back — it holds no authority of its own.

export interface PreflightInput { bridgeOk: boolean; serverOk: boolean; workspaceOk: boolean }
export interface Preflight { ready: boolean; issues: string[] }

/** Preflight verdict: the fleet can run only when the bridge + server are up and the workspace is the repo. */
export function preflight(i: PreflightInput): Preflight {
  const issues: string[] = [];
  if (!i.bridgeOk) issues.push("host bridge unreachable (:7345) — start it: bash bin/host-bridge/start-bridge.sh");
  if (!i.serverOk) issues.push("ollamas server unreachable (:3000) — start it: npm run dev / make up");
  if (!i.workspaceOk) issues.push("agent workspace is not the repo — will be set via POST /api/workspace/select");
  // workspace is auto-fixable, so it doesn't block readiness; bridge + server do.
  return { ready: i.bridgeOk && i.serverOk, issues };
}

export interface RunRound { round: number; done: number; total: number; redispatched: number; converged: boolean }

/** Converged = every stream has a gated proposal (done === total, total > 0). */
export function isRunConverged(done: number, total: number): boolean {
  return total > 0 && done === total;
}

/** Keep conducting only while NOT converged AND under the whole-fleet round cap (bounded — never infinite). */
export function shouldContinueRun(round: number, maxRounds: number, converged: boolean): boolean {
  return !converged && round < maxRounds;
}

export interface StreamState { stream: string; done: boolean }

/** Full FLEET_RUN.md report: the systematic algorithm, per-round progress, final done/missing, verdict. */
export function renderRunReport(rounds: RunRound[], streams: StreamState[], maxRounds: number, ts: string): string {
  const last = rounds[rounds.length - 1];
  const converged = last ? last.converged : false;
  const done = streams.filter((s) => s.done);
  const missing = streams.filter((s) => !s.done);
  const L = [
    `# FLEET_RUN.md — end-to-end fleet driver (auto-generated)`,
    ``,
    `> Auto: \`tsx orchestration/bin/fleet-run.ts\` · ${ts}. The systematic work algorithm: preflight →`,
    `> sequenced launch (T1→Tn, ≤2/model) → conduct loop (re-dispatch non-gated streams) → convergence.`,
    `> Claude = conductor; this driver is the automated lieutenant (görev ver / veri al). Bounded ${maxRounds} rounds.`,
    ``,
    `## Verdict: ${converged ? "✅ CONVERGED" : `⏳ NOT CONVERGED after ${rounds.length} round(s)`} — ${done.length}/${streams.length} streams gated`,
    ``,
    `## Rounds (görev ver → veri al)`,
    ...rounds.map((r) => `- round ${r.round}: ${r.done}/${r.total} gated · re-dispatched ${r.redispatched}${r.converged ? " · ✅ CONVERGED" : ""}`),
    ``,
    `## Streams`,
    ...streams.map((s) => `- ${s.done ? "✅" : "⏳"} ${s.stream}`),
  ];
  if (missing.length) {
    L.push(``, `## Remaining (honest — bounded, no infinite loop)`, ...missing.map((s) => `- ⏳ ${s.stream} — not gated within ${maxRounds} rounds (worker self-retries + conductor re-dispatch capped)`));
  }
  return L.join("\n");
}
