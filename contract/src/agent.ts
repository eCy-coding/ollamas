// Member-side agent (vK8): one-command join + automatic heartbeats.
// Pure/injectable core (fetchFn, osInfo, launchctl, sleep, clock) — the CLI
// provides real IO. launchd pattern adapted from tunnel/src/daemon.ts (copied,
// not imported: lanes stay isolated).
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { HeartbeatInput } from "./pool.ts";
import type { Specs } from "./registry.ts";

export type OsInfo = { totalmemBytes: number; loadavg1: number; cpuCount: number; platform: string; arch: string };

export function specsFromOs(os: OsInfo): Specs {
  return { ramGB: Math.round(os.totalmemBytes / 1024 ** 3), os: os.platform, arch: os.arch };
}

export async function collectHeartbeat(opts: {
  osInfo: OsInfo;
  fetchFn: typeof fetch;
  ollamaUrl: string;
  rpcPort?: number;
}): Promise<HeartbeatInput> {
  let models: string[] = [];
  try {
    const r = await opts.fetchFn(`${opts.ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) } as RequestInit);
    if (r.ok) {
      const j = (await r.json()) as { models?: Array<{ name?: string }> };
      models = (j.models || []).map((m) => String(m.name)).filter(Boolean);
    }
  } catch {
    // ollama down → still heartbeat (empty models keeps the node visible)
  }
  const load = Math.min(1, Math.max(0, opts.osInfo.loadavg1 / Math.max(1, opts.osInfo.cpuCount)));
  return { ollamaUrl: opts.ollamaUrl, models, load, rpcPort: opts.rpcPort };
}

export async function joinPool(opts: {
  baseUrl: string;
  email: string;
  specs: Specs;
  machinePubkey: string;
  fetchFn: typeof fetch;
  pollIntervalMs: number;
  timeoutMs: number;
  sleep: (ms: number) => Promise<void>;
  clock?: () => number;
}): Promise<{ memberId: string; key: string }> {
  const clock = opts.clock ?? Date.now;
  const jsonReq = async (method: string, path: string, body?: unknown): Promise<{ status: number; json: any }> => {
    const r = await opts.fetchFn(`${opts.baseUrl}${path}`, {
      method,
      headers: { "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    } as RequestInit);
    return { status: r.status, json: await r.json().catch(() => ({})) };
  };

  const doc = await jsonReq("GET", "/api/contract/document");
  const hash = doc.json?.hash;
  if (!/^[0-9a-f]{64}$/.test(String(hash))) throw new Error(`could not fetch contract document (status ${doc.status})`);

  const apply = await jsonReq("POST", "/api/contract/apply", {
    email: opts.email,
    machinePubkey: opts.machinePubkey,
    specs: opts.specs,
    contractHash: hash, // accept-by-hash = signing the exact contract text
  });
  const memberId = apply.json?.id;
  if (apply.status !== 202 || !memberId) throw new Error(`apply failed (${apply.status}): ${apply.json?.error || "?"}`);

  const start = clock();
  for (;;) {
    const st = await jsonReq("GET", `/api/contract/status/${memberId}`);
    const status = st.json?.member?.status;
    if (status === "active" && st.json?.key) return { memberId, key: String(st.json.key) };
    if (status === "active" && !st.json?.key) {
      throw new Error("member active but the one-time key was already delivered — revoke + re-apply");
    }
    if (status === "rejected" || status === "revoked") throw new Error(`application ${status}`);
    if (clock() - start > opts.timeoutMs) throw new Error(`timeout waiting for approval (member ${memberId} still ${status})`);
    await opts.sleep(opts.pollIntervalMs);
  }
}

export async function heartbeatOnce(opts: {
  baseUrl: string;
  key: string;
  fetchFn: typeof fetch;
  hb: HeartbeatInput;
}): Promise<{ ok: boolean; status: number }> {
  const r = await opts.fetchFn(`${opts.baseUrl}/api/pool/heartbeat`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${opts.key}` },
    body: JSON.stringify(opts.hb),
  } as RequestInit);
  return { ok: r.ok, status: r.status };
}

// --- vK16 resilient beat loop (pure-ish core; cli wires real IO) ---

