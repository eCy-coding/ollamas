// vT15: NAMED cloudflare tunnel — STABLE public URL (ollamas.<domain>), unlike the rotating
// quick tunnel (vT13). Two account-methods (both need a domain on Cloudflare):
//  - token (remotely-managed): `cloudflared tunnel run --token <TOKEN>`; ingress in the dash; no cert.pem.
//  - cli   (locally-managed):  login → create → route dns → local config.yml → `tunnel run <name>`.
//
// This file holds PURE parsers + argv builders (testable without the binary) + the Transport class
// (up/down/probe over an injected SpawnFn, reusing vT14 auth-gate + dead-gateway guard).
// Adoption: cloudflare/cloudflared (Apache-2.0), binary-invoke only.

import { spawn } from "node:child_process";
import type { Transport, TunnelEndpoint } from "../transport.ts";
import { PRIORITY } from "../transport.ts";
import { probeHttps, resolverLookup, HEALTH_PATH } from "../health.ts";
import type { ChildLike, SpawnFn } from "./cloudflare.ts";

/** PURE: extract tunnel UUID + credentials-file path from `cloudflared tunnel create` stdout. */
export function parseTunnelCreate(stdout: string): { id: string; credFile: string } | null {
  const idMatch = stdout.match(/with id ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  const credMatch = stdout.match(/written to (.+\.json)/);
  if (!idMatch?.[1] || !credMatch?.[1]) return null;
  return { id: idMatch[1], credFile: credMatch[1].replace(/\.$/, "") };
}

/** PURE: run a remotely-managed (token) tunnel — no cert.pem, ingress lives in the dash. */
export function tokenRunArgs(token: string): string[] {
  return ["tunnel", "run", "--token", token];
}

/** PURE: run a locally-managed tunnel by name (uses local config.yml). */
export function namedRunArgs(name: string): string[] {
  return ["tunnel", "run", name];
}

/** PURE: create a locally-managed tunnel (emits UUID + credentials json). */
export function createArgs(name: string): string[] {
  return ["tunnel", "create", name];
}

/** PURE: bind a DNS hostname to the tunnel (auto-creates the CNAME → <UUID>.cfargotunnel.com). */
export function routeDnsArgs(name: string, hostname: string): string[] {
  return ["tunnel", "route", "dns", name, hostname];
}

/** PURE: interactive browser login that writes ~/.cloudflared/cert.pem (pick a zone). */
export function loginArgs(): string[] {
  return ["tunnel", "login"];
}

export interface NamedOptions {
  /** Stable public host, e.g. ollamas.example.dev. */
  hostname: string;
  /** "token" (remotely-managed, no cert.pem) or "cli" (locally-managed, config.yml). */
  mode: "token" | "cli";
  /** Remotely-managed secret (mode "token"). */
  token?: string;
  /** Local tunnel name (mode "cli"). */
  tunnelName?: string;
  /** Auth-gate (RISK-TUNNEL-024): ≥1 active pxy_ key. */
  hasActiveKey: () => boolean;
  /** Dead-gateway guard (vT14): refuse if the local :8443 gateway is down. */
  gatewayHealthy?: () => Promise<boolean>;
  /** Injected spawn (tests); default node:child_process.spawn. */
  spawnFn?: SpawnFn;
  /** Injected probe (tests); default probeHttps with the 1.1.1.1 belt. */
  probeFn?: (base: string, path: string) => Promise<boolean>;
}

/**
 * Named cloudflare tunnel as a Transport — STABLE URL (https://<hostname>), preferred over the
 * rotating quick tunnel (priority REVERSE-1). Reuses the vT14 auth-gate + dead-gateway guard.
 */
export class NamedCloudflareTransport implements Transport {
  readonly name = "cloudflare-named";
  readonly priority = PRIORITY.REVERSE - 1; // 29 — preferred over quick (30) when configured
  private healthy = false;
  private child: ChildLike | null = null;
  private readonly hostname: string;
  private readonly mode: "token" | "cli";
  private readonly token: string | undefined;
  private readonly tunnelName: string | undefined;
  private readonly hasActiveKey: () => boolean;
  private readonly gatewayHealthy: (() => Promise<boolean>) | undefined;
  private readonly spawnFn: SpawnFn;
  private readonly probeFn: (base: string, path: string) => Promise<boolean>;

  // Explicit fields — no TS parameter properties (ERR-TUNNEL-001, Node strip-only).
  constructor(opts: NamedOptions) {
    this.hostname = opts.hostname;
    this.mode = opts.mode;
    this.token = opts.token;
    this.tunnelName = opts.tunnelName;
    this.hasActiveKey = opts.hasActiveKey;
    this.gatewayHealthy = opts.gatewayHealthy;
    this.spawnFn = opts.spawnFn ?? ((cmd, args) => spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }));
    // Public edge + resolve via 1.1.1.1 belt (RISK-TUNNEL-027) so it works despite MagicDNS.
    this.probeFn = opts.probeFn ?? ((base, path) => probeHttps(base, path, { timeoutMs: 10_000, lookup: resolverLookup() }));
  }

  private runArgs(): string[] {
    if (this.mode === "token") {
      if (!this.token) throw new Error("cloudflare-named: token mode requires a token");
      return tokenRunArgs(this.token);
    }
    if (!this.tunnelName) throw new Error("cloudflare-named: cli mode requires a tunnel name");
    return namedRunArgs(this.tunnelName);
  }

  async up(): Promise<void> {
    if (this.child) return; // already up
    if (!this.hasActiveKey()) {
      throw new Error(
        "cloudflare-named: refusing to expose an UNAUTHENTICATED gateway to the public internet " +
          "(RISK-TUNNEL-024). Create a key first: `tunnel proxy key add <label>`.",
      );
    }
    if (this.gatewayHealthy && !(await this.gatewayHealthy())) {
      throw new Error(
        "cloudflare-named: gateway 127.0.0.1:8443 not answering — refusing REVERSE tunnel to a dead gateway. " +
          "Start it first: `tunnel proxy up`.",
      );
    }
    this.child = this.spawnFn("cloudflared", this.runArgs());
    // Stable URL is known upfront — no stdout parse. cloudflared connects async; probe() confirms.
  }

  async down(): Promise<void> {
    if (this.child) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // already dead
      }
    }
    this.child = null;
    this.healthy = false;
  }

  async probe(): Promise<boolean> {
    this.healthy = await this.probeFn(`https://${this.hostname}`, HEALTH_PATH);
    return this.healthy;
  }

  endpoint(): TunnelEndpoint {
    return { url: `https://${this.hostname}`, transport: this.name, healthy: this.healthy };
  }
}
