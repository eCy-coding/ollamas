/**
 * vO22 — Property-based PROOFS of the dispatch pure cores' formal invariants (see INVARIANTS.md).
 * Each property is verified over thousands of deterministic generated inputs; a failure yields a
 * reproducible counterexample + seed (proptest.ts). This is the mathematical+logical+evidence
 * hardening of the exact cores the cli lane inherits.
 */
import { describe, it } from "vitest";
import {
  assertForAll, intGen, boolGen, pickGen, arrayGen, mapGen, tupleGen, recordGen, type Gen,
} from "../bin/lib/proptest";
import {
  assignWorker, aggregateDispatch, selectBestForMachine, DISPATCH_CORRECT_GATE,
  type DispatchTask, type FleetWorker, type DispatchRecord,
} from "../bin/lib/dispatchbench";
import { simulateDispatch, type SimTask, type HealthEvent } from "../bin/lib/dispatchsim";
import { foldClaims, type ClaimEvent } from "../bin/lib/claims";

const RUNS = 2000;
const J = (x: unknown) => JSON.stringify(x);

// ── generators ────────────────────────────────────────────────────────────────────
const WORKER_NAMES = ["mac", "desktop-ert7724", "box-a", "box-b"] as const;
const TASK_KINDS = ["codegen", "analysis", "host-tool"] as const;

const workerGen: Gen<FleetWorker> = recordGen<FleetWorker>({
  name: pickGen(WORKER_NAMES) as Gen<string>,
  kind: pickGen(["mac", "remote"] as const),
  healthy: boolGen,
  tokS: intGen(0, 60),
});
const workersGen = arrayGen(workerGen, 5);
const taskGen: Gen<DispatchTask> = recordGen<DispatchTask>({
  id: mapGen(intGen(0, 9999), (n) => "t" + n),
  kind: pickGen(TASK_KINDS),
});

// ── assignWorker invariants ─────────────────────────────────────────────────────────
describe("assignWorker — totality · determinism · soundness · safety · thrash-guard", () => {
  it("∀ task,workers: returns a well-formed Assignment (totality), deterministic, sound, safe", () => {
    assertForAll({ seed: 1, runs: RUNS }, tupleGen<[DispatchTask, FleetWorker[]]>(taskGen, workersGen), ([task, workers]) => {
      const r = assignWorker(task, workers);
      const w: string | null = r.worker;
      // totality: shape is always {worker: string|null, reason: string}
      if (typeof w !== "string" && w !== null) return false;
      if (typeof r.reason !== "string") return false;
      // determinism
      if (J(assignWorker(task, workers)) !== J(r)) return false;
      // soundness: a non-null pick is a HEALTHY worker that exists
      if (w !== null && !workers.some((x) => x.name === w && x.healthy)) return false;
      // SAFETY invariant: a host-tool task never runs on a remote — only a healthy mac control worker (or null)
      if (task.kind === "host-tool" && w !== null &&
          !workers.some((x) => x.name === w && x.kind === "mac" && x.healthy)) return false;
      return true;
    });
  });

  it("thrash-guard: if `current` ∈ assignWorker's eligible set, the pick is unchanged", () => {
    const gen = tupleGen(taskGen, workersGen, pickGen(WORKER_NAMES) as Gen<string>);
    assertForAll({ seed: 5, runs: RUNS }, gen, ([task, workers, current]) => {
      // Reconstruct the EXACT eligible set assignWorker computes (its documented contract):
      // host-tool → [the first healthy mac]; else → [healthy remotes…, the first healthy mac].
      // Membership (not order) is what thrash-guard checks. PBT proved "any healthy mac" was too loose:
      // a 2nd healthy mac is NOT eligible for host-tool, so it would not be kept.
      const healthy = workers.filter((w) => w.healthy);
      const mac = healthy.find((w) => w.kind === "mac") || null;
      const remotes = healthy.filter((w) => w.kind === "remote");
      const eligibleNames = task.kind === "host-tool"
        ? (mac ? [mac.name] : [])
        : [...remotes.map((w) => w.name), ...(mac ? [mac.name] : [])];
      if (!eligibleNames.includes(current)) return true; // precondition not met → vacuously true
      return assignWorker(task, workers, { current }).worker === current;
    });
  });
});

// ── selectBestForMachine / ordered gate invariants ──────────────────────────────────
const recordGen_: Gen<DispatchRecord> = recordGen<DispatchRecord>({
  variant: mapGen(intGen(0, 3), (n) => "v" + n),
  machine: pickGen(["mac", "desktop-ert7724"]) as Gen<string>,
  correct: boolGen,
  steps: intGen(0, 20),
  dupTools: intGen(0, 5),
  latencyMs: intGen(0, 2000),
  tokS: intGen(0, 60),
});
const recordsGen = arrayGen(recordGen_, 8);

