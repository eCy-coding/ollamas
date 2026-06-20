// LAN-TLS transport — same-WiFi HTTPS to ollamas (TUNNEL_AGENTS.md §5).
// Adoption (binary-invoke only, no source copy):
//   caddyserver/caddy (Apache-2.0) — reverse_proxy localhost:3000 + TLS serve
//   FiloSottile/mkcert (BSD-3)      — local CA + per-host cert
// Highest priority (LAN_TLS=10): switch prefers this on home WiFi, falls back to WireGuard off-LAN.
//
// renderCaddyfile + hostname helpers are PURE (testable without caddy/mkcert installed).

import { spawn, execFileSync } from "node:child_process";
import type { Transport, TunnelEndpoint } from "../transport.ts";
import { PRIORITY } from "../transport.ts";
import { probeHttps } from "../health.ts";

export interface CaddyTlsPlan {
  /** Bonjour hostname clients hit, e.g. "emre-mbp.local". */
  host: string;
  /** ollamas HTTP port Caddy reverse-proxies to. */
  upstreamPort: number;
  /** mkcert-issued cert + key paths Caddy serves. */
  certPath: string;
  keyPath: string;
}

export const DEFAULT_TLS_PLAN: Omit<CaddyTlsPlan, "host"> = {
  upstreamPort: 3000,
  certPath: "keys/cert.pem",
  keyPath: "keys/key.pem",
};

/**
 * Resolve the Mac's Bonjour hostname → "<name>.local". macOS already advertises
 * this over mDNS, so an iPhone on the same WiFi resolves it with zero extra setup.
 * Falls back to "localhost" off macOS / on error.
 */
export function detectLocalHostname(
  exec: (cmd: string, args: string[]) => string = (c, a) =>
    execFileSync(c, a, { encoding: "utf8" }),
): string {
  try {
    const name = exec("scutil", ["--get", "LocalHostName"]).trim();
    return name ? `${name}.local` : "localhost";
  } catch {
    return "localhost";
  }
}

/** PURE: render a minimal Caddyfile reverse-proxying the host to ollamas over TLS. */
export function renderCaddyfile(plan: CaddyTlsPlan): string {
  return [
    `${plan.host} {`,
    `\treverse_proxy localhost:${plan.upstreamPort}`,
    `\ttls ${plan.certPath} ${plan.keyPath}`,
    `}`,
    "",
  ].join("\n");
}

/** URL the iPhone uses on the LAN. */
export function tlsServiceUrl(plan: CaddyTlsPlan): string {
  return `https://${plan.host}`;
}

export class CaddyTlsTransport implements Transport {
  readonly name = "caddy-tls";
  readonly priority = PRIORITY.LAN_TLS;
  private healthy = false;
  private readonly plan: CaddyTlsPlan;
  private readonly caddyfilePath: string;

  // Explicit fields — no TS parameter properties (ERR-TUNNEL-001, Node strip-only).
  constructor(plan: CaddyTlsPlan, caddyfilePath = "keys/Caddyfile") {
    this.plan = plan;
    this.caddyfilePath = caddyfilePath;
  }

  async up(): Promise<void> {
    // Binary-invoke: caller must have written the Caddyfile (cli.ts tls).
    await new Promise<void>((resolve, reject) => {
      const p = spawn("caddy", ["run", "--config", this.caddyfilePath, "--adapter", "caddyfile"], {
        stdio: "inherit",
      });
      p.on("error", reject);
      // caddy run blocks; treat spawn success as up. Caller manages lifecycle.
      setTimeout(resolve, 0);
    });
  }

  async down(): Promise<void> {
    await new Promise<void>((resolve) => {
      const p = spawn("caddy", ["stop"], { stdio: "inherit" });
      p.on("error", () => resolve());
      p.on("close", () => resolve());
    });
  }

  async probe(): Promise<boolean> {
    // Verified TLS: mkcert root CA is in the system trust store after `mkcert -install`.
    this.healthy = await probeHttps(tlsServiceUrl(this.plan), "/healthz");
    return this.healthy;
  }

  endpoint(): TunnelEndpoint {
    return { url: tlsServiceUrl(this.plan), transport: this.name, healthy: this.healthy };
  }
}
