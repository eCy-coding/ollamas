// llama.cpp rpc-server shard-group orchestration (MIT, binary-adopt).
// Pure planning/arg-building + thin injectable process runtime (vK7).
// SECURITY (RISK-K1): rpc-server has NO auth/encryption — every bind and every
// endpoint MUST be loopback/private/mesh. Public addresses are refused outright.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { partitionLayers, fitsModel, DEFAULT_OVERHEAD, type Slice } from "./partition.ts";

export type RpcEndpoint = { host: string; port: number };

const PRIVATE_V4 = [
  /^127\./, // loopback
  /^10\./, // RFC1918
  /^192\.168\./, // RFC1918
  /^172\.(1[6-9]|2\d|3[01])\./, // RFC1918 172.16–31
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./, // CGNAT 100.64.0.0/10 (headscale/tailscale mesh)
];
// NOTE: 169.254/16 link-local is deliberately NOT private here — 169.254.169.254 is
// the cloud metadata endpoint (classic SSRF target) and link-local is never a
// legitimate mesh/rpc advertise address (mesh uses CGNAT or ULA).

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

/** Args for `rpc-server` on a member node. Explicit device matters: the
 * default can land on BLAS, which aborts on RMS_NORM (proven crash) —
 * pass MTL0/CPU explicitly when multiple rpc-servers share one machine. */
export function rpcServerArgs(opts: { host: string; port: number; memGB?: number; device?: string }): string[] {
  if (!isPrivateHost(opts.host)) throw new Error(`rpc-server must bind a private/mesh host, got: ${opts.host} (RISK-K1)`);
  assertPort(opts.port);
  const args = ["--host", opts.host, "--port", String(opts.port)];
  if (opts.device) args.push("--device", opts.device);
  if (opts.memGB && opts.memGB > 0) args.push("--mem", String(Math.floor(opts.memGB * 1024)));
  return args;
}

/** Args for the head `llama-server` that drives the shard group via --rpc.
 * -ngl defaults to 99: without offload the RPC devices sit idle and every
 * layer stays on the head's CPU — the split would be fake. */
export function shardServerArgs(opts: { modelPath: string; endpoints: RpcEndpoint[]; port: number; ctxSize?: number; gpuLayers?: number; tensorSplit?: string }): string[] {
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
    "-ngl", String(opts.gpuLayers ?? 99),
  ];
  if (opts.ctxSize && opts.ctxSize > 0) args.push("--ctx-size", String(opts.ctxSize));
  if (opts.tensorSplit) args.push("--tensor-split", opts.tensorSplit);
  return args;
}

export type ShardCandidate = { memberId: string; url: string; ramGB: number; rpcPort?: number };
export type ShardPlan = { endpoints: RpcEndpoint[]; slices: Slice[] };

/** Plan a shard group from pool nodes: rpc-capable nodes only, layer slices by
 * RAM (partition.ts). Endpoint hosts come from each member's ollama URL host.
 * When modelSizeGB is given, the pooled RAM must fit it (fitsModel guard) — a
 * plan that cannot hold the model is refused rather than crashing at load. */
export function planShardGroup(totalLayers: number, candidates: ShardCandidate[], modelSizeGB?: number): ShardPlan {
  const capable = candidates.filter((c) => c.rpcPort && c.rpcPort > 0);
  if (!capable.length) throw new Error("no rpc-capable nodes (members must heartbeat with rpcPort)");
  const endpoints = capable.map((c) => {
    const host = new URL(c.url).hostname;
    if (!isPrivateHost(host)) throw new Error(`rpc endpoint must be private/mesh, got: ${host} (RISK-K1)`);
    return { host, port: c.rpcPort as number };
  });
  if (modelSizeGB && modelSizeGB > 0 && !fitsModel(modelSizeGB, capable.map((c) => ({ id: c.memberId, ramGB: c.ramGB })))) {
    throw new Error(`pool RAM insufficient for a ${modelSizeGB}GB model (need ${(modelSizeGB * DEFAULT_OVERHEAD).toFixed(1)}GB across ${capable.length} node(s))`);
  }
  const slices = partitionLayers(totalLayers, capable.map((c) => ({ id: c.memberId, ramGB: c.ramGB })));
  return { endpoints, slices };
}

// --- vK7 runtime: pid files, spawn/stop (injectable), port probe, model resolve ---

export function shardDir(): string {
  return process.env.CONTRACT_SHARD_DIR || join(homedir(), ".ollamas", "shard");
}

export function pidFilePath(name: string): string {
  return join(shardDir(), `${name}.pid`);
}

export type ExecLike = (bin: string, args: string[], logPath: string) => number; // returns pid

export function startProcess(name: string, bin: string, args: string[], opts: { exec: ExecLike }): number {
  mkdirSync(shardDir(), { recursive: true });
  const pid = opts.exec(bin, args, join(shardDir(), `${name}.log`));
  writeFileSync(pidFilePath(name), `${pid}\n`, { mode: 0o600 });
  return pid;
}

/** Returns true if a pid file existed and kill was attempted; idempotent. */
export function stopProcess(name: string, opts: { kill: (pid: number) => boolean }): boolean {
  const path = pidFilePath(name);
  let pid: number;
  try {
    pid = Number(readFileSync(path, "utf8").trim());
  } catch {
    return false;
  }
  if (Number.isInteger(pid) && pid > 1) {
    try { opts.kill(pid); } catch { /* already dead */ }
  }
  rmSync(path, { force: true });
  return true;
}

export function listShardProcesses(): string[] {
  try {
    return readdirSync(shardDir()).filter((f) => f.endsWith(".pid")).map((f) => f.replace(/\.pid$/, ""));
  } catch {
    return [];
  }
}

/** TCP reachability probe — rpc-server speaks a binary protocol, connect is enough. */
export function probeRpcPort(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = connect({ host, port });
    const done = (ok: boolean) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs, () => done(false));
    sock.once("connect", () => done(true));
    sock.once("error", () => done(false));
  });
}

/** Ollama blobs are raw GGUF. Resolve "name[:tag]" via the manifest JSON's
 * application/vnd.ollama.image.model layer digest → blobs/sha256-<hex>.
 * Read-only reuse (llama-server mmaps the file); null when not found. */
export function resolveOllamaModelBlob(model: string, ollamaRoot = join(homedir(), ".ollama")): string | null {
  const [name, tag = "latest"] = model.split(":");
  const manifest = join(ollamaRoot, "models", "manifests", "registry.ollama.ai", "library", String(name), tag);
  try {
    const j = JSON.parse(readFileSync(manifest, "utf8")) as { layers?: Array<{ mediaType?: string; digest?: string }> };
    const layer = (j.layers || []).find((l) => l.mediaType === "application/vnd.ollama.image.model");
    const digest = layer?.digest; // "sha256:<hex>"
    if (!digest || !digest.startsWith("sha256:")) return null;
    const blob = join(ollamaRoot, "models", "blobs", `sha256-${digest.slice(7)}`);
    return existsSync(blob) ? blob : null;
  } catch {
    return null;
  }
}

/** Binary resolution: OLLAMAS_LLAMA_BIN_DIR → ~/.ollamas/bin → PATH (null). */
export function resolveShardBinary(name: "rpc-server" | "llama-server"): string {
  const dirs = [process.env.OLLAMAS_LLAMA_BIN_DIR, join(homedir(), ".ollamas", "bin")].filter(Boolean) as string[];
  for (const d of dirs) {
    const p = join(d, name);
    if (existsSync(p)) return p;
  }
  return name; // PATH fallback — capability gate reports if it is the RPC-less brew build
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
