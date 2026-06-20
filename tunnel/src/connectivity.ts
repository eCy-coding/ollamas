// Connectivity classification (vT7): distinguish online / lan-only / offline so status (and later
// vT8 routing) knows whether internet-requiring transports (mesh/reverse) are even viable.
// Adoption (idea only): rwbutler/Connectivity (MIT) — reachability is not enough; probe a known
// endpoint to confirm real internet vs a captive portal.
//
// internetReachable probes a PUBLIC endpoint, so it deliberately BYPASSES the private-host guard
// (RISK-TUNNEL-021): this is a connectivity check, NOT a tunnel probe. classify() is PURE.

import { probeHttp } from "./health.ts";

export type Connectivity = "online" | "lan-only" | "offline";

/** PURE: combine LAN (a tunnel transport is healthy) + internet signals into a state. */
export function classify(signals: { lan: boolean; internet: boolean }): Connectivity {
  if (signals.internet) return "online";
  if (signals.lan) return "lan-only";
  return "offline";
}

export interface InternetProbeOptions {
  timeoutMs?: number;
  /** Default Apple captive-portal endpoint (returns 200 "Success" when internet is unproxied). */
  url?: string;
  fetchImpl?: typeof fetch;
}

/**
 * True if real internet is reachable (not just an interface up / captive portal).
 * Public endpoint → requirePrivateHost is intentionally NOT set (guard bypass, RISK-TUNNEL-021).
 */
export function internetReachable(opts: InternetProbeOptions = {}): Promise<boolean> {
  const { timeoutMs = 2000, url = "http://captive.apple.com/hotspot-detect.html", fetchImpl } = opts;
  return probeHttp(url, "", { timeoutMs, okStatuses: [200], fetchImpl });
}
