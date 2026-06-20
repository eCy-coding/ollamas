// Headscale sovereign mesh transport — self-hosted Tailscale control plane (TUNNEL_AGENTS.md §5).
// Adoption: juanfont/headscale (BSD-3) → binary-invoke ONLY (`headscale serve`, `headscale ...`);
// no source copy. iOS side = official Tailscale app (App Store) pointed at OUR self-hosted
// coordination URL via "ALTERNATE COORDINATION SERVER URL" — zero Tailscale account (preauth keys,
// RISK-TUNNEL-009). Reuses the SAME WireGuard data plane as vT1, so runtime/code stays consistent.
// Embedded DERP gives sovereign NAT traversal (no Tailscale SaaS relays, RISK-TUNNEL-008).
//
// Config + command rendering is PURE (testable without headscale installed); serve spawns the binary.

import { spawn } from "node:child_process";
import type { Transport, TunnelEndpoint } from "../transport.ts";
import { PRIORITY } from "../transport.ts";
import { probeHttp } from "../health.ts";

export interface HeadscalePlan {
  /** Self-hosted coordination URL clients log in to, e.g. "https://emre-mbp.local:8080". */
  serverUrl: string;
  /** headscale HTTP listen address on the MacBook, e.g. "0.0.0.0:8080". */
  listenAddr: string;
  /** Tailnet IPv4 prefix headscale allocates from (CGNAT range). */
  ipPrefix: string;
  /** This node's mesh IP that serves ollamas, e.g. "100.64.0.1". */
  meshIp: string;
  /** ollamas HTTP port reached over the mesh. */
  servicePort: number;
  /** headscale user (namespace) that owns the nodes. */
  user: string;
}

export const DEFAULT_MESH_PLAN: HeadscalePlan = {
  serverUrl: "http://127.0.0.1:8080",
  listenAddr: "0.0.0.0:8080",
  ipPrefix: "100.64.0.0/10",
  meshIp: "100.64.0.1",
  servicePort: 3000,
  user: "ollamas",
};

/**
 * PURE: minimal sovereign headscale config.yaml (headscale 0.23+ schema).
 * sqlite + embedded DERP → fully self-hosted, no external account/relay (RISK-TUNNEL-008).
 */
export function renderHeadscaleConfig(plan: HeadscalePlan): string {
  return [
    `server_url: ${plan.serverUrl}`,
    `listen_addr: ${plan.listenAddr}`,
    `prefixes:`,
    `  v4: ${plan.ipPrefix}`,
    `  allocation: sequential`,
    `database:`,
    `  type: sqlite`,
    `  sqlite:`,
    `    path: ./keys/headscale.sqlite`,
    `noise:`,
    `  private_key_path: ./keys/noise_private.key`,
    // Embedded DERP = sovereign NAT traversal; no Tailscale SaaS relay.
    `derp:`,
    `  server:`,
    `    enabled: true`,
    `    region_id: 999`,
    `    region_code: ollamas`,
    `    stun_listen_addr: 0.0.0.0:3478`,
    `  urls: []`,
    `  paths: []`,
    `dns:`,
    `  base_domain: ollamas.mesh`,
    ``,
  ].join("\n");
}

/**
 * PURE: the `tailscale up` command a CLI client runs to join our self-hosted control plane.
 * iOS has no CLI → instead set `serverUrl` as the Tailscale app's "ALTERNATE COORDINATION
 * SERVER URL", then approve via `headscale nodes register` (see recipe). authKey defaults to a
 * placeholder so the command is safe to print without leaking a real preauth key.
 */
export function clientUpCommand(plan: HeadscalePlan, authKey = "<PREAUTH_KEY>"): string {
  return `tailscale up --login-server ${plan.serverUrl} --authkey ${authKey} --accept-routes`;
}

/** PURE: mint a reusable, zero-account preauth key (no Tailscale login required). */
export function preAuthKeyCommand(plan: HeadscalePlan): string {
  return `headscale preauthkeys create --user ${plan.user} --reusable --expiration 24h`;
}

/** PURE: create the owning user/namespace once. */
export function createUserCommand(plan: HeadscalePlan): string {
  return `headscale users create ${plan.user}`;
}

/** URL the iPhone uses to reach ollamas over the mesh overlay. */
export function serviceUrl(plan: HeadscalePlan): string {
  return `http://${plan.meshIp}:${plan.servicePort}`;
}

export class HeadscaleTransport implements Transport {
  readonly name = "headscale";
  readonly priority = PRIORITY.MESH;
  private healthy = false;
  private readonly plan: HeadscalePlan;
  private readonly configPath: string;

  // Explicit fields — no TS parameter properties (ERR-TUNNEL-001, Node strip-only).
  constructor(plan: HeadscalePlan, configPath = "keys/headscale.yaml") {
    this.plan = plan;
    this.configPath = configPath;
  }

  async up(): Promise<void> {
    // Binary-invoke only (headscale is BSD-3). Caller must have written the config (cli.ts mesh).
    await new Promise<void>((resolve, reject) => {
      const p = spawn("headscale", ["serve", "--config", this.configPath], { stdio: "inherit" });
      p.on("error", reject);
      // `headscale serve` blocks; treat spawn success as up. Caller manages lifecycle.
      setTimeout(resolve, 0);
    });
  }

  async down(): Promise<void> {
    // headscale has no `stop` subcommand → signal the serve process (best-effort).
    await new Promise<void>((resolve) => {
      const p = spawn("pkill", ["-f", "headscale serve"], { stdio: "ignore" });
      p.on("error", () => resolve());
      p.on("close", () => resolve());
    });
  }

  async probe(): Promise<boolean> {
    this.healthy = await probeHttp(serviceUrl(this.plan), "/healthz");
    return this.healthy;
  }

  endpoint(): TunnelEndpoint {
    return { url: serviceUrl(this.plan), transport: this.name, healthy: this.healthy };
  }
}
