/**
 * orchestration/bin/lib/sandbox-round.ts — PURE round core of the management sandbox (MAPE-K loop —
 * RESEARCH-ORG.md §3: Monitor outcomes → Analyze invariants → Plan routing → Execute stub dispatches,
 * with the ledger as Knowledge). No disk, no network, no clocks — org-sandbox.ts is the IO shell.
 *
 * Each round dispatches a synthetic task wave through the REAL engine functions (assignRole/
 * consultErrors/buildDispatchPrompt/recordOutcome) with deterministic stub outcomes + chaos:
 *  - actor-down injection → the wave must route around the down actor (supervision restart-elsewhere);
 *  - "sb-flaky": fails on its first actor every time → from round 2 the brief MUST carry round 1's
 *    proposal rule verbatim AND the router MUST avoid the failed actor (never repeat, measurably);
 *  - "sb-stubborn": the harness deliberately re-dispatches to the same actor once (operator-override
 *    simulation) → the second same-signature failure MUST be detected as a recurrence and harden the
 *    proposal (recurrence_count=1, RECURRENCE ×2 rule);
 *  - "sb-code-*": bootstrap history seeds evidence → routing MUST be evidence-weighted (Contract-Net-lite).
 * Violations are returned as strings; the shell aggregates them into SANDBOX-ORG.md and the exit code.
 */
import {
  assignRole, consultErrors, faultsAsRules, buildDispatchPrompt, recordOutcome, actorStats,
  detectRecurrence, errorSignature,
  type OrgChart, type PreventionRule, type TaskSpec, type LedgerEntry, type ErrorEntryProposal,
  type DispatchOutcome,
} from "./organization";

export interface RoundInput {
  chart: OrgChart;
  /** Static rules (registries) — accumulated sandbox proposals are appended by the shell. */
  rules: PreventionRule[];
  /** Full ledger so far (Knowledge). */
  ledger: LedgerEntry[];
  round: number; // 1-based
  /** Chaos: actors unavailable this round. */
  downActors: string[];
  nextErrorSeq: number;
  ts: string;
}

export interface RoundDispatch {
  taskId: string;
  actorId: string;
  reason: string;
  ok: boolean;
  rulesInBrief: string[];
}

export interface RoundResult {
  dispatches: RoundDispatch[];
  newLedger: LedgerEntry[];
  newProposals: ErrorEntryProposal[];
  violations: string[];
  nextErrorSeq: number;
}

/** Accumulated ERR-ORG proposals become live prevention knowledge for later rounds (distill step). */
export function proposalsAsRules(props: ErrorEntryProposal[]): PreventionRule[] {
  return props.map((p) => ({
    id: p.id, source: "sandbox:ERRORS_PROPOSED",
    text: `${p.file} ${p.category} ${p.root_cause}`,
    rule: p.prevention_rule,
  }));
}

/** Actors that already FAILED this taskId (route-away set — OTP restart-elsewhere). */
export function failedActorsFor(ledger: LedgerEntry[], taskId: string): string[] {
  return Array.from(new Set(
    ledger.filter((e) => e.type === "outcome" && e.ok === false && e.taskId === taskId).map((e) => e.actorId),
  ));
}

/** The synthetic wave: one task per routing class + the three chaos probes. */
export function waveFor(round: number): TaskSpec[] {
  return [
    { id: `sb-code-r${round}`, goal: "fix the failing parser in the sandbox module", cls: "code" },
    { id: `sb-review-r${round}`, goal: "review the sandbox diff quickly", cls: "review" },
    { id: `sb-vision-r${round}`, goal: "analyze the sandbox screenshot for drift", cls: "vision" },
    { id: `sb-embed-r${round}`, goal: "semantic search for duplicate sandbox helpers", cls: "embed" },
    { id: "sb-flaky", goal: "research the flaky upstream endpoint behavior", cls: "research", tags: ["bridge", "payload"] },
    { id: "sb-stubborn", goal: "transcribe the archived recording batch", cls: "transcribe" },
  ];
}

