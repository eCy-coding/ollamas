// Pool ledger (PURE): heartbeat intake, capability scoring, fleet projection.
// The fleet file (~/.ollamas/backends.json) is shared with humans and other
// tools — we only ever own the `contract:` prefixed entries (RISK-K3).
import type { Member, RegistryState } from "./registry.ts";
import { getMember } from "./registry.ts";
import { classifyFreshness, DEFAULT_STALE_MS, type Freshness } from "./heartbeat.ts";

export type HeartbeatInput = {
  ollamaUrl: string; // member's ollama endpoint as reachable from the operator (mesh/tunnel address)
  models: string[];
  load?: number; // 0..1 (optional self-reported)
  rpcPort?: number; // vK6: llama.cpp rpc-server port if the member runs one
};

export type PoolNode = {
  memberId: string;
  url?: string;
  ramGB: number;
  models: string[];
  freshness: Freshness;
  lastHeartbeat?: string;
  score: number;
  rpcPort?: number; // vK6: set when the member runs an rpc-server (shard candidate)
};

/** Priority slot for contract nodes in the fleet file: after hand-pinned
 * backends (e.g. windows-cuda=10) and before the local-Mac fallback (99). */
export const CONTRACT_FLEET_PRIORITY = 30;

export function recordHeartbeat(state: RegistryState, memberId: string, hb: HeartbeatInput, now: string): RegistryState {
  const m = getMember(state, memberId);
  if (!m) throw new Error(`member not found: ${memberId}`);
  if (m.status !== "active") throw new Error(`heartbeat requires active membership (is: ${m.status})`);
  let url: string;
  try {
    url = new URL(hb.ollamaUrl).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`invalid ollama url: ${hb.ollamaUrl}`);
  }
  const next: Member = {
    ...m,
    lastHeartbeat: now,
    capabilities: {
      models: (hb.models || []).map(String).filter(Boolean),
      ollamaUrl: url,
      rpcPort: hb.rpcPort,
      load: typeof hb.load === "number" && hb.load >= 0 && hb.load <= 1 ? hb.load : undefined,
    },
  };
  return { members: state.members.map((x) => (x.id === m.id ? next : x)) };
}

/** RAM-weighted, load-discounted score. Fresh gate applied by callers. */
export function capabilityScore(m: Member): number {
  const load = m.capabilities?.load ?? 0;
  return m.specs.ramGB * (1 - load);
}

export function poolNodes(state: RegistryState, nowMs: number, staleMs = DEFAULT_STALE_MS): PoolNode[] {
  const nodes = state.members
    .filter((m) => m.status === "active")
    .map((m): PoolNode => ({
      memberId: m.id,
      url: m.capabilities?.ollamaUrl,
      ramGB: m.specs.ramGB,
      models: m.capabilities?.models ?? [],
      freshness: classifyFreshness(m.lastHeartbeat, nowMs, staleMs),
      lastHeartbeat: m.lastHeartbeat,
      score: capabilityScore(m),
      rpcPort: m.capabilities?.rpcPort,
    }));
  const rank: Record<Freshness, number> = { fresh: 0, stale: 1, dead: 2 };
  return nodes.sort((a, b) => rank[a.freshness] - rank[b.freshness] || b.score - a.score);
}

/** Fleet projection: fresh active members with a URL, as backends.json entries.
 * vK4: ranked — poolNodes is already score-sorted, so the strongest node gets
 * the lowest priority number and selectFleetBackend tries it first. */
export function toFleetBackends(state: RegistryState, nowMs: number, staleMs = DEFAULT_STALE_MS): Array<{ name: string; url: string; priority: number }> {
  return poolNodes(state, nowMs, staleMs)
    .filter((n) => n.freshness === "fresh" && n.url)
    .map((n, i) => ({ name: `contract:${n.memberId}`, url: n.url as string, priority: CONTRACT_FLEET_PRIORITY + i }));
}

/** vK4 gateway quota (litellm principle): per-member request/day, enforced at
 * the OPERATOR gateway — member nodes are never trusted to self-limit.
 * UTC day rollover resets the counter (RISK-K2: caller persists the new state). */
export function consumeQuota(state: RegistryState, tenantId: string, todayUtc: string): RegistryState {
  const m = state.members.find((x) => x.tenantId === tenantId && x.status === "active");
  if (!m) throw new Error("no active membership for this key");
  const used = m.quota.dayUtc === todayUtc ? m.quota.usedToday : 0;
  if (used >= m.quota.reqPerDay) throw new Error(`quota exceeded: ${m.quota.reqPerDay}/day`);
  const next: Member = { ...m, quota: { ...m.quota, usedToday: used + 1, dayUtc: todayUtc } };
  return { members: state.members.map((x) => (x.id === m.id ? next : x)) };
}

/** Merge into an existing backends.json array: foreign entries untouched,
 * contract:* entries fully replaced by the current projection (RISK-K3). */
export function mergeFleetBackends(
  existing: unknown,
  contractBackends: Array<{ name: string; url: string; priority: number }>,
): Array<{ name: string; url: string; priority: number }> {
  const foreign = (Array.isArray(existing) ? existing : []).filter(
    (b: any) => b && typeof b === "object" && typeof b.name === "string" && !b.name.startsWith("contract:"),
  );
  return [...foreign, ...contractBackends];
}
