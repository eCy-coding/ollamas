/**
 * orchestration/bin/lib/tracker-io.ts — thin IO shell for the live task tracker.
 *
 * The event log (`task-tracker.events.jsonl`) is the source of truth; `task-tracker.json` is a
 * derived state cache (atomic tmp+rename) so viewers get O(1) reads. Multiple producers (orchestra,
 * ecym via plain `echo >>`) may append concurrently — appends are line-atomic, and readers fall back
 * to a full replay when the cache is missing/stale. ORG_STATE_DIR seam isolates tests/sandbox.
 * Every write is tolerant: a tracker failure must never break a producer (conductor FSM contract).
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { applyEvent, type TrackerEvent, type TrackerState } from "./task-tracker";

const EVENTS_FILE = "task-tracker.events.jsonl";
const STATE_FILE = "task-tracker.json";

function stateDir(): string {
  return process.env.ORG_STATE_DIR || join(homedir(), ".ollamas");
}

/** Replay the whole event log (tolerant: bad lines skipped). Null when no events yet. */
export function replayEvents(dir = stateDir()): TrackerState | null {
  const p = join(dir, EVENTS_FILE);
  if (!existsSync(p)) return null;
  let state: TrackerState | null = null;
  try {
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { state = applyEvent(state, JSON.parse(line) as TrackerEvent); } catch { /* skip bad line */ }
    }
  } catch { /* tolerant */ }
  return state;
}

/** Append one event + refresh the state cache. Best-effort by contract. Returns the new state. */
export function emitEvent(ev: TrackerEvent, dir = stateDir()): TrackerState | null {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, EVENTS_FILE), JSON.stringify(ev) + "\n");
    const state = replayEvents(dir);
    if (state) {
      const tmp = join(dir, STATE_FILE + ".tmp");
      writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
      renameSync(tmp, join(dir, STATE_FILE));
    }
    return state;
  } catch { return null; }
}

/**
 * Read the current state. The cache is only trusted while it is at least as fresh as the event log —
 * shell producers (ecym) append events WITHOUT rewriting the cache, so a newer events file forces a
 * replay (otherwise `follow` would show a stale run).
 */
export function readTrackerState(dir = stateDir()): TrackerState | null {
  try {
    const cache = join(dir, STATE_FILE);
    const events = join(dir, EVENTS_FILE);
    if (existsSync(cache) && (!existsSync(events) || statSync(cache).mtimeMs >= statSync(events).mtimeMs)) {
      return JSON.parse(readFileSync(cache, "utf8")) as TrackerState;
    }
  } catch { /* fall through to replay */ }
  return replayEvents(dir);
}

/** Start a fresh run: truncate the event log (old run is over — a run boundary, not data loss:
 *  finished runs were already summarized to the brain ledger by their producer). */
export function resetRun(dir = stateDir()): void {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, EVENTS_FILE), "");
  } catch { /* best-effort */ }
}
