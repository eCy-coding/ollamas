// The "switch": transport-agnostic selector.
//   vT1: select()      = probe-all + lowest-priority-healthy (preserved, backward-compatible).
//   vT4: selectAuto()  = parallel TIMED probe + per-transport circuit breaker + latency scoring
//                        + anti-flap hysteresis + decision-log. Zero manual selection.

import type { Transport, TunnelEndpoint } from "./transport.ts";
import { CircuitBreaker, type BreakerOptions, type BreakerState } from "./breaker.ts";
import {
  chooseWithHysteresis,
  rank,
  type Candidate,
  type HysteresisOptions,
  type HysteresisState,
  EMPTY_HYSTERESIS,
} from "./scoring.ts";

/** Times a single probe. Injectable so tests supply deterministic latencies. */
export type TimeProbe = (t: Transport) => Promise<{ ok: boolean; ms: number }>;

async function realTimeProbe(t: Transport): Promise<{ ok: boolean; ms: number }> {
  const start = performance.now();
  const ok = await t.probe(); // never throws (health.ts contract)
  return { ok, ms: performance.now() - start };
}

export interface ScoreEntry {
  name: string;
  priority: number;
  healthy: boolean;
  latencyMs: number;
  breaker: BreakerState;
  score: number;
}

export interface DecisionRecord {
  ts: number;
  winner: string | null;
  switched: boolean;
  reason: string;
  scores: ScoreEntry[];
}

export interface SwitchOptions {
  breaker?: BreakerOptions;
  hysteresis?: HysteresisOptions;
  /** Injected clock for decision timestamps. Default Date.now. */
  now?: () => number;
}

export interface SelectAutoOptions {
  timeProbe?: TimeProbe;
}

export class TunnelSwitch {
  private readonly transports: Transport[] = [];
  private active: Transport | null = null;
  private readonly breakers = new Map<string, CircuitBreaker>();
  private hysteresis: HysteresisState = EMPTY_HYSTERESIS;
  private readonly decisionLog: DecisionRecord[] = [];
  private readonly breakerOpts: BreakerOptions;
  private readonly hysteresisOpts: HysteresisOptions;
  private readonly now: () => number;

  // Explicit fields — no TS parameter properties (ERR-TUNNEL-001, Node strip-only).
  constructor(opts: SwitchOptions = {}) {
    this.breakerOpts = opts.breaker ?? {};
    this.hysteresisOpts = opts.hysteresis ?? {};
    this.now = opts.now ?? Date.now;
  }

  /** Register a transport. Returns this for chaining. */
  register(t: Transport): this {
    this.transports.push(t);
    return this;
  }

  /** Registered transports sorted by priority (preferred first). */
  ordered(): Transport[] {
    return [...this.transports].sort((a, b) => a.priority - b.priority);
  }

  private breakerFor(name: string): CircuitBreaker {
    let b = this.breakers.get(name);
    if (!b) {
      b = new CircuitBreaker({ ...this.breakerOpts, now: this.now });
      this.breakers.set(name, b);
    }
    return b;
  }

  /**
   * vT1 behavior (preserved): probe in priority order, first healthy becomes active.
   * No scoring/breaker — kept for callers/tests relying on the original contract.
   */
  async select(): Promise<TunnelEndpoint | null> {
    for (const t of this.ordered()) {
      if (await t.probe()) {
        this.active = t;
        return t.endpoint();
      }
    }
    this.active = null;
    return null;
  }

  /**
   * vT4: autonomous selection. Probes all transports in parallel (timed), applies each
   * transport's circuit breaker, scores by measured latency + priority, and uses hysteresis
   * to avoid flapping. Appends a DecisionRecord. Returns the chosen endpoint or null.
   */
  async selectAuto(opts: SelectAutoOptions = {}): Promise<TunnelEndpoint | null> {
    const timeProbe = opts.timeProbe ?? realTimeProbe;

    const probed = await Promise.all(
      this.transports.map(async (t) => {
        const breaker = this.breakerFor(t.name);
        if (!breaker.canTry()) {
          // Breaker open → skip the probe entirely this round (disqualified).
          return { t, healthy: false, ms: Infinity, breakerOpen: true };
        }
        const { ok, ms } = await timeProbe(t);
        if (ok) breaker.onSuccess();
        else breaker.onFailure();
        return { t, healthy: ok, ms: ok ? ms : Infinity, breakerOpen: false };
      }),
    );

    const candidates: Candidate[] = probed.map((p) => ({
      name: p.t.name,
      priority: p.t.priority,
      latencyMs: p.ms,
      breakerOpen: p.breakerOpen,
      healthy: p.healthy,
    }));

    const choice = chooseWithHysteresis(
      this.active?.name ?? null,
      candidates,
      this.hysteresis,
      this.hysteresisOpts,
    );
    this.hysteresis = choice.state;

    const scored = rank(candidates);
    const scoreEntries: ScoreEntry[] = scored.map((s) => ({
      name: s.name,
      priority: s.priority,
      healthy: s.healthy,
      latencyMs: s.latencyMs,
      breaker: this.breakerFor(s.name).state(),
      score: s.score,
    }));

    this.decisionLog.push({
      ts: this.now(),
      winner: choice.winner,
      switched: choice.switched,
      reason: choice.reason,
      scores: scoreEntries,
    });

    this.active = choice.winner ? (this.transports.find((t) => t.name === choice.winner) ?? null) : null;
    return this.active ? this.active.endpoint() : null;
  }

  /** Append-only decision log (why each selection happened). */
  decisions(): DecisionRecord[] {
    return [...this.decisionLog];
  }

  /** Most recent decision, or null. */
  lastDecision(): DecisionRecord | null {
    return this.decisionLog.at(-1) ?? null;
  }

  /** Currently selected endpoint, or null before a successful select. */
  current(): TunnelEndpoint | null {
    return this.active ? this.active.endpoint() : null;
  }

  /** Name of the active transport, or null. */
  activeName(): string | null {
    return this.active?.name ?? null;
  }
}
