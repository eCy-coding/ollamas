// Lanes and steps (pure) — the model behind "every task runs in its own Terminal.app tab".
//
// WHY THIS EXISTS
// The operator's requirement is visibility: *"arka planları görmek istemiyorum … her todo ve
// phase görevini sıralı terminal.app penceresinde çalışacak şekilde görevlendir"*. Work that
// finishes inside an agent session and reports a summary is invisible work; the fix is to
// give every task a named tab that shows it happening.
//
// The scheduling, the queue-line format and the status machine are pure so the interesting
// properties — steps run in order inside a lane, lanes overlap each other, a failure stops
// that lane and not the others — are testable without opening a single window.
//
// The queue line format is the contract between this module and the tiny bash loop the tab
// runs (runtime/termtab.ts writes it). It is deliberately one line per step, tab-free and
// newline-free, so the loop can read it with `read -r` and nothing can smuggle a second
// command into a single entry.

export type StepState = "pending" | "running" | "ok" | "failed" | "skipped";

export interface LaneStep {
  id: string;
  /** Shown in the tab and the conductor table. */
  title: string;
  /** The shell command the tab executes. */
  command: string;
  state: StepState;
  startedMs?: number;
  endedMs?: number;
  exitCode?: number;
  /** When false, a failure here does not stop the rest of the lane. */
  required?: boolean;
}

export interface Lane {
  /** Stable id — also the queue/log directory name. */
  id: string;
  /** Tab title the operator sees. */
  title: string;
  steps: LaneStep[];
}

export class LaneError extends Error {}

/** Queue-line separator: a control char no shell command legitimately contains. */
// Explicit escape, never a literal control character in the source: an invisible byte does
// not survive every editor, patch or copy-paste, and a separator that silently becomes the
// empty string turns every queue line into garbage while the types still look right.
export const QSEP = "\u0001";

/**
 * Encode one step as a single queue line.
 *
 * Newlines and the separator are rejected rather than escaped: a queue entry that could span
 * lines would let one step's text become the next step's command, which is the whole reason
 * the tab loop reads line-by-line.
 */
export function encodeStep(s: Pick<LaneStep, "id" | "title" | "command">): string {
  for (const [field, v] of Object.entries(s)) {
    if (/[\n\r]/.test(String(v))) throw new LaneError(`step ${s.id}: ${field} contains a newline`);
    if (String(v).includes(QSEP)) throw new LaneError(`step ${s.id}: ${field} contains the queue separator`);
  }
  return [s.id, s.title, s.command].join(QSEP);
}

export function decodeStep(line: string): { id: string; title: string; command: string } | null {
  const parts = String(line ?? "").split(QSEP);
  if (parts.length !== 3 || !parts[0]) return null;
  return { id: parts[0], title: parts[1], command: parts[2] };
}

/** Steps that may still run: everything up to (and including) the first required failure. */
export function runnable(lane: Lane): LaneStep[] {
  const out: LaneStep[] = [];
  for (const s of lane.steps) {
    if (s.state === "pending") out.push(s);
    // A required step that failed halts the lane: the steps after it were written assuming it
    // succeeded, and running them anyway produces failures that hide the real cause.
    if (s.state === "failed" && s.required !== false) break;
  }
  return out;
}

export function laneState(lane: Lane): StepState {
  const st = lane.steps.map((s) => s.state);
  if (st.some((s) => s === "failed")) return "failed";
  if (st.some((s) => s === "running")) return "running";
  if (st.every((s) => s === "ok" || s === "skipped")) return st.length ? "ok" : "pending";
  return "pending";
}

export interface LaneProgress {
  done: number;
  total: number;
  ratio: number;
  state: StepState;
  /** Wall-clock of the steps that have finished. */
  elapsedMs: number;
}

export function laneProgress(lane: Lane): LaneProgress {
  const total = lane.steps.length;
  const done = lane.steps.filter((s) => s.state === "ok" || s.state === "failed" || s.state === "skipped").length;
  // Only FINISHED steps contribute. A step carrying stale timestamps from an earlier attempt
  // (retried, or reset to pending) would otherwise inflate the lane's elapsed time with work
  // that is not part of this run.
  const FINISHED = new Set<StepState>(["ok", "failed", "skipped"]);
  const elapsedMs = lane.steps.reduce(
    (a, s) => a + (FINISHED.has(s.state) && s.startedMs && s.endedMs ? s.endedMs - s.startedMs : 0),
    0,
  );
  return { done, total, ratio: total ? Number((done / total).toFixed(4)) : 0, state: laneState(lane), elapsedMs };
}

const MARK: Record<StepState, string> = {
  pending: "·", running: "▶", ok: "✓", failed: "✗", skipped: "-",
};

/**
 * The conductor table.
 *
 * One row per lane, fixed width, redrawn on a timer — the operator watches this instead of
 * reading four scrolling tabs at once. Bars use block characters so progress is legible at a
 * glance without colour, which survives a copy-paste into a report.
 */
export function renderBoard(lanes: Lane[], now: number): string[] {
  const width = Math.max(8, ...lanes.map((l) => l.title.length));
  const rows = lanes.map((l) => {
    const p = laneProgress(l);
    const filled = Math.round(p.ratio * 20);
    const bar = "█".repeat(filled) + "░".repeat(20 - filled);
    const cur = l.steps.find((s) => s.state === "running");
    const secs = (p.elapsedMs / 1000).toFixed(1);
    return `  ${MARK[p.state]} ${l.title.padEnd(width)}  ${bar} ${String(p.done).padStart(2)}/${p.total}` +
      `  ${secs.padStart(6)}s  ${cur ? cur.title : p.state === "ok" ? "done" : p.state === "failed" ? "FAILED" : "idle"}`;
  });
  const all = lanes.flatMap((l) => l.steps);
  const done = all.filter((s) => s.state === "ok").length;
  const failed = all.filter((s) => s.state === "failed").length;
  return [
    `eCym board — ${lanes.length} lane · ${done}/${all.length} step ok${failed ? ` · ${failed} FAILED` : ""}`,
    `updated ${new Date(now).toISOString().slice(11, 19)}Z`,
    "",
    ...rows,
  ];
}

/** Overall verdict: one red lane fails the board — a partial green is not a green. */
export function boardVerdict(lanes: Lane[]): { ok: boolean; failedLanes: string[]; reason: string } {
  const failed = lanes.filter((l) => laneState(l) === "failed").map((l) => l.id);
  const unfinished = lanes.filter((l) => laneState(l) === "pending" || laneState(l) === "running").map((l) => l.id);
  return {
    ok: failed.length === 0 && unfinished.length === 0,
    failedLanes: failed,
    reason: failed.length
      ? `failed lanes: ${failed.join(", ")}`
      : unfinished.length
        ? `still running: ${unfinished.join(", ")}`
        : "all lanes green",
  };
}

/**
 * Build a lane from a list of `[title, command]` pairs.
 *
 * Ids are positional (`<lane>-01`) so a log line always maps back to a step even after the
 * titles are edited.
 */
export function makeLane(
  id: string,
  title: string,
  steps: Array<[string, string] | [string, string, { required?: boolean }]>,
): Lane {
  return {
    id,
    title,
    steps: steps.map(([t, cmd, opts], i) => ({
      id: `${id}-${String(i + 1).padStart(2, "0")}`,
      title: t,
      command: cmd,
      state: "pending" as StepState,
      ...(opts?.required === false ? { required: false } : {}),
    })),
  };
}
