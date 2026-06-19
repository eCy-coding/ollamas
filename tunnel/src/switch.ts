// The "switch": transport-agnostic selector. vT1 = probe-all + lowest-priority-healthy.
// Real failover/scoring/decision-log lands in vT5 (TUNNEL_ROADMAP).

import type { Transport, TunnelEndpoint } from "./transport.ts";

export class TunnelSwitch {
  private readonly transports: Transport[] = [];
  private active: Transport | null = null;

  /** Register a transport. Returns this for chaining. */
  register(t: Transport): this {
    this.transports.push(t);
    return this;
  }

  /** Registered transports sorted by priority (preferred first). */
  ordered(): Transport[] {
    return [...this.transports].sort((a, b) => a.priority - b.priority);
  }

  /**
   * Probe transports in priority order; first healthy becomes active and its
   * endpoint is returned. Returns null if none are healthy (or none registered).
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

  /** Currently selected endpoint, or null before a successful select(). */
  current(): TunnelEndpoint | null {
    return this.active ? this.active.endpoint() : null;
  }
}
