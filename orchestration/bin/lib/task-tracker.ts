/**
 * orchestration/bin/lib/task-tracker.ts — PURE live-progress model (the Claude-Code-style UX for
 * ollamas/ecym tasks: a status line like "Ledger swap yapılıyor… (4m 56s · ↓ 18.7k tokens)", a live
 * ◼/◻ checklist that re-renders when the task set changes, and a deterministic thinking spinner).
 *
 * Event-sourced: producers (orchestra, ecym, any CLI) append events; `applyEvent` folds them into a
 * TrackerState; renderers turn state + an injected `now` into terminal frames. No IO, no clocks,
 * no Math.random — same discipline as organization.ts/hierarchy.ts (fully unit-testable).
 */

export type ItemStatus = "pending" | "active" | "done" | "failed";

export interface TrackerItem { id: string; label: string; status: ItemStatus; }

export interface TrackerState {
  runId: string;
  title: string;
  source: "ollamas" | "ecym" | "orchestra";
  startedAt: string;
  updatedAt: string;
  items: TrackerItem[];
  tokensOut: number;
  /** The headline verb-phrase shown in the status line (e.g. "Ledger swap yapılıyor"). */
  note: string;
  phase: string;
  finished: boolean;
}

export type TrackerEvent =
  | { type: "start"; ts: string; runId: string; title: string; source: TrackerState["source"]; items?: Array<{ id: string; label: string }> }
  | { type: "items"; ts: string; runId?: string; items: Array<{ id: string; label: string }> }
  | { type: "item"; ts: string; runId?: string; id: string; status: ItemStatus; label?: string }
  | { type: "tokens"; ts: string; runId?: string; n: number }
  | { type: "note"; ts: string; runId?: string; note: string; phase?: string }
  | { type: "finish"; ts: string; runId?: string };

export function startRun(
  title: string, source: TrackerState["source"],
  items: Array<{ id: string; label: string }>, ts: string, runId = `${source}-${ts}`,
): TrackerState {
  return {
    runId, title, source, startedAt: ts, updatedAt: ts,
    items: items.map((i) => ({ ...i, status: "pending" as const })),
    tokensOut: 0, note: title, phase: "", finished: false,
  };
}

/**
 * Live task-change: replace the item SET while PRESERVING the status of items whose id survives
 * (done stays done, active stays active); brand-new ids arrive as pending; dropped ids disappear.
 */
export function setItems(s: TrackerState, items: Array<{ id: string; label: string }>, ts: string): TrackerState {
  const prev = new Map(s.items.map((i) => [i.id, i.status]));
  return {
    ...s, updatedAt: ts,
    items: items.map((i) => ({ id: i.id, label: i.label, status: prev.get(i.id) ?? "pending" })),
  };
}

export function updateItem(s: TrackerState, id: string, status: ItemStatus, ts: string, label?: string): TrackerState {
  const exists = s.items.some((i) => i.id === id);
  const items = exists
    ? s.items.map((i) => (i.id === id ? { ...i, status, ...(label ? { label } : {}) } : i))
    : [...s.items, { id, label: label ?? id, status }];
  return { ...s, items, updatedAt: ts };
}

export function addTokens(s: TrackerState, n: number, ts: string): TrackerState {
  return Number.isFinite(n) && n > 0 ? { ...s, tokensOut: s.tokensOut + Math.round(n), updatedAt: ts } : s;
}

export function setNote(s: TrackerState, note: string, ts: string, phase?: string): TrackerState {
  return { ...s, note, updatedAt: ts, ...(phase != null ? { phase } : {}) };
}

export function finishRun(s: TrackerState, ts: string): TrackerState {
  return { ...s, finished: true, updatedAt: ts };
}

/** Fold one event into state. `state=null` only accepts a "start"; other events on null fold into a
 *  placeholder run (tolerant replay — a truncated log must never crash the viewer). A non-start event
 *  STAMPED with a runId that does not match the current run is DROPPED — concurrent producers (daemon
 *  vs manual tick vs ecym) must not cross-pollute each other's runs. Unstamped events keep the old
 *  last-run semantics (shell producers). */
export function applyEvent(state: TrackerState | null, ev: TrackerEvent): TrackerState {
  if (ev.type === "start") return startRun(ev.title, ev.source, ev.items ?? [], ev.ts, ev.runId);
  if (state && ev.runId && ev.runId !== state.runId) return state; // stale producer — drop
  const s = state ?? startRun("(unknown run)", "ollamas", [], ev.ts);
  switch (ev.type) {
    case "items": return setItems(s, ev.items, ev.ts);
    case "item": return updateItem(s, ev.id, ev.status, ev.ts, ev.label);
    case "tokens": return addTokens(s, ev.n, ev.ts);
    case "note": return setNote(s, ev.note, ev.ts, ev.phase);
    case "finish": return finishRun(s, ev.ts);
  }
}

// ── Rendering (deterministic; `now` injected) ────────────────────────────────────────────────────

export function fmtElapsed(startIso: string, now: Date): string {
  const sec = Math.max(0, Math.floor((now.getTime() - Date.parse(startIso)) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60), r = sec % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function fmtTokens(n: number): string {
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(1)}M`;
}

const SPINNER_VERBS = [
  "Shimmying", "Percolating", "Conducting", "Marinating", "Noodling", "Brewing", "Weaving", "Humming",
];

/** Deterministic verb rotation (one verb per 10s window — no Math.random, replay-stable). */
export function spinnerVerb(elapsedSec: number): string {
  return SPINNER_VERBS[Math.floor(Math.max(0, elapsedSec) / 10) % SPINNER_VERBS.length];
}

const GLYPH: Record<ItemStatus, string> = { pending: "◻", active: "◼", done: "✔", failed: "✖" };
const C = { reset: "\x1b[0m", cyan: "\x1b[36m", green: "\x1b[32m", red: "\x1b[31m", dim: "\x1b[2m" };
const COLOR: Record<ItemStatus, string> = { pending: C.dim, active: C.cyan, done: C.green, failed: C.red };

export function renderStatusLine(s: TrackerState, now: Date): string {
  const tok = s.tokensOut > 0 ? ` · ↓ ${fmtTokens(s.tokensOut)} tokens` : "";
  const head = s.finished ? "✅" : "⏺";
  return `${head} ${s.note}… (${fmtElapsed(s.startedAt, now)}${tok})`;
}

export function renderChecklist(s: TrackerState, color = false): string[] {
  return s.items.map((i) => {
    const line = `${GLYPH[i.status]} ${i.label}`;
    return color ? `${COLOR[i.status]}${line}${C.reset}` : line;
  });
}

/** One full terminal frame: status line + checklist + (while unfinished) the thinking spinner. */
export function renderFrame(s: TrackerState, now: Date, opts?: { color?: boolean }): string {
  const color = opts?.color ?? false;
  const elapsedSec = Math.floor((now.getTime() - Date.parse(s.startedAt)) / 1000);
  const lines = [renderStatusLine(s, now), ...renderChecklist(s, color)];
  if (!s.finished) {
    const spin = `${spinnerVerb(elapsedSec)}… (${fmtElapsed(s.updatedAt, now)} · ${s.phase || "thinking"})`;
    lines.push(color ? `${C.dim}${spin}${C.reset}` : spin);
  }
  return lines.join("\n");
}
