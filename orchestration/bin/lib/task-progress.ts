/**
 * orchestration/bin/lib/task-progress.ts — PURE completion ledger for the task catalog (iter-8).
 *
 * Integrates the standalone catalog into the autonomous loop: the conductor drains PENDING tasks, marks them
 * `proposed` when a PROPOSAL is written, and `done` when the gated apply lands green. Persisted to
 * ~/.ollamas/tasks-progress.json by the IO shell. A task id absent from the ledger is `pending`. No IO here.
 */
import type { Task } from "./task-catalog";

export type Status = "pending" | "proposed" | "done";
export type Progress = Record<string, Status>;

/** Status of one task (absent → pending). */
export function statusOf(progress: Progress, id: string): Status {
  return progress[id] ?? "pending";
}

/** The next task to work on: first catalog task that is still `pending` (skips proposed/done). Null when drained. */
export function nextPending(catalog: Task[], progress: Progress): Task | null {
  for (const t of catalog) if (statusOf(progress, t.id) === "pending") return t;
  return null;
}

/** Set a task's status (pure — returns a new ledger). Unknown status is ignored. */
export function mark(progress: Progress, id: string, status: Status): Progress {
  if (!id || !["pending", "proposed", "done"].includes(status)) return progress;
  return { ...progress, [id]: status };
}

export interface ProgressSummary { total: number; done: number; proposed: number; pending: number; }

/** Roll up counts across the catalog (absent → pending). */
export function summary(catalog: Task[], progress: Progress): ProgressSummary {
  let done = 0, proposed = 0;
  for (const t of catalog) {
    const s = statusOf(progress, t.id);
    if (s === "done") done++; else if (s === "proposed") proposed++;
  }
  return { total: catalog.length, done, proposed, pending: catalog.length - done - proposed };
}

/** Per-lane done/total breakdown (stable lane order of first appearance). */
export function laneSummary(catalog: Task[], progress: Progress): { lane: string; done: number; total: number }[] {
  const order: string[] = [];
  const acc: Record<string, { done: number; total: number }> = {};
  for (const t of catalog) {
    if (!acc[t.lane]) { acc[t.lane] = { done: 0, total: 0 }; order.push(t.lane); }
    acc[t.lane].total++;
    if (statusOf(progress, t.id) === "done") acc[t.lane].done++;
  }
  return order.map((lane) => ({ lane, ...acc[lane] }));
}
