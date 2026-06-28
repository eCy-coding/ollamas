/**
 * cli/lib/dispatch-ledger.ts — v1.x-b Dispatch-Ledger pure core (zero-dep, mirror of the orchestration oracle).
 *
 * MIRRORS (does NOT import — N-012 + no cross-lane import) two pure cores:
 *   - orchestration/bin/lib/claims.ts  (fold/LWW/stale/nextFence) generalized from (lane|version) → (taskId)
 *   - orchestration/bin/lib/dispatchbench.ts  assignWorker (pure routing, copied semantics)
 *
 * Pure-core: parse/fold/route logic are saf-fn (no socket/disk) → unit-testable. Any IO wrapper lives elsewhere.
 * Satisfies INVARIANTS I1–I5 (assignWorker totality/determinism/soundness/host-tool-safety/thrash-guard)
 * + I13 (foldLedger LWW permutation-invariance under unique (ts,fence,worker)).
 */

// ── Ledger types ───────────────────────────────────────────────────────────────

export type LedgerStatus = "queued" | "claimed" | "running" | "done" | "failed";

export interface LedgerEvent {
  ts: number;          // epoch ms
  taskId: string;      // dispatch task key (generalized from lane|version)
  worker: string;      // worker that emitted this event
  status: LedgerStatus;
  ttlMs: number;       // claimed/running → stale after this
  fence: number;       // per-taskId monotonic fence; a revived stale worker cannot clobber
}

const STATUSES = new Set<LedgerStatus>(["queued", "claimed", "running", "done", "failed"]);

// ── Pure core: parse / fold / stale / fence ──────────────────────────────────────

/** JSONL → LedgerEvent[]. Bad / missing-field lines skipped (graceful, never throws). */
export function parseLedger(jsonl: string): LedgerEvent[] {
  const out: LedgerEvent[] = [];
  for (const line of jsonl.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      const o = JSON.parse(t);
      if (
        o && typeof o.ts === "number" && typeof o.taskId === "string" &&
        typeof o.worker === "string" && STATUSES.has(o.status) && typeof o.ttlMs === "number"
      ) {
        out.push({
          ts: o.ts,
          taskId: o.taskId,
          worker: o.worker,
          status: o.status,
          ttlMs: o.ttlMs,
          fence: typeof o.fence === "number" ? o.fence : 0,
        });
      }
    } catch { /* skip corrupt line */ }
  }
  return out;
}

/** Is `a` "newer" than `b`? LWW order: ts → fence → worker (strict total order, deterministic). */
function newer(a: LedgerEvent, b: LedgerEvent): boolean {
  if (a.ts !== b.ts) return a.ts > b.ts;
  if (a.fence !== b.fence) return a.fence > b.fence;
  return a.worker > b.worker;
}

/** Events → last state per taskId (LWW). Permutation-invariant under unique (ts,fence,worker) — I13. */
export function foldLedger(events: LedgerEvent[]): Map<string, LedgerEvent> {
  const m = new Map<string, LedgerEvent>();
  for (const e of events) {
    const cur = m.get(e.taskId);
    if (!cur || newer(e, cur)) m.set(e.taskId, e);
  }
  return m;
}

/** claimed/running but TTL exceeded → stale (takeover-able). */
export function isStale(e: LedgerEvent, now: number): boolean {
  return (e.status === "claimed" || e.status === "running") && now - e.ts >= e.ttlMs;
}

/** claimed/running and still within TTL → active. */
export function isActive(e: LedgerEvent, now: number): boolean {
  return (e.status === "claimed" || e.status === "running") && now - e.ts < e.ttlMs;
}

/** Next monotonic fence for a taskId. None seen → 1. */
export function nextFence(events: LedgerEvent[], taskId: string): number {
  let max = 0;
  for (const e of events) {
    if (e.taskId === taskId && e.fence > max) max = e.fence;
  }
  return max + 1;
}

// ── Pure routing: assignWorker (mirror of dispatchbench.assignWorker) ─────────────

export type TaskKind = "codegen" | "analysis" | "host-tool";
export interface DispatchTask { id: string; kind: TaskKind; estTokens?: number; }
export interface FleetWorker { name: string; kind: "mac" | "remote"; healthy: boolean; tokS?: number; }
// Flat (not a union) so property narrowing on `worker` never collapses callers to `never`.
export interface Assignment { worker: string | null; reason: string; }

/**
 * Route one task to a worker. Pure & deterministic. Rules (ordered):
 *  1. host-tool (macos_terminal/iTerm) runs ONLY on the local mac control worker. mac down → null.
 *  2. codegen/analysis (GPU-heavy) → healthy remote worker, highest tok/s (name tie-break).
 *  3. no healthy remote → mac substrate failover (the Hybrid fallback). mac down too → null.
 *  4. thrash-guard: if `current` is still healthy & eligible for this task, stay (avoid reassignment churn).
 */
export function assignWorker(
  task: DispatchTask, workers: FleetWorker[], opts?: { current?: string | null },
): Assignment {
  const healthy = workers.filter((w) => w.healthy);
  const mac = healthy.find((w) => w.kind === "mac") || null;
  const remotes = healthy.filter((w) => w.kind === "remote")
    .sort((a, b) => (b.tokS ?? 0) - (a.tokS ?? 0) || a.name.localeCompare(b.name));

  const eligible: FleetWorker[] =
    task.kind === "host-tool" ? (mac ? [mac] : []) : [...remotes, ...(mac ? [mac] : [])];

  if (!eligible.length) {
    return { worker: null, reason: task.kind === "host-tool"
      ? "host-tool görevi yalnız mac'te koşar, mac down → atanamaz"
      : "hiçbir sağlıklı worker yok → atanamaz" };
  }

  // Thrash-guard: keep the current worker if it is still eligible & healthy.
  if (opts?.current && eligible.some((w) => w.name === opts.current)) {
    return { worker: opts.current, reason: "thrash-guard: mevcut worker hâlâ uygun → değiştirme" };
  }

  const pick = eligible[0];
  const reason = task.kind === "host-tool"
    ? "host-tool → mac kontrol düzlemi"
    : pick.kind === "remote"
      ? `GPU-ağır ${task.kind} → remote ${pick.name} (${pick.tokS ?? "?"} tok/s)`
      : `remote yok → mac substrate failover (${task.kind})`;
  return { worker: pick.name, reason };
}
