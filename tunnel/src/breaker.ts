// Per-transport circuit breaker — PURE, deterministic (injected clock).
// Adoption (pattern only, no source copy): classic 3-state circuit breaker
// (closed → open → half-open) — TS circuit-breaker articles (dev.to/Resily, MIT pattern)
// + this repo's orchestration lane MCP_CB pattern. Prevents hammering a dead transport
// and gives a controlled recovery probe.
//
// closed:    normal; consecutive failures >= threshold → open.
// open:      reject (canTry=false) until cooldown elapses → half-open.
// half-open: allow ONE trial; success → closed, failure → open (cooldown restarts).

export type BreakerState = "closed" | "open" | "half-open";

export interface BreakerOptions {
  /** Consecutive failures in closed state that trip the breaker open. */
  failureThreshold?: number;
  /** Milliseconds the breaker stays open before allowing a half-open trial. */
  cooldownMs?: number;
  /** Injected clock (ms). Default Date.now — overridden in tests for determinism. */
  now?: () => number;
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private halfOpen = false;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;

  // Explicit fields — no TS parameter properties (ERR-TUNNEL-001, Node strip-only).
  constructor(opts: BreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 3;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  /** Current state, computed against the clock (open auto-transitions to half-open after cooldown). */
  state(): BreakerState {
    if (this.failures < this.failureThreshold) return "closed";
    if (this.halfOpen) return "half-open";
    if (this.now() - this.openedAt >= this.cooldownMs) return "half-open";
    return "open";
  }

  /** True if a probe/attempt is allowed now (closed or half-open). */
  canTry(): boolean {
    const s = this.state();
    if (s === "half-open") this.halfOpen = true; // latch: only one trial until resolved
    return s !== "open";
  }

  /** Record a successful probe → fully close. */
  onSuccess(): void {
    this.failures = 0;
    this.halfOpen = false;
    this.openedAt = 0;
  }

  /** Record a failed probe → count toward / restart the open window. */
  onFailure(): void {
    this.failures += 1;
    // Trip open (or re-trip from a failed half-open trial): stamp a fresh cooldown window.
    if (this.failures >= this.failureThreshold) {
      this.openedAt = this.now();
      this.halfOpen = false;
    }
  }
}