describe("selectBestForMachine — gate-floor · determinism · idempotence · permutation-invariance", () => {
  it("winner respects correctness-gate floor; selection is deterministic + order-independent", () => {
    assertForAll({ seed: 9, runs: RUNS }, recordsGen, (records) => {
      const aggs = aggregateDispatch(records);
      const sel = selectBestForMachine(aggs, "mac");
      // gate floor: a chosen variant must be ≥ the correctness gate; else variant must be null
      if (sel.variant !== null && sel.correctRatio < DISPATCH_CORRECT_GATE) return false;
      // determinism + idempotence
      if (J(selectBestForMachine(aggs, "mac")) !== J(sel)) return false;
      // permutation-invariance: reordering the input records yields the SAME selected variant
      const rev = aggregateDispatch([...records].reverse());
      if (selectBestForMachine(rev, "mac").variant !== sel.variant) return false;
      return true;
    });
  });
});

// ── simulateDispatch invariants ─────────────────────────────────────────────────────
const simTaskGen: Gen<SimTask> = recordGen<SimTask>({
  id: mapGen(intGen(0, 9999), (n) => "t" + n),
  kind: pickGen(TASK_KINDS),
  durationTicks: intGen(1, 5),
});
const healthEventGen: Gen<HealthEvent> = recordGen<HealthEvent>({
  tick: intGen(0, 20),
  worker: pickGen(WORKER_NAMES) as Gen<string>,
  healthy: boolGen,
});

describe("simulateDispatch — bounded termination · soundness · determinism · failover-monotonicity", () => {
  it("∀ epic,workers,timeline: bounded events, allOk⟺all-done, deterministic", () => {
    const gen = tupleGen(arrayGen(simTaskGen, 4), workersGen, arrayGen(healthEventGen, 6));
    assertForAll({ seed: 13, runs: RUNS }, gen, ([epic, workers, timeline]) => {
      const r = simulateDispatch(epic, workers, timeline);
      const maxHops = workers.length + 1;
      // BOUNDED TERMINATION: each task emits ≤ (2·maxHops + 1) events → total is bounded (no infinite loop)
      if (r.events.length > epic.length * (2 * maxHops + 1)) return false;
      // SOUNDNESS: epic is allOk iff every task settled as "done"
      const allDone = r.epicReport.tasks.length === epic.length && r.epicReport.tasks.every((t) => t.status === "done");
      if (r.epicReport.allOk !== allDone) return false;
      if (r.epicReport.verdict !== (r.epicReport.allOk ? "DONE" : "INCOMPLETE")) return false;
      // determinism
      if (J(simulateDispatch(epic, workers, timeline)) !== J(r)) return false;
      return true;
    });
  });

  it("failover-monotonicity: no health-change timeline ⟹ zero failovers", () => {
    const gen = tupleGen(arrayGen(simTaskGen, 4), workersGen);
    assertForAll({ seed: 21, runs: RUNS }, gen, ([epic, workers]) =>
      simulateDispatch(epic, workers, []).failovers.length === 0);
  });
});

// ── foldClaims (claims.ts) LWW invariants ───────────────────────────────────────────
const claimEventGen: Gen<ClaimEvent> = recordGen<ClaimEvent>({
  ts: intGen(0, 1000),
  tab: pickGen(["A", "B", "C"]) as Gen<string>,
  pid: intGen(1, 9),
  lane: pickGen(["l1", "l2"]) as Gen<string>,
  version: pickGen(["v1", "v2"]) as Gen<string>,
  status: pickGen(["claimed", "done", "released"] as const),
  ttlMs: intGen(0, 5000),
  fence: intGen(0, 5),
});

describe("foldClaims — LWW permutation-invariance (under strict total order) · idempotence", () => {
  it("reordering events yields the identical folded map, given unique (ts,fence,tab) keys", () => {
    assertForAll({ seed: 33, runs: RUNS }, arrayGen(claimEventGen, 10), (events) => {
      // PRECONDITION (see INVARIANTS.md): LWW order ts→fence→tab must be a STRICT total order. On a tie
      // (same ts,fence,tab) `newer` returns false → first-seen wins → order-dependent. The real ledger
      // guarantees uniqueness (epoch ts + monotonic per-key fence); here we enforce it by de-duping the
      // order-key, then prove permutation-invariance holds.
      const seen = new Set<string>();
      const uniq = events.filter((e) => {
        const k = `${e.ts}|${e.fence}|${e.tab}`;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
      const f1 = foldClaims(uniq);
      const f2 = foldClaims([...uniq].reverse());
      if (f1.size !== f2.size) return false;
      for (const [k, v] of f1) {
        const v2 = f2.get(k);
        if (!v2 || J(v) !== J(v2)) return false;
      }
      return true;
    });
  });
});
