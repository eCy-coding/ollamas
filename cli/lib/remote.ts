// Pure-core logic for `ollamas remote check` + fleet pool. Zero IO — fully unit-testable.
import { c } from "./output";
import type { OutputCtx } from "./output";

// ---------------------------------------------------------------------------
// Fleet pool types + pure functions
// ---------------------------------------------------------------------------

export interface Backend {
  name: string;
  url: string;
  priority: number; // ascending — 1 is tried first
}

export interface BackendProbe {
  url: string;
  reachable: boolean;
  mode?: string;
  models: string[];
  // Inference liveness: undefined = not yet generate-tested (eligible);
  // false = /api/generate proven dead/hung (skip — the desktop-ert7724 case:
  // /api/tags OK but generate hangs); true = generate verified responsive.
  responsive?: boolean;
}

// Validate, coerce, sort ascending by priority, dedupe by url.
export function parseBackendPool(raw: any): Backend[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const valid: Backend[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const name = typeof item.name === "string" && item.name ? item.name : null;
    const url = typeof item.url === "string" && item.url ? item.url : null;
    if (!name || !url) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    const priority = typeof item.priority === "number" && isFinite(item.priority) ? item.priority : 50;
    valid.push({ name, url, priority });
  }
  return valid.sort((a, b) => a.priority - b.priority);
}

// FAILOVER CORE: lowest-priority reachable backend that serves all required models.
// Default required: ["qwen3:8b"]. Returns null if none qualify.
export function selectBackend(
  pool: Backend[],
  probes: BackendProbe[],
  opts?: { required?: string[] },
): Backend | null {
  const required = opts?.required ?? ["qwen3:8b"];
  const probeMap = new Map<string, BackendProbe>(probes.map((p) => [p.url, p]));
  for (const backend of pool) {
    const probe = probeMap.get(backend.url);
    if (!probe?.reachable) continue;
    if (probe.responsive === false) continue; // reachable but inference proven dead → skip
    if (required.every((m) => probe.models.includes(m))) return backend;
  }
  return null;
}

// Throttle for the periodic generate-probe of the ACTIVE backend in the watch
// loop. Returns true on the first tick (0) and whenever the elapsed wall-time
// (tickCount * intervalMs) crosses an `everyMs` boundary — so a backend that goes
// hung mid-run is detected within ~everyMs without generate-probing every tick.
export function shouldVerify(tickCount: number, intervalMs: number, everyMs = 30_000): boolean {
  if (tickCount <= 0) return true;
  if (intervalMs <= 0 || everyMs <= 0) return true;
  // fire once per everyMs window, robust to intervals that don't divide everyMs evenly
  return Math.floor((tickCount * intervalMs) / everyMs) > Math.floor(((tickCount - 1) * intervalMs) / everyMs);
}

// DISCOVERY CORE: parse `tailscale status --json` output.
// Includes Self + online Peers. Strips trailing dot from DNSName. Takes first IPv4.
export function parseTailscalePeers(
  statusJson: any,
): { host: string; ip: string; online: boolean }[] {
  if (!statusJson || typeof statusJson !== "object") return [];

  const peers: { host: string; ip: string; online: boolean }[] = [];

  const extractPeer = (entry: any): { host: string; ip: string; online: boolean } | null => {
    if (!entry || typeof entry !== "object") return null;
    const rawHost = typeof entry.DNSName === "string" ? entry.DNSName : "";
    const host = rawHost.replace(/\.$/, "");
    if (!host) return null;
    // Pick first IPv4 address from the list
    const ips: string[] = Array.isArray(entry.TailscaleIPs) ? entry.TailscaleIPs : [];
    const ip = ips.find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? "";
    const online = entry.Online === true;
    return { host, ip, online };
  };

  // Include Self
  const self = extractPeer(statusJson.Self);
  if (self?.online) peers.push(self);

  // Include online Peers
  if (statusJson.Peer && typeof statusJson.Peer === "object") {
    for (const peer of Object.values(statusJson.Peer)) {
      const p = extractPeer(peer);
      if (p?.online) peers.push(p);
    }
  }

  return peers;
}

// DISCOVERY CORE: turn discovered tailnet peers into a fleet pool.
// GPU workers get ascending 10, 20, 30… (most-preferred first); Self (the control
// plane) gets 99 — a last-resort fallback, less preferred than any real worker.
// (Self stays below 100 so `selectBackend` never picks the Mac over a live worker.)
export function assignDiscoveredPriorities(
  peers: { host: string; ip?: string }[],
  selfHost: string,
): Backend[] {
  let workerIndex = 1;
  return peers.map((p) => {
    const isSelf = p.host === selfHost;
    const priority = isSelf ? 99 : workerIndex++ * 10;
    const url = `http://${p.ip || p.host}:11434`;
    return { name: p.host.split(".")[0], url, priority };
  });
}