/**
 * Deterministic stub executor: sb-flaky fails on the two research seats that share the broken bridge
 * (conductor/odysseus) and succeeds once escalation reaches the joker — proving route-away CONVERGES;
 * sb-stubborn fails on its only home actor (transcriber).
 */
function stubOutcome(taskId: string, actorId: string, ts: string): DispatchOutcome {
  if (taskId === "sb-flaky" && (actorId === "conductor" || actorId === "odysseus")) {
    return { taskId, actorId, ok: false, summary: "bridge returned ok:true with error embedded in text", ts, error: "bridge ok:true but payload contains error marker" };
  }
  if (taskId === "sb-stubborn" && actorId === "transcriber") {
    return { taskId, actorId, ok: false, summary: "decode crash on corrupt frame", ts, error: "decoder crash: corrupt frame header" };
  }
  return { taskId, actorId, ok: true, summary: "stub run ok", ts };
}

export function runRound(input: RoundInput): RoundResult {
  const { chart, round, ts } = input;
  const violations: string[] = [];
  const newLedger: LedgerEntry[] = [];
  const newProposals: ErrorEntryProposal[] = [];
  let seq = input.nextErrorSeq;
  const dispatches: RoundDispatch[] = [];
  const stats = actorStats(input.ledger);
  const ledgerView = () => [...input.ledger, ...newLedger];

  for (const task of waveFor(round)) {
    // PLAN: route-away set = failed actors for this task + this round's down actors.
    // sb-stubborn override: on round 2 we deliberately DO NOT avoid (operator-override simulation)
    // so the recurrence path is exercised; from round 3 avoidance is back on.
    const stubbornOverride = task.id === "sb-stubborn" && round === 2;
    const avoid = stubbornOverride
      ? [...input.downActors]
      : [...failedActorsFor(ledgerView(), task.id), ...input.downActors];
    const a = assignRole(chart, task, { stats, avoid });

    if (input.downActors.includes(a.actorId)) {
      violations.push(`round ${round}: ${task.id} routed to DOWN actor ${a.actorId}`);
    }

    const hits = consultErrors([...input.rules, ...faultsAsRules(a)], task);
    const brief = buildDispatchPrompt(chart, a, task, hits);
    dispatches.push({ taskId: task.id, actorId: a.actorId, reason: a.reason, ok: true, rulesInBrief: hits.map((h) => h.id) });

    // EXECUTE (stub) + record dispatch.
    newLedger.push({ type: "dispatch", tier: "episodic", ts, taskId: task.id, actorId: a.actorId, summary: `dispatch ${task.id} → ${a.actorId}` });
    const outcome = stubOutcome(task.id, a.actorId, ts);
    const sig = outcome.ok ? "" : errorSignature(outcome);
    const recurrence = outcome.ok ? 0 : detectRecurrence(ledgerView(), sig);
    const rec = recordOutcome(outcome, { rulesApplied: hits.map((h) => h.id), nextErrorSeq: seq, recurrenceCount: recurrence });
    newLedger.push(rec.ledger);
    if (rec.registryAppend) { newProposals.push(rec.registryAppend); seq += 1; }
    dispatches[dispatches.length - 1].ok = outcome.ok;

    // ANALYZE: per-task invariants.
    if (task.id === "sb-flaky" && round >= 2) {
      const firstFailRule = input.rules.find((r) => r.source === "sandbox:ERRORS_PROPOSED" && r.text.includes("sb-flaky"));
      if (!firstFailRule) violations.push(`round ${round}: sb-flaky has no accumulated proposal rule to inject`);
      else if (!brief.includes(firstFailRule.rule)) violations.push(`round ${round}: sb-flaky brief does not carry rule ${firstFailRule.id} verbatim`);
      const failed = failedActorsFor(input.ledger, "sb-flaky");
      if (failed.includes(a.actorId)) violations.push(`round ${round}: sb-flaky re-dispatched to failed actor ${a.actorId}`);
    }
    if (task.id === "sb-stubborn" && round === 2 && !outcome.ok) {
      if (recurrence < 1) violations.push(`round 2: sb-stubborn second same-sig failure not detected as recurrence`);
      if (rec.registryAppend && rec.registryAppend.recurrence_count < 1) violations.push(`round 2: sb-stubborn proposal not hardened (recurrence_count=0)`);
    }
    if (task.id === "sb-stubborn" && round >= 3) {
      if (a.actorId === "transcriber") violations.push(`round ${round}: sb-stubborn re-dispatched to transcriber after recurrence`);
    }
    if (task.cls === "code" && !input.downActors.includes("coder-b")) {
      if (a.actorId !== "coder-b" || a.reason !== "evidence-weighted") {
        violations.push(`round ${round}: ${task.id} not evidence-weighted to coder-b (got ${a.actorId}/${a.reason})`);
      }
    }
  }

  // ANALYZE: wave-level invariants.
  if (newLedger.length !== waveFor(round).length * 2) {
    violations.push(`round ${round}: ledger delta ${newLedger.length} ≠ ${waveFor(round).length * 2} (dispatch+outcome per task)`);
  }
  const ids = newProposals.map((p) => p.id);
  if (new Set(ids).size !== ids.length) violations.push(`round ${round}: duplicate ERR-ORG ids in proposals`);

  return { dispatches, newLedger, newProposals, violations, nextErrorSeq: seq };
}

