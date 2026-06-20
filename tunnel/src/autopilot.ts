// Autopilot — ZERO manual selection / ZERO manual operation (vT4).
// Detects which transports are actually usable on this machine (their binary is on PATH),
// runs the switch's selectAuto (scoring + breaker + hysteresis), and brings the winner up
// automatically. runLoop() keeps re-selecting and self-heals. No human picks or runs anything.

import { spawn } from "node:child_process";
import type { Transport, TunnelEndpoint } from "./transport.ts";
import type { TunnelSwitch } from "./switch.ts";

/** Returns true if a transport can be operated here (binary present). Injectable for tests. */
export type CapabilityCheck = (t: Transport) => Promise<boolean> | boolean;

/** transport.name → the binary that must exist to bring it up. */
export const TRANSPORT_BINARY: Record<string, string> = {
  wireguard: "wg-quick",
  "caddy-tls": "caddy",
  headscale: "headscale",
};

/** True if `cmd` is on PATH (via `which`, never throws). */
export function commandExists(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn("which", [cmd], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("close", (code) => resolve(code === 0));
  });
}

/** Default capability check: the transport's mapped binary exists (unknown name → not capable). */
export const defaultCapability: CapabilityCheck = (t) => {
  const bin = TRANSPORT_BINARY[t.name];
  return bin ? commandExists(bin) : Promise.resolve(false);
};

/** Transports usable here, sorted by priority (preferred first). Pure given an injected check. */
export async function detectCapable(
  transports: Transport[],
  isCapable: CapabilityCheck = defaultCapability,
): Promise<Transport[]> {
  const flags = await Promise.all(transports.map(async (t) => [t, await isCapable(t)] as const));
  return flags
    .filter(([, ok]) => ok)
    .map(([t]) => t)
    .sort((a, b) => a.priority - b.priority);
}

export interface AutopilotResult {
  endpoint: TunnelEndpoint | null;
  broughtUp: string | null;
  capable: string[];
  reason: string;
}

export interface AutoUpOptions {
  isCapable?: CapabilityCheck;
  /** Actually call transport.up() (false = dry-run / test). Default true. */
  bringUp?: boolean;
}

/**
 * One autopilot pass: select the best healthy transport; if none is healthy, bring up the
 * best CAPABLE transport and re-select. Returns what happened — never throws, never prompts.
 */
export async function autoUp(
  sw: TunnelSwitch,
  transports: Transport[],
  opts: AutoUpOptions = {},
): Promise<AutopilotResult> {
  const isCapable = opts.isCapable ?? defaultCapability;
  const bringUp = opts.bringUp ?? true;

  const first = await sw.selectAuto();
  if (first) {
    return { endpoint: first, broughtUp: null, capable: [], reason: `already healthy: ${first.transport}` };
  }

  const capable = await detectCapable(transports, isCapable);
  const capableNames = capable.map((t) => t.name);
  const target = capable[0];
  if (!target) {
    return { endpoint: null, broughtUp: null, capable: [], reason: "no capable transport (install a binary)" };
  }
  if (bringUp) {
    try {
      await target.up();
    } catch {
      // up() failed (e.g. needs sudo/config) — report, don't crash the autopilot.
      return { endpoint: null, broughtUp: null, capable: capableNames, reason: `bring-up failed: ${target.name}` };
    }
  }
  const after = await sw.selectAuto();
  return {
    endpoint: after,
    broughtUp: bringUp ? target.name : null,
    capable: capableNames,
    reason: after ? `brought up ${target.name} → ${after.transport}` : `brought up ${target.name}, still unhealthy`,
  };
}

export interface RunLoopOptions extends AutoUpOptions {
  /** Number of passes. Default Infinity (CLI --watch). Tests pass a finite count. */
  rounds?: number;
  /** Delay between passes (ms). Default 15000. */
  intervalMs?: number;
  /** Injected sleep (test = noop). Default real setTimeout. */
  sleep?: (ms: number) => Promise<void>;
  /** Called after each pass with its result (e.g. logging). */
  onTick?: (r: AutopilotResult, round: number) => void;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Continuous self-heal: repeat autoUp, re-selecting and re-bringing-up on failure. */
export async function runLoop(
  sw: TunnelSwitch,
  transports: Transport[],
  opts: RunLoopOptions = {},
): Promise<AutopilotResult[]> {
  const rounds = opts.rounds ?? Infinity;
  const intervalMs = opts.intervalMs ?? 15_000;
  const sleep = opts.sleep ?? realSleep;
  const results: AutopilotResult[] = [];
  for (let i = 0; i < rounds; i++) {
    const r = await autoUp(sw, transports, opts);
    results.push(r);
    opts.onTick?.(r, i);
    if (i < rounds - 1) await sleep(intervalMs);
  }
  return results;
}
