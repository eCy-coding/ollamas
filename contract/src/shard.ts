// llama.cpp rpc-server shard-group orchestration (MIT, binary-adopt).
// PURE planning/arg-building here; process spawning stays operator-side (CLI).
// SECURITY (RISK-K1): rpc-server has NO auth/encryption — every bind and every
// endpoint MUST be loopback/private/mesh. Public addresses are refused outright.
import { partitionLayers, type Slice } from "./partition.ts";

export type RpcEndpoint = { host: string; port: number };

const PRIVATE_V4 = [
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918 172.16–31
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10 (headscale/tailscale mesh)
  /^169\.254\./, // link-local
];

export function isPrivateHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (!h || h === "0.0.0.0" || h === "::") return false; // wildcard = public exposure
  if (h === "localhost" || h === "::1") return true;
  if (PRIVATE_V4.some((re) => re.test(h))) return true;
  if (/^(fc|fd)[0-9a-f]{2}:/.test(h)) return true; // IPv6 ULA (mesh)
  if (/^fe80:/.test(h)) return true; // IPv6 link-local
  return false;
}

function assertPort(port: number): void {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`invalid port: ${port}`);
}

/** Args for `rpc-server` on a member node. */
export function rpcServerArgs(opts: { host: string; port: number; memGB?: number }): string[] {
  if (!isPrivateHost(opts.host)) throw new Error(`rpc-server must bind a private/mesh host, got: ${opts.host} (RISK-K1)`);
  assertPort(opts.port);
  const args = ["--host", opts.host, "--port", String(opts.port)];
  if (opts.memGB && opts.memGB > 0) args.push("--mem", String(Math.floor(opts.memGB * 1024)));
  return args;
}

/** Args for the head `llama-server` that drives the shard group via --rpc. */
export function shardServerArgs(opts: { modelPath: string; endpoints: RpcEndpoint[]; port: number; ctxSize?: number }): string[] {
  if (!opts.endpoints.length) throw new Error("at least one rpc endpoint required");
  for (const e of opts.endpoints) {
    if (!isPrivateHost(e.host)) throw new Error(`rpc endpoint must be private/mesh, got: ${e.host} (RISK-K1)`);
    assertPort(e.port);
  }
  assertPort(opts.port);
  const args = [
    "--model", opts.modelPath,
    "--rpc", opts.endpoints.map((e) => `${e.host}:${e.port}`).join(","),
    "--host", "127.0.0.1", // head serves loopback only; exposure goes through the gateway
    "--port", String(opts.port),
  ];
  if (opts.ctxSize && opts.ctxSize > 0) args.push("--ctx-size", String(opts.ctxSize));
  return args;
}

export type ShardCandidate = { memberId: string; url: string; ramGB: number; rpcPort?: number };
export type ShardPlan = { endpoints: RpcEndpoint[]; slices: Slice[] };

/** Plan a shard group from pool nodes: rpc-capable nodes only, layer slices by
 * RAM (partition.ts). Endpoint hosts come from each member's ollama URL host. */
export function planShardGroup(totalLayers: number, candidates: ShardCandidate[]): ShardPlan {
  const capable = candidates.filter((c) => c.rpcPort && c.rpcPort > 0);
  if (!capable.length) throw new Error("no rpc-capable nodes (members must heartbeat with rpcPort)");
  const endpoints = capable.map((c) => {
    const host = new URL(c.url).hostname;
    if (!isPrivateHost(host)) throw new Error(`rpc endpoint must be private/mesh, got: ${host} (RISK-K1)`);
    return { host, port: c.rpcPort as number };
  });
  const slices = partitionLayers(totalLayers, capable.map((c) => ({ id: c.memberId, ramGB: c.ramGB })));
  return { endpoints, slices };
}

/** Honest capability gate (tunnel autopilot pattern): sharding needs llama.cpp
 * built WITH the RPC backend — stock brew bottles ship without it. */
export function detectShardCapability(found: { "llama-server": boolean; "rpc-server": boolean; rpcFlag: boolean }): {
  capable: boolean;
  missing: string[];
  hint: string;
} {
  const missing: string[] = [];
  if (!found["llama-server"]) missing.push("llama-server");
  if (!found["rpc-server"]) missing.push("rpc-server");
  if (found["llama-server"] && !found.rpcFlag) missing.push("llama-server --rpc flag");
  return {
    capable: missing.length === 0,
    missing,
    hint: missing.length
      ? "build llama.cpp with RPC: cmake -B build -DGGML_RPC=ON && cmake --build build (brew bottle ships WITHOUT GGML_RPC)"
      : "",
  };
}
