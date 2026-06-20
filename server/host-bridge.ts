// Host-side macOS bridge client. Thin HTTP wrappers that drive the real host
// (iTerm2/Terminal.app, host exec, host file writes) via the bridge daemon.
// Extracted from server.ts (v1.8) so BOTH the HTTP app and the stdio entry point
// (bin/mcp-stdio.ts) share ONE bridge client — no duplicated signing/transport.
import path from "node:path";
import { signRequest } from "./bridge-hmac";

const HOST_BRIDGE_URL = process.env.HOST_BRIDGE_URL || "http://host.docker.internal:7345";
const HOST_BRIDGE_TOKEN = process.env.HOST_BRIDGE_TOKEN || "";
const HOST_BRIDGE_HMAC_SECRET = process.env.HOST_BRIDGE_HMAC_SECRET || "";

// In dev (tsx on host) process.cwd() is the repo; in Docker, set HOST_TOOLS_DIR
// to the host repo's bin/host-bridge/tools (the container path would be wrong).
export const HOST_TOOLS_DIR = process.env.HOST_TOOLS_DIR || path.join(process.cwd(), "bin/host-bridge/tools");

// Single-quote-escape an argument for safe interpolation into a shell command.
export function shArg(s: string): string { return `'${String(s).replace(/'/g, `'\\''`)}'`; }

// Faz 20B (abort-to-host): combine the caller's cooperative-cancellation signal
// (ctx.abortSignal — fired on an MCP CancelledNotification) with the per-call
// timeout, so an aborted tool actually severs the host fetch instead of letting it
// run to its own timeout. AbortSignal.any is Node stdlib (18+); no new dep.
function combineSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
/** Test hook (Faz 20B) — exercise signal combining without a live bridge. */
export const combineSignalForTest = combineSignal;

// Auth headers for a bridge call: HMAC-SHA256 request signing when a secret is set
// (replay-protected), else the plain token (backward-compat, Faz 10E).
export function bridgeHeaders(bridgePath: string, body: string): Record<string, string> {
  if (HOST_BRIDGE_HMAC_SECRET) {
    const { signature, timestamp, nonce } = signRequest(HOST_BRIDGE_HMAC_SECRET, "POST", bridgePath, body);
    return { "x-bridge-signature": signature, "x-bridge-timestamp": timestamp, "x-bridge-nonce": nonce };
  }
  return HOST_BRIDGE_TOKEN ? { "X-Bridge-Token": HOST_BRIDGE_TOKEN } : {};
}

export async function runOnHostTerminal(target: string | undefined, command: string, timeoutMs = 45000, signal?: AbortSignal) {
  const body = JSON.stringify({ target: target || "iterm2", command, timeoutMs });
  const res = await fetch(`${HOST_BRIDGE_URL}/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bridgeHeaders("/run", body) },
    body,
    signal: combineSignal(signal, timeoutMs + 5000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Host terminal bridge error ${res.status}: ${err.error || ""}${err.hint ? " (" + err.hint + ")" : ""}`);
  }
  return res.json();
}

// Run a command directly on the host via the bridge /exec (no terminal mutex).
// Bridge tools execute on the HOST filesystem, so this must be the host path.
export async function execOnHost(command: string, timeoutMs = 95000, signal?: AbortSignal) {
  const body = JSON.stringify({ command, timeoutMs });
  const res = await fetch(`${HOST_BRIDGE_URL}/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bridgeHeaders("/exec", body) },
    body,
    signal: combineSignal(signal, timeoutMs + 5000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Host exec bridge error ${res.status}: ${err.error || ""}`);
  }
  return res.json();
}

// Write a file directly to the macOS host filesystem via the bridge (base64).
export async function writeHostFile(filePath: string, content: string, signal?: AbortSignal) {
  const body = JSON.stringify({ path: filePath, contentB64: Buffer.from(content || "", "utf8").toString("base64") });
  const res = await fetch(`${HOST_BRIDGE_URL}/write`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...bridgeHeaders("/write", body) },
    body,
    signal: combineSignal(signal, 20000),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Host write bridge error ${res.status}: ${err.error || ""}`);
  }
  return res.json();
}
