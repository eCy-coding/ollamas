// WireGuard p2p transport — sovereign, zero-account (TUNNEL_AGENTS.md §6).
// Adoption: wireguard-tools (`wg`, `wg-quick`) is GPL-2.0 → we ONLY spawn the binary,
// never copy its source (RISK-TUNNEL-005). iOS side = WireGuard/wireguard-apple (MIT, App Store).
//
// Config rendering is PURE (testable without `wg` installed); keygen / up / down spawn the binary.

import { spawn } from "node:child_process";
import type { Transport, TunnelEndpoint } from "../transport.ts";
import { PRIORITY } from "../transport.ts";
import { probeHttp } from "../health.ts";

export interface WgKeypair {
  privateKey: string;
  publicKey: string;
}

export interface WgPlan {
  /** MacBook (server) WG address, default 10.7.0.1. */
  serverIp: string;
  /** iPhone (peer) WG address, default 10.7.0.2. */
  peerIp: string;
  /** /24 mask prefix used in Interface Address. */
  cidr: number;
  /** WireGuard UDP listen port on the MacBook. */
  listenPort: number;
  /** MacBook's reachable LAN/WAN address the iPhone dials, e.g. "192.168.1.42". */
  endpointHost: string;
  /** ollamas HTTP port reached over the tunnel. */
  servicePort: number;
}

export const DEFAULT_PLAN: Omit<WgPlan, "endpointHost"> = {
  serverIp: "10.7.0.1",
  peerIp: "10.7.0.2",
  cidr: 24,
  listenPort: 51820,
  servicePort: 3000,
};

/** Run `wg <args>`, resolve trimmed stdout. Rejects if binary missing / non-zero exit. */
function wg(args: string[], stdin?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("wg", args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", (e) =>
      reject(new Error(`wg not runnable (install: brew install wireguard-tools): ${e.message}`)),
    );
    p.on("close", (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(`wg ${args.join(" ")} exit ${code}: ${err.trim()}`)),
    );
    if (stdin !== undefined) {
      p.stdin.write(stdin);
      p.stdin.end();
    }
  });
}

/** Generate a WireGuard keypair via the binary. Private key never logged/committed. */
export async function genKeypair(): Promise<WgKeypair> {
  const privateKey = await wg(["genkey"]);
  const publicKey = await wg(["pubkey"], privateKey);
  return { privateKey, publicKey };
}

/** PURE: render the MacBook (server) wg0.conf. */
export function renderServerConfig(
  plan: WgPlan,
  serverPrivateKey: string,
  peerPublicKey: string,
): string {
  return [
    "[Interface]",
    `PrivateKey = ${serverPrivateKey}`,
    `Address = ${plan.serverIp}/${plan.cidr}`,
    `ListenPort = ${plan.listenPort}`,
    "",
    "[Peer]",
    "# iPhone",
    `PublicKey = ${peerPublicKey}`,
    `AllowedIPs = ${plan.peerIp}/32`,
    "",
  ].join("\n");
}

/**
 * PURE: render the iPhone (peer) config for WireGuard iOS app import.
 * AllowedIPs is the server WG IP /32 only — split tunnel, so the phone's normal
 * internet/LAN traffic is untouched; only ollamas goes over the tunnel.
 */
export function renderPeerConfig(
  plan: WgPlan,
  peerPrivateKey: string,
  serverPublicKey: string,
): string {
  return [
    "[Interface]",
    `PrivateKey = ${peerPrivateKey}`,
    `Address = ${plan.peerIp}/32`,
    "",
    "[Peer]",
    "# MacBook (ollamas host)",
    `PublicKey = ${serverPublicKey}`,
    `Endpoint = ${plan.endpointHost}:${plan.listenPort}`,
    `AllowedIPs = ${plan.serverIp}/32`,
    "PersistentKeepalive = 25",
    "",
  ].join("\n");
}

/** URL the iPhone uses to reach ollamas over the tunnel. */
export function serviceUrl(plan: WgPlan): string {
  return `http://${plan.serverIp}:${plan.servicePort}`;
}

export class WireGuardTransport implements Transport {
  readonly name = "wireguard";
  readonly priority = PRIORITY.MESH;
  private healthy = false;
  private readonly plan: WgPlan;
  private readonly iface: string;

  // NOTE: explicit fields (no TS parameter properties) — Node strip-only mode
  // rejects `constructor(private x)` (ERR-TUNNEL-001).
  constructor(plan: WgPlan, iface = "wg0") {
    this.plan = plan;
    this.iface = iface;
  }

  async up(): Promise<void> {
    // Binary-invoke only (wg-quick is GPL). Caller must have written the iface conf.
    await new Promise<void>((resolve, reject) => {
      const p = spawn("wg-quick", ["up", this.iface], { stdio: "inherit" });
      p.on("error", reject);
      p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`wg-quick up exit ${c}`))));
    });
  }

  async down(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const p = spawn("wg-quick", ["down", this.iface], { stdio: "inherit" });
      p.on("error", reject);
      p.on("close", (c) => (c === 0 ? resolve() : reject(new Error(`wg-quick down exit ${c}`))));
    });
  }

  async probe(): Promise<boolean> {
    // requirePrivateHost: only probe the private WG address (DNS-rebind guard, vT5).
    this.healthy = await probeHttp(serviceUrl(this.plan), "/healthz", { requirePrivateHost: true });
    return this.healthy;
  }

  endpoint(): TunnelEndpoint {
    return { url: serviceUrl(this.plan), transport: this.name, healthy: this.healthy };
  }
}
