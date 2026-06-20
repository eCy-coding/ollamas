// WireGuard key-rotation — PURE decisions + config render reuse (vT5).
// Best practice (Pro Custodibus / defguard / WireGuard paper): rotate every 90-180d; safe sequence
// generate → add new peer → verify → remove old; NEVER overlap AllowedIPs. Here rotation is
// age-based + automatic (0 manuel): needsRotation() decides, rotationPlan() renders fresh configs
// reusing the vT1 PURE renderers (so the /32 split-tunnel invariant is preserved).

import type { WgPlan, WgKeypair } from "./transports/wireguard.ts";
import { renderPeerConfig, renderServerConfig } from "./transports/wireguard.ts";

export const DEFAULT_MAX_AGE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface KeyMeta {
  /** Epoch ms when the current keys were generated. */
  createdAt: number;
  /** Monotonic rotation counter. */
  version: number;
}

/** PURE: is the key older than maxAgeDays as of `now`? */
export function needsRotation(meta: KeyMeta, now: number, maxAgeDays = DEFAULT_MAX_AGE_DAYS): boolean {
  return now - meta.createdAt >= maxAgeDays * DAY_MS;
}

/** PURE: days until rotation is due (0 if overdue). */
export function daysUntilRotation(meta: KeyMeta, now: number, maxAgeDays = DEFAULT_MAX_AGE_DAYS): number {
  const dueAt = meta.createdAt + maxAgeDays * DAY_MS;
  return Math.max(0, Math.ceil((dueAt - now) / DAY_MS));
}

export interface RotationOutput {
  serverConf: string;
  peerConf: string;
  meta: KeyMeta;
}

/**
 * PURE: render fresh server + peer configs from new keypairs, bumping meta.
 * AllowedIPs stay /32 (no overlap) because we reuse the vT1 renderers unchanged.
 */
export function rotationPlan(
  plan: WgPlan,
  newServer: WgKeypair,
  newPeer: WgKeypair,
  prev: KeyMeta,
  now: number,
): RotationOutput {
  return {
    serverConf: renderServerConfig(plan, newServer.privateKey, newPeer.publicKey),
    peerConf: renderPeerConfig(plan, newPeer.privateKey, newServer.publicKey),
    meta: { createdAt: now, version: prev.version + 1 },
  };
}
