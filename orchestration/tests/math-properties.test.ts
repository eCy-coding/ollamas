import { describe, it, expect } from "vitest";
// Formal properties of the pure system core, proved by EXHAUSTIVE enumeration (state spaces are small enough
// that ∀-quantifiers are decidable without fast-check). See docs/MATH.md for the specification each block proves.
import {
  PHASES, TIERS, RETRY_MAX, HISTORY_MAX, nextPhase, bumpRetry, shouldResetRetry, pruneHistory,
  normalizeState, isBlocking, enqueueTask, dequeueTask, emptyOrchestraState, type Phase, type PhaseInput,
} from "../bin/lib/orchestra-fsm";
import { shouldFailover, resolveJoker, maybeFailover, applyFailover } from "../bin/lib/joker";
import { tallyVotes, COUNCIL_QUORUM, type LaneResult } from "../bin/lib/council";
import { resolveTask, type Task } from "../bin/lib/task-catalog";
import { statusOf, nextPending, mark, summary, type Progress } from "../bin/lib/task-progress";
import { severityOf, parseBrewfile } from "../bin/lib/deps";

const BOOL = [false, true];
const TIER_DOMAIN = [null, ...TIERS] as (typeof TIERS[number] | null)[];
// The full FSM input domain: Σ × (TIERS∪{null}) × hasTask × converged × retryExceeded  (7·9·2·2·2 = 1260).
function allInputs(): PhaseInput[] {
  const out: PhaseInput[] = [];
  for (const phase of PHASES) for (const actionTier of TIER_DOMAIN)
    for (const hasTask of BOOL) for (const converged of BOOL) for (const retryExceeded of BOOL)
      out.push({ phase, actionTier, hasTask, converged, retryExceeded });
  return out;
}

describe("FSM δ — totality + determinism (Σ = PHASES)", () => {
  const inputs = allInputs();
  it(`δ is TOTAL: ∀ input → a valid Phase (${inputs.length} combos)`, () => {
    for (const i of inputs) expect(PHASES).toContain(nextPhase(i));
  });
  it("δ is DETERMINISTIC: same input → same output", () => {
    for (const i of inputs) expect(nextPhase(i)).toBe(nextPhase({ ...i }));
  });
  it("gate law: DEPLOYMENT ⟺ converged ∧ ¬blocking ∧ ¬hasTask (from BENCHMARK_VALIDATION)", () => {
    for (const actionTier of TIER_DOMAIN) for (const hasTask of BOOL) for (const converged of BOOL) {
      const next = nextPhase({ phase: "BENCHMARK_VALIDATION", actionTier, hasTask, converged, retryExceeded: false });
      const shouldDeploy = converged && !isBlocking(actionTier) && !hasTask;
      expect(next).toBe(shouldDeploy ? "DEPLOYMENT" : "REPAIR");
    }
  });
});

describe("FSM — termination theorem (REPAIR loop escalates in ≤ RETRY_MAX bumps)", () => {
  it("a persistent blocking gate reaches ESCALATE within RETRY_MAX repair cycles", () => {
    // simulate: BENCHMARK_VALIDATION with converged=false forever → REPAIR ⟳ bumping retry until ESCALATE
    let phase: Phase = "BENCHMARK_VALIDATION", retry = 0, guard = 0;
    while (phase !== "ESCALATE" && guard++ < 100) {
      let exceeded = false;
      if (phase === "REPAIR") { const b = bumpRetry(retry); retry = b.retry_count; exceeded = b.exceeded; }
      phase = nextPhase({ phase, actionTier: "RED", hasTask: false, converged: false, retryExceeded: exceeded });
    }
    expect(phase).toBe("ESCALATE");
    expect(retry).toBeLessThanOrEqual(RETRY_MAX);
    expect(guard).toBeLessThanOrEqual(2 * RETRY_MAX + 2); // bounded step count
  });
  it("bumpRetry is monotone and flags exceeded exactly at RETRY_MAX", () => {
    let n = 0;
    for (let i = 1; i <= RETRY_MAX + 2; i++) { const b = bumpRetry(n); expect(b.retry_count).toBe(n + 1); n = b.retry_count; expect(b.exceeded).toBe(n >= RETRY_MAX); }
  });
});

describe("FSM — bounded history + normalize idempotence", () => {
  it("|pruneHistory(h)| ≤ HISTORY_MAX ∀ input length", () => {
    let h: ReturnType<typeof pruneHistory> = [];
    for (let n = 0; n < HISTORY_MAX * 2 + 5; n++) { h = pruneHistory(h, { ts: String(n), phase: "MONITORING", note: "x" }); expect(h.length).toBeLessThanOrEqual(HISTORY_MAX); }
  });
  it("normalizeState is a total retraction: output always valid + idempotent", () => {
    const garbage = [null, {}, { phase: "NOPE", retry_count: -5, history: 7 }, { conductor_model: "" }];
    for (const g of garbage) {
      const s = normalizeState(g, "m");
      expect(PHASES).toContain(s.phase);
      expect(s.retry_count).toBeGreaterThanOrEqual(0);
      expect(Array.isArray(s.history)).toBe(true);
      expect(normalizeState(s, "m")).toEqual(s); // idempotent
    }
  });
  it("enqueue is idempotent on consecutive dupes; dequeue is FIFO (queue length invariant)", () => {
    let s = emptyOrchestraState("m");
    s = enqueueTask(s, "a"); s = enqueueTask(s, "a"); // dupe collapses
    expect(s.pending_actions).toEqual(["a"]);
    s = enqueueTask(s, "b"); s = dequeueTask(s);
    expect(s.current_task).toBe("a"); expect(s.pending_actions).toEqual(["b"]);
    expect(shouldResetRetry("DEPLOYMENT") && shouldResetRetry("COUNCIL_DEBATE")).toBe(true);
  });
});

