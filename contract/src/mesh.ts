// Mesh-host discovery (vK14). Contract stays isolated from the tunnel lane
// (cannot import tunnel/src) — so we shell out to `tailscale ip -4` to learn this
// machine's mesh-reachable address. Works for both tailscale and headscale (same
// client, 100.64.0.0/10 CGNAT range). WireGuard / manual setups override via
// CONTRACT_RPC_HOST — that's the extension point for new transports.
//
// Only IP literals in the private/mesh range are accepted (isPrivateHost). We do
// NOT accept `<host>.local`: mDNS names can resolve off-mesh and the rpc-server
// binds/serves without auth (RISK-K1) — a routable name is a footgun.
import { execFileSync } from "node:child_process";
import { isPrivateHost } from "./shard.ts";

export type ExecFn = () => string;

const realExec: ExecFn = () => execFileSync("tailscale", ["ip", "-4"], { encoding: "utf8", timeout: 3000 });

/** Returns this machine's mesh IP, or undefined (caller falls back to loopback). */
export function detectMeshHost(opts: { exec?: ExecFn } = {}): string | undefined {
  const exec = opts.exec ?? realExec;
  // 1) tailscale/headscale assigned IP
  try {
    const first = exec().split("\n").map((l) => l.trim()).find(Boolean);
    if (first && isPrivateHost(first)) return first;
  } catch {
    // tailscale not installed / not up → fall through
  }
  // 2) explicit override (WireGuard / manual / custom transport)
  const env = (process.env.CONTRACT_RPC_HOST || "").trim();
  if (env && isPrivateHost(env)) return env;
  // 3) nothing reachable advertised → loopback (caller's default)
  return undefined;
}
