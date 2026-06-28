/**
 * vO23 — example + PROPERTY proofs of the reconcile core's invariants (INVARIANTS.md I14–I18).
 * Reuses the proptest.ts harness (math+logic+evidence foundation).
 */
import { describe, it, expect } from "vitest";
import {
  reconcile, nextBackoff, renderReconcile, BACKOFF_MAX_MS,
  type DesiredState, type ActualState, type ReconcileInput, type HybridMode,
} from "../bin/lib/reconcile";
import {
  assertForAll, intGen, boolGen, pickGen, arrayGen, mapGen, recordGen, type Gen,
} from "../bin/lib/proptest";

const RUNS = 3000;
const J = (x: unknown) => JSON.stringify(x);

// ── example-based (the canonical paths) ─────────────────────────────────────────────
describe("reconcile — canonical paths", () => {
  const base: ReconcileInput = {
    desired: { mode: "inference-offload", requiredModel: "qwen3:8b", variant: "v0" },
    actual: { anyReachable: true, offloadGo: true, fullRemoteGo: false, remediation: [] },
    attempt: 0,
  };
  it("converged (GO + variant) → dispatch", () => {
    expect(reconcile(base).kind).toBe("dispatch");
  });
  it("variant null → rebench (even if GO)", () => {
    expect(reconcile({ ...base, desired: { ...base.desired, variant: null } }).kind).toBe("rebench");
  });
  it("mode not GO but reachable → remediate with steps", () => {
    const r = reconcile({ ...base, desired: { ...base.desired, mode: "full-remote" },
      actual: { ...base.actual, fullRemoteGo: false, remediation: ["run gateway on win"] } });
    expect(r.kind).toBe("remediate");
    if (r.kind === "remediate") expect(r.steps).toEqual(["run gateway on win"]);
  });
  it("all-down → backoff with delay", () => {
    const r = reconcile({ ...base, actual: { anyReachable: false, offloadGo: false, fullRemoteGo: false, remediation: [] }, attempt: 2 });
    expect(r.kind).toBe("backoff");
    if (r.kind === "backoff") expect(r.delayMs).toBe(nextBackoff(2));
  });
});

// ── nextBackoff: monotonic + bounded (I18) ──────────────────────────────────────────
describe("nextBackoff — monotonic non-decreasing, bounded (I18)", () => {
  it("∀ attempt: 0 < delay ≤ MAX, and delay(a) ≤ delay(a+1)", () => {
    assertForAll({ seed: 1, runs: RUNS }, intGen(0, 60), (a) => {
      const d = nextBackoff(a), d1 = nextBackoff(a + 1);
      return d > 0 && d <= BACKOFF_MAX_MS && d <= d1 && d1 <= BACKOFF_MAX_MS;
    });
  });
  it("total: negative / non-finite → still bounded", () => {
    for (const a of [-5, -1, NaN, Infinity, -Infinity]) {
      const d = nextBackoff(a as number);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(BACKOFF_MAX_MS);
    }
  });
});

// ── generators for property proofs ──────────────────────────────────────────────────
const MODES: HybridMode[] = ["inference-offload", "full-remote"];
const desiredGen: Gen<DesiredState> = recordGen<DesiredState>({
  mode: pickGen(MODES),
  requiredModel: pickGen(["qwen3:8b", "qwen3-coder:30b"]) as Gen<string>,
  variant: pickGen([null, "v0", "v1"]) as Gen<string | null>,
});
const actualGen: Gen<ActualState> = recordGen<ActualState>({
  anyReachable: boolGen,
  offloadGo: boolGen,
  fullRemoteGo: boolGen,
  remediation: arrayGen(mapGen(intGen(0, 3), (n) => "fix" + n), 3),
});
const inputGen: Gen<ReconcileInput> = recordGen<ReconcileInput>({
  desired: desiredGen,
  actual: actualGen,
  attempt: intGen(0, 50),
});

// ── reconcile invariants (I14–I17) ──────────────────────────────────────────────────
describe("reconcile — totality · determinism · convergence · idempotence", () => {
  it("I14 totality + I15 determinism: ∀ input → exactly one of 4 kinds, deterministic", () => {
    assertForAll({ seed: 7, runs: RUNS }, inputGen, (input) => {
      const a = reconcile(input);
      if (!["dispatch", "remediate", "rebench", "backoff"].includes(a.kind)) return false;
      return J(reconcile(input)) === J(a); // determinism
    });
  });

  it("I16 convergence: dispatch ⟺ (reachable ∧ variant≠null ∧ mode-GO); not-GO never dispatches", () => {
    assertForAll({ seed: 11, runs: RUNS }, inputGen, (input) => {
      const a = reconcile(input);
      const go = input.desired.mode === "full-remote" ? input.actual.fullRemoteGo : input.actual.offloadGo;
      const readyToDispatch = input.actual.anyReachable && input.desired.variant !== null && go;
      // dispatch returned IFF the fleet is converged-and-ready
      if ((a.kind === "dispatch") !== readyToDispatch) return false;
      // when NOT go (and reachable+variant), the action must be remediate (a fixable gap), never dispatch
      if (input.actual.anyReachable && input.desired.variant !== null && !go && a.kind !== "remediate") return false;
      return true;
    });
  });

  it("I17 idempotence: re-running reconcile on the same input yields the same action (stable fixpoint)", () => {
    assertForAll({ seed: 21, runs: RUNS }, inputGen, (input) => J(reconcile(input)) === J(reconcile(input)));
  });

  it("all-down always backoff; rebench precedes go-check (variant null dominates)", () => {
    assertForAll({ seed: 31, runs: RUNS }, inputGen, (input) => {
      const a = reconcile(input);
      if (!input.actual.anyReachable) return a.kind === "backoff";
      if (input.desired.variant === null) return a.kind === "rebench";
      return true;
    });
  });
});

// ── renderReconcile ─────────────────────────────────────────────────────────────────
describe("renderReconcile", () => {
  it("shows desired/actual/action + labels itself reconcile", () => {
    const input: ReconcileInput = {
      desired: { mode: "full-remote", requiredModel: "qwen3:8b", variant: null },
      actual: { anyReachable: true, offloadGo: true, fullRemoteGo: false, remediation: ["run gateway on win"] },
      attempt: 0,
    };
    const md = renderReconcile(input, reconcile(input), "2026-06-28");
    expect(md).toMatch(/RECONCILE/);
    expect(md).toMatch(/Desired|Actual|Action/);
    expect(md).toMatch(/REBENCH|DISPATCH|REMEDIATE|BACKOFF/);
  });
});