export type BeatLoopDeps = {
  readKey: () => string; // re-read each beat so a rebooted daemon reloads the persisted key
  beat: (key: string) => Promise<{ ok: boolean; status: number }>;
  sleep: (ms: number) => Promise<void>;
  backoff: (attempt: number) => number;
  onBeat?: (r: { ok: boolean; status: number; attempt: number; waitMs: number }) => void;
  maxIters?: number; // test bound; undefined → forever
};

/** Heartbeat loop: on failure, exponential-backoff instead of spin-restarting.
 * readKey is called EVERY iteration so a rebooted member reloads its key (G-F).
 * Never throws — a down server just backs off. */
export async function agentBeatLoop(deps: BeatLoopDeps): Promise<void> {
  let fails = 0;
  for (let i = 0; deps.maxIters === undefined || i < deps.maxIters; i++) {
    let r: { ok: boolean; status: number };
    try {
      const key = deps.readKey();
      r = await deps.beat(key);
    } catch {
      r = { ok: false, status: 0 };
    }
    if (r.ok) fails = 0;
    else fails += 1;
    const waitMs = r.ok ? 60_000 : deps.backoff(fails - 1);
    deps.onBeat?.({ ...r, attempt: fails, waitMs });
    await deps.sleep(waitMs);
  }
}

// --- launchd (macOS) — tunnel daemon.ts pattern, contract label ---

export const AGENT_LABEL = "com.ollamas.contract.agent";

export type AgentPlan = { label: string; nodeBin: string; cliPath: string; args: string[]; logPath: string; workdir: string };

export function agentPlistPath(label: string, home: string = homedir()): string {
  return join(home, "Library", "LaunchAgents", `${label}.plist`);
}

function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderAgentPlist(plan: AgentPlan): string {
  const argv = [plan.nodeBin, plan.cliPath, ...plan.args];
  const argEls = argv.map((a) => `    <string>${xmlEscape(a)}</string>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${xmlEscape(plan.label)}</string>
  <key>ProgramArguments</key>
  <array>
${argEls}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>WorkingDirectory</key>
  <string>${xmlEscape(plan.workdir)}</string>
  <key>StandardOutPath</key>
  <string>${xmlEscape(plan.logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(plan.logPath)}</string>
  <key>ProcessType</key>
  <string>Background</string>
</dict>
</plist>
`;
}

export type Launchctl = (args: string[]) => { code: number; stdout: string };

const realLaunchctl: Launchctl = (args) => {
  const r = spawnSync("launchctl", args, { encoding: "utf8" });
  if (r.error) return { code: 127, stdout: "" };
  return { code: r.status ?? 1, stdout: r.stdout ?? "" };
};

export function installAgent(plan: AgentPlan, opts: { launchctl?: Launchctl; home?: string } = {}): { ok: boolean; reason: string } {
  const launchctl = opts.launchctl ?? realLaunchctl;
  const path = agentPlistPath(plan.label, opts.home);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderAgentPlist(plan), { mode: 0o644 });
  } catch (e) {
    return { ok: false, reason: `write failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const r = launchctl(["load", "-w", path]);
  if (r.code === 127) return { ok: false, reason: "launchctl not available (plist written; load manually)" };
  if (r.code !== 0) return { ok: false, reason: `launchctl load exit ${r.code}` };
  return { ok: true, reason: `loaded ${plan.label}` };
}

export function uninstallAgent(label: string, opts: { launchctl?: Launchctl; home?: string } = {}): { ok: boolean; reason: string } {
  const launchctl = opts.launchctl ?? realLaunchctl;
  const path = agentPlistPath(label, opts.home);
  const r = launchctl(["unload", "-w", path]);
  try {
    if (existsSync(path)) rmSync(path);
  } catch { /* best-effort */ }
  if (r.code === 127) return { ok: false, reason: "launchctl not available" };
  return { ok: true, reason: `unloaded ${label}` };
}

export function agentLoaded(label: string, opts: { launchctl?: Launchctl } = {}): boolean {
  const launchctl = opts.launchctl ?? realLaunchctl;
  const r = launchctl(["list"]);
  return r.code === 0 && r.stdout.includes(label);
}
