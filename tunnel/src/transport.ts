// Tunnel/switch lane choke-point contract (TUNNEL_AGENTS.md §5).
// Every transport (WireGuard p2p, Caddy LAN-TLS, Headscale mesh, FRP reverse)
// implements this single interface; switch.ts stays transport-agnostic.

/** The only thing this lane exposes to clients (CLI / Shortcuts / iOS app). */
export interface TunnelEndpoint {
  /** Base URL clients hit to reach ollamas, e.g. "http://10.7.0.1:3000". */
  url: string;
  /** Which transport produced this endpoint. */
  transport: string;
  /** Last known health from probe(). */
  healthy: boolean;
}

/** Lower priority value = preferred. LAN-TLS(10) < mesh(20) < reverse-tunnel(30). */
export const PRIORITY = {
  LAN_TLS: 10,
  MESH: 20,
  REVERSE: 30,
} as const;

export interface Transport {
  /** Stable id, e.g. "wireguard", "caddy-tls". */
  readonly name: string;
  /** Selection priority; switch picks lowest healthy. */
  readonly priority: number;
  /** Bring the transport up (idempotent). May render config / spawn a binary. */
  up(): Promise<void>;
  /** Tear the transport down (idempotent). */
  down(): Promise<void>;
  /** True if ollamas is reachable through this transport right now. */
  probe(): Promise<boolean>;
  /** Current endpoint descriptor (url + cached health). */
  endpoint(): TunnelEndpoint;
}
