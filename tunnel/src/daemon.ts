// Always-on daemon (vT7): macOS LaunchAgent that auto-starts `tunnel auto --watch` at login and
// restarts it on crash → true 0-manuel reachability (the running autopilot needs no human action).
// Adoption (pattern only): launchd.plist(5) + tjluoma/launchd-keepalive. RunAtLoad + KeepAlive,
// never touch /System/Library, ThrottleInterval to avoid restart storms.
//
// renderLaunchAgent + agentPath are PURE (no launchctl needed). install/uninstall/status binary-invoke
// launchctl through an injectable runner (capability-gated, never-throws, never-prompts).

import { writeFileSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export interface DaemonPlan {
  /** Reverse-DNS launchd label, also the plist filename stem. */
  label: string;
  /** Absolute node binary path. */
  nodeBin: string;
  /** Absolute path to the tunnel CLI entry (src/cli.ts). */
  cliPath: string;
  /** CLI args the daemon runs (the autopilot self-heal loop). */
  args: string[];
  /** Where stdout/stderr go. */
  logPath: string;
  /** WorkingDirectory for the job. */
  workdir: string;
}

export const DEFAULT_LABEL = "com.ollamas.tunnel.autopilot";

/** PURE: ~/Library/LaunchAgents/<label>.plist for a given label. */
export function agentPath(label: string, home: string = homedir()): string {
  return join(home, "Library", "LaunchAgents", `${label}.plist`);
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** PURE: render the LaunchAgent plist XML. RunAtLoad (login) + KeepAlive (crash-restart). */
export function renderLaunchAgent(plan: DaemonPlan): string {
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

export interface AgentResult {
  ok: boolean;
  reason: string;
}

/** Injectable launchctl runner (test = fake). Returns {code, stdout}. */
export type Launchctl = (args: string[]) => { code: number; stdout: string };

const realLaunchctl: Launchctl = (args) => {
  const r = spawnSync("launchctl", args, { encoding: "utf8" });
  if (r.error) return { code: 127, stdout: "" };
  return { code: r.status ?? 1, stdout: r.stdout ?? "" };
};

/** Write the plist (0644) and `launchctl load` it. Capability-gated; never throws. */
export function installAgent(plan: DaemonPlan, opts: { launchctl?: Launchctl; home?: string } = {}): AgentResult {
  const launchctl = opts.launchctl ?? realLaunchctl;
  const path = agentPath(plan.label, opts.home);
  try {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, renderLaunchAgent(plan), { mode: 0o644 });
  } catch (e) {
    return { ok: false, reason: `write failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const r = launchctl(["load", "-w", path]);
  if (r.code === 127) return { ok: false, reason: "launchctl not available (plist written; load manually)" };
  if (r.code !== 0) return { ok: false, reason: `launchctl load exit ${r.code}` };
  return { ok: true, reason: `loaded ${plan.label}` };
}

/** `launchctl unload` then remove the plist. Never throws. */
export function uninstallAgent(label: string, opts: { launchctl?: Launchctl; home?: string } = {}): AgentResult {
  const launchctl = opts.launchctl ?? realLaunchctl;
  const path = agentPath(label, opts.home);
  const r = launchctl(["unload", "-w", path]);
  try {
    if (existsSync(path)) rmSync(path);
  } catch {
    // best-effort removal
  }
  if (r.code === 127) return { ok: false, reason: "launchctl not available" };
  return { ok: true, reason: `unloaded ${label}` };
}

export interface DaemonStatus {
  installed: boolean;
  loaded: boolean;
  pid: number | null;
  plistPath: string;
}

/** Check whether the agent plist exists + is loaded (via `launchctl list`). Never throws. */
export function agentStatus(label: string, opts: { launchctl?: Launchctl; home?: string } = {}): DaemonStatus {
  const launchctl = opts.launchctl ?? realLaunchctl;
  const path = agentPath(label, opts.home);
  const installed = (() => {
    try {
      return existsSync(path);
    } catch {
      return false;
    }
  })();
  const r = launchctl(["list"]);
  let loaded = false;
  let pid: number | null = null;
  if (r.code === 0) {
    for (const line of r.stdout.split("\n")) {
      if (line.includes(label)) {
        loaded = true;
        const first = line.trim().split(/\s+/)[0];
        const n = Number(first);
        pid = Number.isInteger(n) ? n : null;
        break;
      }
    }
  }
  return { installed, loaded, pid, plistPath: path };
}