/** The synthetic sandbox org chart (raw JSON shape — parsed by parseOrgChart in the shell/tests). */
export const SANDBOX_CHART_JSON = {
  version: 1,
  ts: "2026-07-18T00:00:00Z",
  actors: [
    { id: "emre", kind: "operator", role: "T0", duties: [], capabilities: ["decision"], reportsTo: null, escalatesTo: null, costRank: 3 },
    { id: "conductor", kind: "model", role: "Sandbox Conductor", duties: ["conduct"], capabilities: ["code", "conduct", "research"], reportsTo: "emre", escalatesTo: "joker", model: "qwen3-coder:30b", costRank: 0 },
    { id: "coder-b", kind: "model", role: "Sandbox Coder B", duties: ["code"], capabilities: ["code"], reportsTo: "conductor", escalatesTo: "conductor", model: "qwen3:8b", costRank: 0 },
    { id: "joker", kind: "model", role: "Sandbox Joker", duties: ["review"], capabilities: ["review", "code", "research"], reportsTo: "conductor", escalatesTo: "emre", model: "qwen3:8b", costRank: 1 },
    { id: "vision", kind: "model", role: "Sandbox Vision", duties: ["vision"], capabilities: ["vision"], reportsTo: "conductor", escalatesTo: "conductor", model: "qwen2.5vl:32b", costRank: 0 },
    { id: "librarian", kind: "model", role: "Sandbox Librarian", duties: ["embed"], capabilities: ["embed", "vision"], reportsTo: "conductor", escalatesTo: "conductor", model: "nomic-embed-text", costRank: 0 },
    { id: "odysseus", kind: "service", role: "Sandbox External", duties: ["research"], capabilities: ["research"], reportsTo: "emre", escalatesTo: "conductor", costRank: 0, knownFaults: [{ id: "ORG-FAULT-ODY-001", note: "Bridge returns ok:true even when the response text embeds an error — scan payload before recording success." }] },
    { id: "transcriber", kind: "model", role: "Sandbox Transcriber", duties: ["transcribe"], capabilities: ["transcribe"], reportsTo: "conductor", escalatesTo: "conductor", model: "whisper", costRank: 0 },
  ],
};

/** Bootstrap evidence: conductor weak / coder-b strong on code → round 1 must already route on evidence. */
export function bootstrapHistory(ts: string): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (let i = 0; i < 5; i++) {
    out.push({ type: "outcome", tier: i === 0 ? "episodic" : "learned", ts, taskId: `hist-code-${i}`, actorId: "conductor", ok: i === 0, summary: i === 0 ? "ok" : "failed" });
    out.push({ type: "outcome", tier: "episodic", ts, taskId: `hist-code-b-${i}`, actorId: "coder-b", ok: true, summary: "ok" });
  }
  return out;
}
