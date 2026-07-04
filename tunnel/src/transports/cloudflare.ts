// Cloudflare Tunnel REVERSE transport (vT13) — public reachability with ZERO inbound port.
// Adoption: cloudflare/cloudflared (Apache-2.0) → binary-invoke ONLY, no source copy.
//
// Two modes:
//  - quick tunnel  (default): `cloudflared tunnel --url http://127.0.0.1:<gw>` — NO account,
//    ephemeral https://<slug>.trycloudflare.com URL parsed from process output.
//  - named tunnel  (optional): stable hostname, needs one-time `cloudflared login`
//    (the ONLY manual step; documented honestly in recipes/cloudflare-tunnel.md).
//
// SECURITY (RISK-TUNNEL-024): up() HARD-REFUSES unless the proxy gateway has ≥1 active
// pxy_ key — a public URL in front of an open gateway would expose ollamas to the whole
// internet. This is a throw, never a warning. cloudflared terminates public TLS and dials
// the local gateway over loopback HTTP; the gateway enforces auth/ratelimit/allowlist.
//
// Exec + probe injected (headscale/breaker pattern) → fully testable without the binary.

import { spawn } from "node:child_process";
import type { Transport, TunnelEndpoint } from "../transport.ts";
import { PRIORITY } from "../transport.ts";
import { probeHttps, HEALTH_PATH } from "../health.ts";

/** Minimal child shape the transport needs — satisfied by node's ChildProcess and test fakes. */
export interface ChildLike {
  stderr: { on(event: "data", cb: (chunk: Buffer) => void): unknown } | null;
  stdout: { on(event: "data", cb: (chunk: Buffer) => void): unknown } | null;
  on(event: "error", cb: (err: Error) => void): unknown;
  on(event: "close", cb: (code: number | null) => void): unknown;
  kill(signal?: "SIGTERM" | "SIGKILL"): unknown;
}

export type SpawnFn = (cmd: string, args: string[]) => ChildLike;

/** PURE: extract the ephemeral quick-tunnel URL from a cloudflared output line. */
export function parseQuickTunnelUrl(line: string): string | null {
  // Anchored to end-of-host: slug subdomain of trycloudflare.com only (no attacker suffix).
  const m = line.match(/https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com(?![.\w-])/);
  return m ? m[0] : null;
}

/** PURE: quick-tunnel argv — loopback gateway target pinned, autoupdate off (daemon-safe). */
export function quickTunnelArgs(localPort: number): string[] {
  return ["tunnel", "--url", `http://127.0.0.1:${localPort}`, "--no-autoupdate"];
}

export interface NamedTunnelPlan {
  tunnelId: string;
  credFile: string;
  hostname: string;
  localPort: number;
}

/** PURE: named-tunnel config.yml — our hostname → local gateway, everything else 404. */
export function renderNamedConfig(plan: NamedTunnelPlan): string {
  return [
    `tunnel: ${plan.tunnelId}`,
    `credentials-file: ${plan.credFile}`,
    `ingress:`,
    `  - hostname: ${plan.hostname}`,
    `    service: http://127.0.0.1:${plan.localPort}`,
    `  - service: http_status:404`,
    ``,
  ].join("\n");
}

export interface CloudflareOptions {
  /** Local proxy-gateway port cloudflared forwards the public traffic to. */
  localPort: number;
  /** Auth-gate (RISK-TUNNEL-024): true iff the gateway vault has ≥1 active pxy_ key. */
  hasActiveKey: () => boolean;
  /** Injected spawn (tests); default node:child_process.spawn. */
  spawnFn?: SpawnFn;
  /** Injected probe (tests); default probeHttps (public URL = real TLS validation). */
  probeFn?: (base: string, path: string) => Promise<boolean>;
  /** How long up() waits for the quick-tunnel URL before failing. */
  timeoutMs?: number;
  /** Called with the parsed public URL (vT14) — persist it so status/whoami/iPhone find it. */
  urlSink?: (url: string) => void;
  /**
   * Dead-gateway guard (vT14, gap #1): probe the local gateway before exposing it. If provided and
   * it resolves false, up() refuses — a public tunnel to a dead :8443 gateway serves nobody.
   */
  gatewayHealthy?: () => Promise<boolean>;
}

