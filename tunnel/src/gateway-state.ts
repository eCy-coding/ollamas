// vT14: gateway-state — a tiny secret-free JSON file the gateway/cloudflare-transport writes so
// `tunnel status`, whoami and the operator can find the LIVE gateway status + ephemeral public URL
// (quick-tunnel URL rotates each restart; surfacing it is the honesty answer to that friction).
//
// Pure render + injected IO (keystore N-013 graceful pattern): a missing/corrupt file never throws.
// Contains NO secret — only running flag, public URL, timestamp.

import { writeFileSync, readFileSync } from "node:fs";

export interface GatewayState {
  running: boolean;
  publicUrl: string | null; // ephemeral cloudflare URL, or null (LAN/mesh only, or down)
  ts: number; // ms epoch of last write
}

export type WriteImpl = (path: string, data: string) => void;
export type ReadImpl = (path: string) => string;

const defaultWrite: WriteImpl = (path, data) => writeFileSync(path, data, { mode: 0o644 });
const defaultRead: ReadImpl = (path) => readFileSync(path, "utf8");

/** Persist state as pretty JSON (0644 — non-secret, readable by status/whoami). */
export function writeGatewayState(path: string, state: GatewayState, write: WriteImpl = defaultWrite): void {
  write(path, JSON.stringify(state, null, 2));
}

/** Read state → object, or null on any failure (missing / corrupt). Never throws. */
export function readGatewayState(path: string, read: ReadImpl = defaultRead): GatewayState | null {
  try {
    const obj = JSON.parse(read(path)) as GatewayState;
    if (typeof obj.running !== "boolean") return null;
    return obj;
  } catch {
    return null;
  }
}

/** PURE: human-readable one-liner for status/doctor. */
export function renderGatewayState(s: GatewayState): string {
  if (!s.running) return "gateway: DOWN";
  return s.publicUrl ? `gateway: running  ·  public: ${s.publicUrl}` : "gateway: running (LAN/mesh only — no public URL)";
}
