// Persistent per-machine node config (vK14) so a rebooted rpc daemon self-configures.
// Atomic tmp+rename, 0600 — mirrors state.ts. Corrupt/missing → defaults + warning
// (a config read must never crash the daemon; silent loss is not acceptable either).
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export type NodeRole = "member" | "operator";

export type NodeConfig = {
  meshHost?: string; // this machine's mesh-reachable address (100.64.x); undefined → loopback
  rpcPort: number;
  device?: string; // rpc-server --device (e.g. MTL0)
  role: NodeRole;
  model?: string; // preferred model to offer/serve
  serverUrl?: string; // operator: the ollamas pool server URL (0-manual, no per-run env)
  headLayers?: number; // operator: default shard head layer count
};

/** Operator/member resolve the pool server URL: explicit env > persisted config >
 * loopback default. Lets a configured operator run commands with no OLLAMAS_URL env. */
export function resolveServerUrl(loadFn: () => { config: NodeConfig } = () => loadNodeConfig()): string {
  return process.env.OLLAMAS_URL || loadFn().config.serverUrl || "http://127.0.0.1:3000";
}

export const DEFAULT_NODE_CONFIG: NodeConfig = { rpcPort: 50052, role: "member" };

export function defaultNodeConfigPath(): string {
  return process.env.CONTRACT_NODE_CONFIG || join(homedir(), ".ollamas", "contract-node.json");
}

export function loadNodeConfig(path = defaultNodeConfigPath()): { config: NodeConfig; warning?: string } {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { config: { ...DEFAULT_NODE_CONFIG } };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<NodeConfig>;
    if (!parsed || typeof parsed !== "object") {
      return { config: { ...DEFAULT_NODE_CONFIG }, warning: `corrupt node config at ${path}: not an object — using defaults` };
    }
    // fill gaps from defaults so an old/partial file still yields a complete config
    return { config: { ...DEFAULT_NODE_CONFIG, ...parsed } };
  } catch {
    return { config: { ...DEFAULT_NODE_CONFIG }, warning: `corrupt node config at ${path}: invalid JSON — using defaults` };
  }
}

export function saveNodeConfig(config: NodeConfig, path = defaultNodeConfigPath()): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, `.node-${randomBytes(4).toString("hex")}.tmp`);
  writeFileSync(tmp, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
  chmodSync(path, 0o600);
}