export class CloudflareTransport implements Transport {
  readonly name = "cloudflare";
  readonly priority = PRIORITY.REVERSE;
  private healthy = false;
  private publicUrl = "";
  private child: ChildLike | null = null;
  private readonly localPort: number;
  private readonly hasActiveKey: () => boolean;
  private readonly spawnFn: SpawnFn;
  private readonly probeFn: (base: string, path: string) => Promise<boolean>;
  private readonly timeoutMs: number;
  private readonly urlSink: ((url: string) => void) | undefined;
  private readonly gatewayHealthy: (() => Promise<boolean>) | undefined;

  // Explicit fields — no TS parameter properties (ERR-TUNNEL-001, Node strip-only).
  constructor(opts: CloudflareOptions) {
    this.localPort = opts.localPort;
    this.hasActiveKey = opts.hasActiveKey;
    this.spawnFn = opts.spawnFn ?? ((cmd, args) => spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }));
    // Public edge roundtrip ≫ LAN: cold trycloudflare DNS+edge can take seconds — 10s budget.
    this.probeFn = opts.probeFn ?? ((base, path) => probeHttps(base, path, { timeoutMs: 10_000 }));
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.urlSink = opts.urlSink;
    this.gatewayHealthy = opts.gatewayHealthy;
  }

  /** Quick tunnel up. Idempotent. THROWS without an active pxy_ key (RISK-TUNNEL-024). */
  async up(): Promise<void> {
    if (this.child && this.publicUrl) return; // already up
    if (!this.hasActiveKey()) {
      throw new Error(
        "cloudflare: refusing to expose an UNAUTHENTICATED gateway to the public internet " +
          "(RISK-TUNNEL-024). Create a key first: `tunnel proxy key add <label>`.",
      );
    }
    // Dead-gateway guard (vT14): a public tunnel to a dead :8443 gateway serves nobody.
    if (this.gatewayHealthy && !(await this.gatewayHealthy())) {
      throw new Error(
        "cloudflare: gateway 127.0.0.1:8443 not answering — refusing REVERSE tunnel to a dead gateway. " +
          "Start it first: `tunnel proxy up` (or `tunnel proxy daemon install`).",
      );
    }
    const child = this.spawnFn("cloudflared", quickTunnelArgs(this.localPort));
    this.child = child;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        fail(new Error(`cloudflare: timed out after ${this.timeoutMs}ms waiting for the quick-tunnel URL`));
      }, this.timeoutMs);

      const fail = (err: Error): void => {
        clearTimeout(timer);
        this.child = null;
        this.publicUrl = "";
        reject(err);
      };
      const onData = (chunk: Buffer): void => {
        for (const line of chunk.toString().split("\n")) {
          const url = parseQuickTunnelUrl(line);
          if (url) {
            clearTimeout(timer);
            this.publicUrl = url;
            this.urlSink?.(url); // persist ephemeral URL (vT14) for status/whoami/iPhone
            resolve();
            return;
          }
        }
      };
      // cloudflared logs to stderr; watch stdout too (format has moved between versions).
      child.stderr?.on("data", onData);
      child.stdout?.on("data", onData);
      child.on("error", (err) => {
        const hint = /ENOENT/.test(err.message)
          ? "cloudflared not found — `brew install cloudflared`"
          : err.message;
        fail(new Error(hint));
      });
      child.on("close", (code) => {
        if (!this.publicUrl) fail(new Error(`cloudflare: cloudflared exited (${code ?? "?"}) before a URL appeared`));
      });
    });
  }

  /** Kill the cloudflared child. Idempotent. */
  async down(): Promise<void> {
    if (this.child) {
      try {
        this.child.kill("SIGTERM");
      } catch {
        // already dead
      }
    }
    this.child = null;
    this.publicUrl = "";
    this.healthy = false;
  }

  /** Real end-to-end probe: public URL → cloudflared edge → local gateway → ollamas. */
  async probe(): Promise<boolean> {
    if (!this.publicUrl) {
      this.healthy = false;
      return false;
    }
    this.healthy = await this.probeFn(this.publicUrl, HEALTH_PATH);
    return this.healthy;
  }

  endpoint(): TunnelEndpoint {
    return { url: this.publicUrl, transport: this.name, healthy: this.healthy };
  }
}
