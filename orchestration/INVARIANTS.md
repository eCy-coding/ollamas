# INVARIANTS — formal spec of the dispatch pure cores (vO22)

> Mathematical + logical contract each pure core MUST satisfy. Proven by property-based tests over
> thousands of deterministic inputs (`orchestration/tests/dispatch-invariants.test.ts` + `bin/lib/proptest.ts`).
> The **cli lane inherits these cores** — it must preserve every invariant. Notation: ∀ = for all, ⟹ = implies,
> ⟺ = iff. A function is **total** = never throws on any in-type input; **deterministic** = `f(x)` always equals `f(x)`.

## `assignWorker(task, workers, opts?)` — `bin/lib/dispatchbench.ts`
- **I1 Totality:** ∀ task, workers → returns `{worker: string|null, reason: string}` (never throws).
- **I2 Determinism:** `assignWorker(t,w)` ≡ `assignWorker(t,w)` (structural equality).
- **I3 Soundness:** `worker ≠ null ⟹ ∃ w ∈ workers . w.name = worker ∧ w.healthy`. (Never returns an unhealthy/absent worker.)
- **I4 Safety (host-tool isolation):** `task.kind = "host-tool" ∧ worker ≠ null ⟹ the chosen worker is a healthy `kind="mac"`` (control plane). A host-tool task NEVER routes to a remote — proven, not assumed.
- **I5 Thrash-guard:** if `opts.current ∈ eligible(task, workers)` then `worker = opts.current` (no churn). `eligible` = host-tool → [first healthy mac]; else → [healthy remotes …, first healthy mac]. Membership, not order. *(PBT tightened this: a 2nd healthy mac is NOT eligible for host-tool.)*

## `selectBestForMachine(aggs, machine)` / ordered gate — `bin/lib/dispatchbench.ts`
- **I6 Correctness-gate floor:** `variant ≠ null ⟹ correctRatio ≥ DISPATCH_CORRECT_GATE (0.7)`. No candidate clears the floor ⟹ `variant = null`.
- **I7 Determinism + idempotence:** repeated selection on the same aggregates → identical result.
- **I8 Permutation-invariance:** reordering the input records → the SAME selected variant. (Comparator `betterDispatch` is a strict-weak-ordering: correctRatio ↓ → steps+dup ↑ → latency ↑ → tok/s ↓ → variant-name; total + antisymmetric on the winner.)

## `simulateDispatch(epic, workers, timeline)` — `bin/lib/dispatchsim.ts`
- **I9 Bounded termination:** each task emits ≤ `2·maxHops + 1` ledger events (`maxHops = workers.length + 1`) → total events ≤ `|epic|·(2·maxHops+1)`. No infinite failover loop — the virtual clock + hop cap guarantee settlement.
- **I10 Soundness:** `epicReport.allOk ⟺ |tasks| = |epic| ∧ ∀ t . t.status = "done"`; `verdict = allOk ? "DONE" : "INCOMPLETE"`.
- **I11 Determinism:** same (epic, workers, timeline) → identical `SimResult`.
- **I12 Failover-monotonicity:** an empty health timeline (no worker ever goes down) ⟹ `failovers = ∅`. (A failover requires a `firstFailTick` in some task's run window.)

## `foldClaims(events)` — `bin/lib/claims.ts`
- **I13 LWW permutation-invariance (precondition: strict total order):** if no two distinct events share `(ts, fence, tab)`, then `foldClaims(σ(events))` ≡ `foldClaims(events)` for any permutation σ. The last-writer-wins order is `ts → fence → tab`.
  - **Caveat (proven by PBT):** on a TIE — two events with equal `(ts, fence, tab)` but differing other fields — `newer` returns false, so the FIRST-seen wins → order-dependent. The real ledger avoids ties by construction (epoch-ms `ts` + per-key monotonic `fence`). Callers MUST preserve this uniqueness. The property test enforces the precondition (de-dupes the order-key) before asserting invariance.

## `reconcile(desired, actual, attempt)` / `nextBackoff` — `bin/lib/reconcile.ts` (vO23)
Level-based reconcile (Kubernetes-operator pattern): the single next action to converge actual → desired.
- **I14 Totality:** ∀ (desired, actual, attempt) → exactly one `ReconcileAction.kind ∈ {dispatch, remediate, rebench, backoff}` (never throws).
- **I15 Determinism:** `reconcile(x)` ≡ `reconcile(x)`.
- **I16 Convergence:** `dispatch ⟺ (actual.anyReachable ∧ desired.variant ≠ null ∧ go(desired.mode))`. When reachable ∧ variant≠null ∧ ¬go → action = `remediate` (a fixable gap, never `dispatch`). Ordered precedence: ¬anyReachable → `backoff`; else variant=null → `rebench`; else go → `dispatch`; else → `remediate`.
- **I17 Idempotence:** same input → same action (stable fixpoint; the converged steady-state is `dispatch`).
- **I18 Backoff monotonicity + boundedness:** `nextBackoff(a) = min(MAX, BASE·2^a)`, non-decreasing in `a`, and `0 < nextBackoff(a) ≤ BACKOFF_MAX_MS (30000)` for ALL inputs incl. negative/non-finite (total).

---
*Generated for vO22, extended vO23. Update this spec + its property tests together whenever a core's contract changes — the spec is the source of truth the cli lane is verified against (spec-to-code-compliance).*