// TTY-aware pool table: name, priority, url, reachable, model count, qwen3:8b.
// selected (active) backend is marked with *.
export function formatPool(
  pool: Backend[],
  probes: BackendProbe[],
  ctx: OutputCtx,
  selectedUrl?: string,
): string {
  const probeMap = new Map<string, BackendProbe>(probes.map((p) => [p.url, p]));

  if (ctx.json) {
    const rows = pool.map((b) => {
      const probe = probeMap.get(b.url);
      return {
        name: b.name,
        priority: b.priority,
        url: b.url,
        reachable: probe?.reachable ?? false,
        modelCount: probe?.models.length ?? 0,
        hasQwen: probe?.models.includes("qwen3:8b") ?? false,
        active: b.url === selectedUrl,
      };
    });
    return JSON.stringify(rows, null, 2);
  }

  const header = ["", "NAME", "PRI", "URL", "REACH", "MODELS", "QWEN3:8B"];
  const rows = pool.map((b) => {
    const probe = probeMap.get(b.url);
    const reach = probe?.reachable ?? false;
    const hasQwen = probe?.models.includes("qwen3:8b") ?? false;
    const active = b.url === selectedUrl ? "*" : " ";
    return [
      active,
      b.name,
      String(b.priority),
      b.url,
      reach ? c("green", "✓", ctx.color) : c("red", "✗", ctx.color),
      String(probe?.models.length ?? 0),
      hasQwen ? c("green", "✓", ctx.color) : c("red", "✗", ctx.color),
    ];
  });

  // Simple fixed-width table (no formatTable import to avoid circular)
  const COL_WIDTHS = header.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].replace(/\x1b\[[0-9;]*m/g, "").length)),
  );
  const pad = (cells: string[]) =>
    cells.map((v, i) => v.padEnd(COL_WIDTHS[i] + (v.match(/\x1b\[/) ? v.length - v.replace(/\x1b\[[0-9;]*m/g, "").length : 0))).join("  ").trimEnd();

  return [c("dim", pad(header), ctx.color), ...rows.map(pad)].join("\n");
}

export interface RemoteCheckReport {
  mode: string;
  reachable: boolean;
  modelCount: number;
  required: string[];
  missing: string[];
  pass: boolean;
  gateway: string;
}

// Derive the remote-check report from raw /api/health + /api/models responses.
// health=null signals a network failure (unreachable gateway).
// reachable requires both health ok AND at least one model listed — an empty
// model list indicates the ollama backend is disconnected from the gateway.
export function buildRemoteCheck(
  health: any,
  models: string[],
  opts: { required?: string[]; gateway: string },
): RemoteCheckReport {
  const required = opts.required ?? ["qwen3:8b"];
  const mode: string = health?.mode ?? "unknown";
  const reachable = health != null && models.length > 0;
  const missing = required.filter((m) => !models.includes(m));
  const pass = mode === "live" && reachable && missing.length === 0;

  return {
    mode,
    reachable,
    modelCount: models.length,
    required,
    missing,
    pass,
    gateway: opts.gateway,
  };
}

// TTY-aware formatter — mirrors formatDoctor's ctx handling (output.ts:91).
export function formatRemoteCheck(r: RemoteCheckReport, ctx: OutputCtx): string {
  if (ctx.json) return JSON.stringify(r, null, 2);

  const modeColor =
    r.mode === "live" ? "green" : r.mode === "degraded-live" ? "yellow" : "red";

  const lines: string[] = [
    c("bold", "ollamas remote check", ctx.color),
    `  gateway   ${c("dim", r.gateway, ctx.color)}`,
    `  mode      ${c(modeColor, r.mode, ctx.color)}`,
    `  reachable ${r.reachable ? c("green", "yes", ctx.color) : c("red", "no", ctx.color)}`,
    `  models    ${r.modelCount}`,
  ];

  for (const m of r.required) {
    const present = !r.missing.includes(m);
    const mark = present ? c("green", "✓", ctx.color) : c("red", "✗", ctx.color);
    lines.push(`    ${mark} ${m}`);
  }

  lines.push(
    "",
    r.pass
      ? c("green", "PASS — gateway is live and all required models are present", ctx.color)
      : c("red", "FAIL — gateway is not ready for remote GPU offload", ctx.color),
  );

  return lines.join("\n");
}