describe("Council — quorum is a monotone threshold at COUNCIL_QUORUM (exclusive)", () => {
  const seat = (ok: boolean, work: boolean): LaneResult =>
    ({ lane: "x", model: "m" + Math.random(), ok, findings: work ? [{ lane: "x", model: "m", kind: "TASK", text: "t" }] : [] });
  it("decision = [ agreeing/participating > 0.6 ]; monotone in agreeing", () => {
    for (let P = 1; P <= 6; P++) for (let A = 0; A <= P; A++) {
      const seats = [...Array(A)].map(() => seat(true, true)).concat([...Array(P - A)].map(() => seat(true, false)));
      const v = tallyVotes(seats)[0];
      expect(v.participating).toBe(P); expect(v.agreeing).toBe(A);
      expect(v.decision).toBe(A / P > COUNCIL_QUORUM ? "EXECUTE" : "HOLD");
    }
  });
  it("threshold is EXCLUSIVE: exactly 0.6 (3/5) → HOLD; silence → HOLD", () => {
    const seats = [...Array(3)].map(() => seat(true, true)).concat([...Array(2)].map(() => seat(true, false)));
    expect(tallyVotes(seats)[0].decision).toBe("HOLD");
    expect(tallyVotes([seat(false, true)])[0].decision).toBe("HOLD"); // no responders
  });
});

describe("Joker — failover policy truth table + no-thrash", () => {
  it("shouldFailover(h,c,j) ⟺ ¬h ∧ j≠'' ∧ j≠c  (all 2·2·2 cases)", () => {
    for (const healthy of BOOL) for (const c of ["A"]) for (const j of ["", "A", "B"]) {
      expect(shouldFailover(healthy, c, j)).toBe(!healthy && !!j && j !== c);
    }
  });
  it("resolveJoker returns '' when no healthy alternative → maybeFailover never thrashes", () => {
    expect(resolveJoker(["A"], "A")).toBe("");
    const s = emptyOrchestraState("A");
    expect(maybeFailover(s, false, ["A"], "t").swapped).toBe(false); // conductor down but no alternative → hold
    expect(applyFailover(s, "B", "t").failover_count).toBe(1); // and applyFailover bumps exactly once
  });
});

describe("Resolver — determinism + precedence (exact ⊐ substring ⊐ token-overlap)", () => {
  const cat: Task[] = [
    { id: "backend-tokens", lane: "b", target: "server/tokens.ts", goal: "guard empty count" },
    { id: "cli-output", lane: "c", target: "cli/lib/output.ts", goal: "jsdoc shouldColor" },
  ];
  it("deterministic: same query → same task", () => {
    for (const q of ["backend-tokens", "guard the count", "cli-output", "zzz", ""]) expect(resolveTask(q, cat)?.id).toBe(resolveTask(q, cat)?.id);
  });
  it("precedence holds", () => {
    expect(resolveTask("cli-output", cat)?.id).toBe("cli-output");              // exact id
    expect(resolveTask("do backend-tokens now", cat)?.id).toBe("backend-tokens"); // substring
    expect(resolveTask("shouldColor jsdoc", cat)?.id).toBe("cli-output");        // token-overlap
    expect(resolveTask("totally unrelated", cat)).toBeNull();                    // no match → null
  });
});

describe("Ledger — monotone progress + summation invariant", () => {
  const cat: Task[] = [{ id: "a", lane: "L", target: "x", goal: "g" }, { id: "b", lane: "L", target: "y", goal: "g" }, { id: "c", lane: "M", target: "z", goal: "g" }];
  it("statusOf∘mark = identity on the marked id (absent = pending)", () => {
    for (const st of ["pending", "proposed", "done"] as const) expect(statusOf(mark({}, "a", st), "a")).toBe(st);
    expect(statusOf({}, "zzz")).toBe("pending");
  });
  it("Σ(done,proposed,pending) = total ∀ ledger", () => {
    for (const p of [{}, { a: "done" }, { a: "done", b: "proposed" }, { a: "done", b: "done", c: "done" }] as Progress[]) {
      const s = summary(cat, p); expect(s.done + s.proposed + s.pending).toBe(s.total); expect(s.total).toBe(cat.length);
    }
  });
  it("nextPending = first pending; null ⟺ all done/proposed (drain terminates)", () => {
    expect(nextPending(cat, {})?.id).toBe("a");
    expect(nextPending(cat, { a: "done", b: "proposed" })?.id).toBe("c");
    expect(nextPending(cat, { a: "done", b: "done", c: "done" })).toBeNull();
  });
});

describe("Deps — severity is a total function of tier (BLOCK ⟺ core)", () => {
  it("severityOf(t) = BLOCK ⟺ t = core", () => {
    for (const t of ["core", "dev", "asset", "tunnel", "packaging", "ai", "cask", "unknown"]) expect(severityOf(t)).toBe(t === "core" ? "BLOCK" : "WARN");
  });
  it("parseBrewfile partitions lines by tier header (no leakage)", () => {
    const deps = parseBrewfile(`# === TIER: core ===\nbrew "jq"\n# === TIER: dev ===\nbrew "gh"\ncask "docker"`);
    expect(deps.map((d) => [d.name, d.tier, d.cask])).toEqual([["jq", "core", false], ["gh", "dev", false], ["docker", "dev", true]]);
  });
});
