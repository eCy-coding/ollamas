// Upstream federation supervisor (Faz 27, v1.18). Turns connect-once-at-boot into a
// resilient, observable federation: periodic health-check + exponential-backoff
// reconnect + a circuit-breaker, over MANY upstreams. Adopts the integrations-lane
// supervisor (v2.2), which re-implements the LibreChat MCP_CB_* circuit-breaker +
// IBM/mcp-context-forge backoff PATTERN (both idea-only). It does NOT open a second
// dispatch path — it drives the existing connectUpstream()/ToolRegistry choke-point.
//
// Tenant-isolation invariant (Faz 24): a supervised upstream remembers its `owner`
// (tenantId) and reconnect re-registers with that SAME owner — a reconnect must
// never silently demote a per-tenant tool to a shared (ownerless) one.
import { connectUpstream, pingUpstream, disconnectUpstream, type UpstreamConfig, type UpstreamResult } from "./client";
import { ToolRegistry } from "../tool-registry";

export type UpstreamState = "connected" | "degraded" | "down";

export interface SupervisedStatus {
  name: string;
  state: UpstreamState;
  tools: number;
  consecutiveFailures: number;
  cycles: number;
  circuitOpen: boolean;
  nextRetryAt: number;
  manifestChanges: number;
  reconnects: number;
  lastError?: string;
}

interface Supervised extends SupervisedStatus {
  cfg: UpstreamConfig;
  owner?: string; // tenantId — preserved across reconnects (Faz 24 isolation)
  /** Single-flight guard: an in-flight reconnect for THIS upstream, so two callers
   *  (e.g. overlapping ticks) racing on the same down upstream share one reconnect
   *  instead of spawning duplicate subprocesses. */
  connecting?: Promise<void>;
}

const supervised = new Map<string, Supervised>();
// rawToolName -> set of upstreams exposing it (cross-upstream collision surfacing).
const toolOwners = new Map<string, Set<string>>();
let timer: ReturnType<typeof setInterval> | null = null;
// Module-level guard: a tick still in flight (e.g. serially awaiting pingUpstream +
// reconnect across many upstreams) suppresses the next interval firing instead of
// stacking a second concurrent tickOnce() on top of it.
let ticking = false;

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const now = () => Date.now();

/** Deterministic exponential backoff (jitter is added separately at schedule time so
 *  this stays unit-testable). base * 2^(failures-1), capped at max. */
export function computeBackoff(failures: number): number {
  const base = num(process.env.MCP_CB_BASE_BACKOFF_MS, 1000);
  const max = num(process.env.MCP_CB_MAX_BACKOFF_MS, 30000);
  return Math.min(max, base * 2 ** Math.max(0, failures - 1));
}
const cooldown = () => num(process.env.MCP_CB_COOLDOWN_MS, 60000);
const maxCycles = () => num(process.env.MCP_CB_MAX_CYCLES, 5);

function recordTools(name: string, toolNames: string[] | undefined): void {
  for (const owners of toolOwners.values()) owners.delete(name); // drop this upstream's prior claims
  for (const raw of toolNames || []) {
    let owners = toolOwners.get(raw);
    if (!owners) toolOwners.set(raw, (owners = new Set()));
    owners.add(name);
  }
}

function applyResult(s: Supervised, r: UpstreamResult): void {
  if (r.ok) {
    s.state = "connected";
    s.tools = r.tools;
    s.consecutiveFailures = 0;
    s.cycles = 0;
    s.circuitOpen = false;
    s.nextRetryAt = 0;
    s.lastError = undefined;
    if (r.manifestChanged) s.manifestChanges++;
    recordTools(s.name, r.toolNames);
  } else {
    s.consecutiveFailures++;
    s.cycles++;
    s.lastError = r.error;
    schedule(s);
  }
}

/** Move a failing upstream to degraded (backoff) or open its circuit after MAX_CYCLES. */
function schedule(s: Supervised, t = now()): void {
  if (s.cycles >= maxCycles()) {
    s.circuitOpen = true;
    s.state = "down";
    s.nextRetryAt = t + cooldown();
  } else {
    s.state = "degraded";
    const jitter = Math.floor(Math.random() * computeBackoff(s.consecutiveFailures) * 0.2);
    s.nextRetryAt = t + computeBackoff(s.consecutiveFailures) + jitter;
  }
}

