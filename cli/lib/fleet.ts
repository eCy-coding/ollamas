// Pure supervisor decision logic for the fleet `up` command. Zero IO.
// All fetch/spawn/fs lives in commands/remote.ts — this file is unit-testable.
import { nextBackoff } from "./watch";
import { selectBackend } from "./remote";
import type { Backend, BackendProbe } from "./remote";

export interface FleetState {
  current: string | null; // URL of currently-serving backend (or null = none)
  attempt: number;        // consecutive all-down probe count (for backoff)
  lastSwitchMs: number;   // epoch ms of last backend switch (thrash-guard)
}

export type Transition =
  | { action: "stay" }
  | { action: "switch"; to: Backend }
  | { action: "wait"; delayMs: number }
  | { action: "stop"; reason: string };

// Pure decision function: given current state + live probes, what should the
// supervisor do next?
//
// Rules (in order):
// 1. Pick the best backend via selectBackend (priority-ordered, required models).
// 2. If no best exists → all-down → wait with exponential backoff (never stop).
// 3. If best.url === current → stay (no change needed).
// 4. If best differs but lastSwitch was < minDwellMs ago → thrash-guard wait.
// 5. Otherwise → switch to best.
//
// "stop" is reserved for explicit caller signals; transient outages → wait.
export function decideTransition(
  state: FleetState,
  pool: Backend[],
  probes: BackendProbe[],
  nowMs: number,
  opts?: { required?: string[]; minDwellMs?: number },
): Transition {
  const minDwellMs = opts?.minDwellMs ?? 10_000;
  const best = selectBackend(pool, probes, { required: opts?.required });

  // All backends down — keep retrying with backoff
  if (!best) {
    return { action: "wait", delayMs: nextBackoff(state.attempt, { jitter: false }) };
  }

  // Already on the best backend
  if (best.url === state.current) {
    return { action: "stay" };
  }

  // Thrash-guard: if we switched recently, hold until dwell expires
  const msSinceSwitch = nowMs - state.lastSwitchMs;
  if (state.lastSwitchMs > 0 && msSinceSwitch < minDwellMs) {
    return { action: "wait", delayMs: minDwellMs - msSinceSwitch };
  }

  return { action: "switch", to: best };
}
