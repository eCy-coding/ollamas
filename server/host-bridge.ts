// Host-side macOS bridge client. Thin HTTP wrappers that drive the real host
// (iTerm2/Terminal.app, host exec, host file writes) via the bridge daemon.
// Extracted from server.ts (v1.8) so BOTH the HTTP app and the stdio entry point
// (bin/mcp-stdio.ts) share ONE bridge client — no duplicated signing/transport.
import path from "node:path";
import { signRequest } from "./bridge-hmac";
import { createSingleFlight } from "./lib/single-flight";

// Bridge host resolution is environment-dependent: Docker reaches the host at
// host.docker.internal, a local `tsx server.ts` reaches it at 127.0.0.1. The static
// default (host.docker.internal) is unreachable from a local boot → every macos_terminal/
// write_host_file got an instant "fetch failed". Mirror providers.ts ollama-host: try the
// configured URL first, then loopback, and CACHE the first base that actually answers.
const BRIDGE_CANDIDATES: string[] = [...new Set(
  [process.env.HOST_BRIDGE_URL, "http://127.0.0.1:7345", "http://host.docker.internal:7345"].filter(Boolean) as string[],
)];
let resolvedBridgeBase: string | null = null;

// concurrency-safety: N concurrent cold-start callers each ran the full candidate loop and raced the
// shared `resolvedBridgeBase` write. Single-flight the cold-start discovery so exactly ONE lightweight
// probe runs while the rest await it (behavior-preserving — every caller then targets the same base).
const baseSF = createSingleFlight();

/** Discover the reachable base with ONE cheap GET probe per candidate (any HTTP response = reachable,
 *  connection failure → next). Single-flighted so concurrent cold-start callers share one probe.
 *  Exported for tests (inject `fetchImpl`); production passes the global fetch. */
export async function resolveBridgeBase(candidates: string[], fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (resolvedBridgeBase) return resolvedBridgeBase;
  return baseSF.run("bridge-base", async () => {
    if (resolvedBridgeBase) return resolvedBridgeBase; // another caller resolved while we queued
    for (const base of candidates) {
      try { await fetchImpl(`${base}/`, { method: "GET", signal: AbortSignal.timeout(1500) }); resolvedBridgeBase = base; return base; }
      catch { /* unreachable → next candidate */ }
    }
    return null; // none reachable; the request loop below surfaces the real error
  });
}
/** Test hook: reset the cached base + in-flight probe between cases. */
export function _resetBridgeBaseForTest(): void { resolvedBridgeBase = null; }

// Fetch a bridge path, trying each candidate base until one is reachable (a network/DNS
// failure → next candidate; any HTTP response means reachable → cache it). Concurrent cold-start
// callers first share one single-flighted probe (resolveBridgeBase), then each sends its own request.
async function bridgeFetch(bridgePath: string, init: RequestInit): Promise<Response> {
  if (!resolvedBridgeBase) await resolveBridgeBase(BRIDGE_CANDIDATES).catch(() => {});
  const bases = resolvedBridgeBase
    ? [resolvedBridgeBase, ...BRIDGE_CANDIDATES.filter((b) => b !== resolvedBridgeBase)]
    : BRIDGE_CANDIDATES;
  let lastErr: unknown;
  for (const base of bases) {
    try {
      const res = await fetch(`${base}${bridgePath}`, init);
      resolvedBridgeBase = base; // answered (even non-2xx) → reachable; remember it
      return res;
    } catch (e) { lastErr = e; } // unreachable (DNS/connection) → try next candidate
  }
  throw lastErr ?? new Error("no reachable host bridge");
}

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
  const res = await bridgeFetch("/run", {
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
  const res = await bridgeFetch("/exec", {
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
  const res = await bridgeFetch("/write", {
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
