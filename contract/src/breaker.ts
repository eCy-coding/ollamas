// Circuit breaker + exponential backoff (vK16). Pattern re-implemented from
// tunnel/src/breaker.ts (lanes stay isolated — no cross-lane import). PURE,
// deterministic via an injected clock. Used by the member heartbeat daemon so a
// down operator server triggers backoff (not a launchd spin-restart) and by
// `contract watch` for member-liveness monitoring.
//
// closed:    normal; consecutive failures >= threshold → open.
// open:      canTry=false until cooldown elapses → half-open.
// half-open: allow ONE trial; success → closed, failure → open (cooldown restarts).

export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerOptions {
  failureThreshold?: number;
  cooldownMs?: number;
  now?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private halfOpen = false;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  constructor(opts: BreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  state(): BreakerState {
    if (this.failures < this.failureThreshold) return "closed";
    if (this.halfOpen) return "half-open";
    if (this.now() - this.openedAt >= this.cooldownMs) return "half-open";
    return "open";
  }

  canTry(): boolean {
    const s = this.state();
    if (s === "half-open") this.halfOpen = true;
    return s !== "open";
  }

  onSuccess(): void {
    this.failures = 0;
    this.halfOpen = false;
    this.openedAt = 0;
  }

  onFailure(): void {
    this.failures += 1;
    if (this.failures >= this.failureThreshold) {
      this.openedAt = this.now();
      this.halfOpen = false;
    }
  }
}

/** Exponential backoff with a hard ceiling: base * 2^attempt, clamped to max. */
export function backoffMs(attempt: number, base = 5_000, max = 300_000): number {
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(max, base * 2 ** n);
}
