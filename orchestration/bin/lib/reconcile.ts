/**
 * orchestration/bin/lib/reconcile.ts — vO23 Autonomous Fleet Reconcile CORE (pure, total, deterministic).
 *
 * Kubernetes-operator **level-based reconcile** fused with the OpenHands bounded autonomous loop: compares
 * the DESIRED fleet state (target Hybrid mode + benchmark-chosen variant from DISPATCH_SELECTION) against
 * the ACTUAL state (from dispatchdoctor.fleetReadiness) and returns the SINGLE next action to converge —
 * uninterrupted, benchmark-driven, no human in the loop. Reuses the dispatchdoctor readiness signal +
 * the fleet.ts exponential-backoff pattern (reimplemented zero-dep; inherit-don't-reinvent).
 *
 * Foundation: pure (no IO, no Date.now), total (every input → exactly one action, never throws),
 * deterministic. Invariants I14–I18 proven in tests/reconcile.test.ts.
 */

export type HybridMode = "inference-offload" | "full-remote";

/** What we WANT: a Hybrid mode active, with a benchmark-measured variant chosen. */
export interface DesiredState {
  mode: HybridMode;
  requiredModel: string;
  variant: string | null; // from DISPATCH_SELECTION (null = no measured method yet)
}

/** What IS: the live fleet readiness (built from dispatchdoctor.fleetReadiness). */
export interface ActualState {
  anyReachable: boolean;   // ≥1 worker not "down"
  offloadGo: boolean;      // inference-offload mode is GO
  fullRemoteGo: boolean;   // full-remote-dispatch mode is GO
  remediation: string[];   // doctor's fix steps for the gap (empty when GO)
}

export interface ReconcileInput { desired: DesiredState; actual: ActualState; attempt: number; }

export type ReconcileAction =
  | { kind: "dispatch"; mode: HybridMode; variant: string; detail: string } // converged steady-state: ready → proceed
  | { kind: "remediate"; steps: string[]; detail: string }                  // reachable but mode not GO → close the gap
  | { kind: "rebench"; detail: string }                                     // no measured variant → run dispatchbench first
  | { kind: "backoff"; delayMs: number; detail: string };                   // all-down → exponential backoff, requeue

// ── exponential backoff (fleet.ts pattern, zero-dep reimpl) ────────────────────────
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30_000;

/** Pure exponential backoff: base·2^attempt capped at max. Monotonic non-decreasing in attempt, bounded. */
export function nextBackoff(attempt: number): number {
  const a = Math.max(0, Math.floor(Number.isFinite(attempt) ? attempt : 0));
  // cap the exponent so 2**a can't overflow before the min() clamp
  const exp = Math.min(a, 40);
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exp);
}

// ── reconcile (level-based, ordered, total) ────────────────────────────────────────

/** `go` for the desired mode = the matching readiness verdict. */
function isGo(desired: DesiredState, actual: ActualState): boolean {
  return desired.mode === "full-remote" ? actual.fullRemoteGo : actual.offloadGo;
}

/**
 * The single next action to converge actual → desired. Ordered checks (level-based, K8s reconcile):
 *   1. all-down (no reachable worker) → backoff (requeue with exponential delay).
 *   2. no measured variant (DISPATCH_SELECTION null) → rebench (can't dispatch without a benchmark choice).
 *   3. desired mode is GO → dispatch (converged steady-state: proceed with the chosen variant).
 *   4. otherwise (reachable + variant chosen, but mode not GO) → remediate (run the doctor's fix steps).
 * Pure · total · deterministic.
 */
export function reconcile(input: ReconcileInput): ReconcileAction {
  const { desired, actual, attempt } = input;

  if (!actual.anyReachable) {
    return { kind: "backoff", delayMs: nextBackoff(attempt),
      detail: `all-down — hiç erişilebilir worker yok → backoff (deneme ${Math.max(0, Math.floor(attempt))})` };
  }
  if (desired.variant === null) {
    return { kind: "rebench",
      detail: `ölçülmüş varyant yok (DISPATCH_SELECTION null) → dispatchbench koş, sonra dispatch` };
  }
  if (isGo(desired, actual)) {
    return { kind: "dispatch", mode: desired.mode, variant: desired.variant,
      detail: `converged — ${desired.mode} GO + varyant '${desired.variant}' → dispatch (steady-state)` };
  }
  return { kind: "remediate", steps: actual.remediation,
    detail: `${desired.mode} NO-GO ama worker erişilebilir → remediation uygula (${actual.remediation.length} adım)` };
}

// ── render (deterministic markdown) ────────────────────────────────────────────────

/** Render the reconcile snapshot — desired/actual/action. Deterministic. */
export function renderReconcile(input: ReconcileInput, action: ReconcileAction, ts: string): string {
  const L: string[] = [];
  L.push(`# RECONCILE — autonomous fleet reconcile loop (vO23)`);
  L.push(`<!-- AUTO reconcile.ts · ${ts} · regenerate: tsx orchestration/bin/reconcile.ts -->`);
  L.push(``);
  L.push(`> Level-based reconcile (K8s-operator pattern): desired-vs-actual → tek sonraki aksiyon. Benchmark-driven, soru yok.`);
  L.push(``);
  L.push(`## Desired (istenen)`);
  L.push(`- mode: **${input.desired.mode}** · gerekli model: \`${input.desired.requiredModel}\` · variant: ${input.desired.variant ?? "—"}`);
  L.push(``);
  L.push(`## Actual (gerçek · dispatchdoctor)`);
  L.push(`- anyReachable: ${input.actual.anyReachable} · offload-GO: ${input.actual.offloadGo} · full-remote-GO: ${input.actual.fullRemoteGo}`);
  if (input.actual.remediation.length) for (const r of input.actual.remediation) L.push(`- gap: ${r}`);
  L.push(``);
  L.push(`## Action (tek sonraki adım — converge)`);
  const extra = action.kind === "backoff" ? ` (delayMs=${action.delayMs})`
    : action.kind === "dispatch" ? ` (${action.mode} · ${action.variant})`
    : action.kind === "remediate" ? ` (${action.steps.length} adım)` : "";
  L.push(`**▶ ${action.kind.toUpperCase()}${extra}** — ${action.detail}`);
  return L.join("\n");
}