/** Register + connect an upstream under supervision. Idempotent per name. The `owner`
 *  (tenantId) is remembered so reconnects preserve tenant isolation (Faz 24). */
export async function superviseUpstream(cfg: UpstreamConfig, owner?: string): Promise<UpstreamResult> {
  let s = supervised.get(cfg.name);
  if (!s) {
    s = { name: cfg.name, cfg, owner, state: "down", tools: 0, consecutiveFailures: 0, cycles: 0, circuitOpen: false, nextRetryAt: 0, manifestChanges: 0, reconnects: 0 };
    supervised.set(cfg.name, s);
  }
  s.cfg = cfg;
  s.owner = owner;
  const r = await connectUpstream(cfg, owner);
  applyResult(s, r);
  return r;
}

/** Reconnect a supervised upstream: drop its stale tools, then reconnect + re-register
 *  with the SAME owner (tenant isolation preserved). */
async function doReconnect(s: Supervised): Promise<void> {
  ToolRegistry.unregisterByPrefix(`mcp__${s.cfg.name}__`);
  await disconnectUpstream(s.cfg.name);
  s.reconnects++;
  const r = await connectUpstream(s.cfg, s.owner);
  applyResult(s, r);
}

/** Single-flight wrapper around doReconnect: concurrent callers for the SAME upstream
 *  (e.g. two overlapping ticks racing a down upstream) share one in-flight reconnect
 *  instead of each spawning a fresh subprocess against the same target. */
function reconnect(s: Supervised): Promise<void> {
  s.connecting ??= doReconnect(s).finally(() => { s.connecting = undefined; });
  return s.connecting;
}

/** One supervision pass: ping healthy upstreams, retry due ones, re-arm open circuits. */
export async function tickOnce(t = now()): Promise<void> {
  for (const s of supervised.values()) {
    if (s.circuitOpen) {
      if (t >= s.nextRetryAt) { s.circuitOpen = false; s.cycles = 0; s.consecutiveFailures = 0; await reconnect(s); }
      continue;
    }
    if (s.state === "connected") {
      const ok = await pingUpstream(s.cfg.name);
      if (!ok) { s.consecutiveFailures = 1; s.cycles = 1; s.lastError = "health check failed"; schedule(s, t); }
    } else if (t >= s.nextRetryAt) {
      await reconnect(s);
    }
  }
}

/** Start the periodic health-check. Defaults to 30s — opt out with the explicit
 *  literal MCP_HEALTH_INTERVAL_MS="0" (any other/unset value uses the 30s default). */
export function startSupervisor(
  intervalMs = process.env.MCP_HEALTH_INTERVAL_MS === "0" ? 0 : num(process.env.MCP_HEALTH_INTERVAL_MS, 30000)
): void {
  if (timer || !(intervalMs > 0)) return;
  timer = setInterval(() => {
    if (ticking) return; // previous tick still running (many upstreams) — skip this firing
    ticking = true;
    void tickOnce().finally(() => { ticking = false; });
  }, intervalMs);
  if (typeof timer.unref === "function") timer.unref(); // never keep the process alive
}

/** Stop the supervisor (graceful shutdown; mirrors stopWebhookWorker). */
export function stopSupervisor(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Whether the periodic health-check loop is currently armed (tests). */
export function isSupervisorRunning(): boolean {
  return timer !== null;
}

export function getUpstreamStatus(): SupervisedStatus[] {
  return [...supervised.values()].map(({ cfg, owner, ...status }) => ({ ...status }));
}

/** Raw tool names exposed by more than one upstream (federation collisions). */
export function getCollisions(): { tool: string; upstreams: string[] }[] {
  const out: { tool: string; upstreams: string[] }[] = [];
  for (const [tool, owners] of toolOwners) if (owners.size > 1) out.push({ tool, upstreams: [...owners] });
  return out;
}

/** Stop supervising + forget an upstream (e.g. tenant deletes it). */
export async function removeUpstream(name: string): Promise<void> {
  supervised.delete(name);
  for (const owners of toolOwners.values()) owners.delete(name);
  ToolRegistry.unregisterByPrefix(`mcp__${name}__`);
  await disconnectUpstream(name);
}

/** Reset all supervisor state (tests). */
export function resetSupervisor(): void {
  stopSupervisor();
  ticking = false;
  supervised.clear();
  toolOwners.clear();
}
