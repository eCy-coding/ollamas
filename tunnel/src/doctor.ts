// `tunnel doctor` (vT10): a 0-manuel end-to-end self-test. The CLI probes the real ollamas upstream
// (localhost:3000/api/health), runs selectAuto, and classifies connectivity; this module holds the
// PURE report shape + renderer so it's testable without a live server. ok = ollamas is reachable
// (the thing every transport forwards to). If ollamas itself is down, no tunnel can possibly work.

import type { Connectivity } from "./connectivity.ts";

export interface ProxyDoctor {
  running: boolean; // gateway process answering on its port
  authRejects: boolean; // unauthenticated non-health request → 401 (RISK-TUNNEL-024 live check)
  authOkMs: number | null; // keyed /api/health roundtrip through the gateway, null if not run
}

export interface PublicTunnelDoctor {
  up: boolean; // quick tunnel came up (URL obtained)
  reachable: boolean; // public URL → edge → gateway → ollamas /api/health == 200
  ms: number | null; // public roundtrip, null if not reachable
}

export interface DoctorReport {
  ollamasUpstream: { url: string; reachable: boolean; ms: number };
  active: string | null; // selected transport, if any
  connectivity: Connectivity;
  capable: string[]; // transports whose binary is installed
  proxy?: ProxyDoctor; // vT12 gateway phase (absent when gateway not configured)
  publicTunnel?: PublicTunnelDoctor; // vT13 `doctor --full` cloudflare e2e (absent otherwise)
  ok: boolean; // true iff ollamas upstream is reachable
}

/** PURE: build the report (ok derived from upstream reachability). */
export function buildDoctorReport(input: Omit<DoctorReport, "ok">): DoctorReport {
  return { ...input, ok: input.ollamasUpstream.reachable };
}

/** PURE: human-readable doctor output. */
export function renderDoctorReport(r: DoctorReport): string {
  const up = r.ollamasUpstream;
  const lines = [
    `ollamas upstream : ${up.reachable ? `OK ${up.ms.toFixed(0)}ms` : "UNREACHABLE"}  (${up.url})`,
    `active transport : ${r.active ?? "none"}`,
    `connectivity     : ${r.connectivity}`,
    `capable transport: ${r.capable.length ? r.capable.join(", ") : "none (install wg-quick/caddy+mkcert/headscale)"}`,
    ...(r.proxy
      ? [
          `proxy gateway    : ${r.proxy.running ? "UP" : "DOWN"}`,
          `  401 without key: ${r.proxy.authRejects ? "OK" : "FAIL — gateway is OPEN, fix before exposing (RISK-TUNNEL-024)"}`,
          `  keyed ${"/api/health"}: ${r.proxy.authOkMs === null ? "not run" : `OK ${r.proxy.authOkMs.toFixed(0)}ms`}`,
        ]
      : []),
    ...(r.publicTunnel
      ? [
          `public tunnel    : ${r.publicTunnel.up ? "UP (cloudflare quick tunnel)" : "DOWN"}`,
          `  public /api/health: ${
            r.publicTunnel.reachable ? `OK ${(r.publicTunnel.ms ?? 0).toFixed(0)}ms` : "FAIL — edge up but end-to-end broken"
          }`,
        ]
      : []),
    "",
    r.ok
      ? "✓ ollamas is reachable — tunnels can forward to it."
      : "✗ ollamas upstream not reachable — start ollamas (npm run dev) before tunneling.",
  ];
  return lines.join("\n");
}
