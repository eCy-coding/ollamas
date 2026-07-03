// Heartbeat freshness classification (tunnel breaker-pattern, simplified):
// heartbeats are outbound-only from member machines (NAT-safe, RISK-K4).
export const DEFAULT_STALE_MS = 3 * 60_000; // no beat for 3min → stale (skip for scheduling)
export const DEFAULT_DEAD_MS = 30 * 60_000; // 30min → dead (surface in cockpit/doctor)

export type Freshness = "fresh" | "stale" | "dead";

export function classifyFreshness(
  lastHeartbeat: string | undefined,
  nowMs: number,
  staleMs = DEFAULT_STALE_MS,
  deadMs = DEFAULT_DEAD_MS,
): Freshness {
  const t = lastHeartbeat ? Date.parse(lastHeartbeat) : NaN;
  if (!Number.isFinite(t)) return "dead";
  const age = nowMs - t;
  if (age <= staleMs) return "fresh";
  if (age <= deadMs) return "stale";
  return "dead";
}
