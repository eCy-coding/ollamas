#!/usr/bin/env tsx
/**
 * signal.ts — vO2 koordinasyon sinyali (§3.1 Koordinasyon İstisnası).
 *
 * Conductor'ın read-only DIŞINDA izinli TEK yan-etkisi: idle/stuck bir lane sekmesine
 * TEŞHİS dürtmesi (git status vb.) + macOS bildirimi. Sıkı güvenlik:
 *   1. ALLOWLIST — sadece read-only teşhis komutları (mutasyon/build/kod ÜRETME yasak).
 *   2. Injection guard — komut zincirleme (; && | ` $() > ) reddedilir (RISK-ORCH-007).
 *   3. dry-run DEFAULT — gerçek gönderim yalnız açık `--nudge`/`--notify` flag'iyle.
 *   4. Audit — her gerçek gönderim seyir loguna yazılır.
 *
 * Lane FEATURE kodu yazmak HÂLÂ yasaktır (§3). Bu modül yalnız koordinasyon sinyali üretir.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type Runner = (file: string, args: string[]) => string;

/** Koordinasyon hedefi — discover.ts TabInfo ile uyumlu alt-küme (gevşek bağ, döngü yok). */
export interface NudgeTarget {
  app: "tmux" | "iterm2" | "terminal";
  tty: string;
  session?: string;
}

export const realRunner: Runner = (file, args) => {
  try {
    return execFileSync(file, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch { return ""; }
};

// Read-only teşhis prefix'leri — bu listenin DIŞI reddedilir. Mutasyon (push/rm/npm) yok.
const ALLOWLIST = ["git status", "git log", "git branch", "git diff", "echo ", "pwd"];
// Kabuk meta-karakterleri: allowlist'i atlatıp ikinci komut çalıştırmayı engeller.
const INJECTION = /[;&|`>]|\$\(|\|\||&&/;

/** Komut read-only allowlist'te mi VE injection içermiyor mu? */
export function isAllowedCmd(cmd: string): boolean {
  const c = cmd.trim();
  if (INJECTION.test(c)) return false;
  return ALLOWLIST.some(p => c === p.trim() || c.startsWith(p));
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SEYIR_LOG = join(HERE, "..", "..", "seyir", "nudge-log.jsonl");

/** Audit: gerçek koordinasyon eylemini seyir loguna ekler (best-effort, hata yutar). */
function auditDefault(entry: Record<string, unknown>): void {
  try {
    const dir = dirname(SEYIR_LOG);
    execFileSync("mkdir", ["-p", dir], { stdio: "ignore" });
    appendFileSync(SEYIR_LOG, JSON.stringify(entry) + "\n");
  } catch { /* audit best-effort */ }
}

export interface NudgeOpts {
  dryRun?: boolean;                       // default true (güvenli)
  run?: Runner;
  log?: (entry: Record<string, unknown>) => void;
}
export interface NudgeResult {
  sent: boolean; rejected?: boolean; reason?: string; plan: string;
}

/** tmux pane veya AppleScript session için send-keys/write-text komut planı kurar. */
function buildPlan(tab: NudgeTarget, cmd: string): { file: string; args: string[]; human: string } {
  if (tab.app === "tmux") {
    const target = tab.session ? `${tab.session}` : tab.tty;
    return {
      file: "tmux", args: ["send-keys", "-t", target, cmd, "Enter"],
      human: `tmux send-keys -t ${target} "${cmd}" Enter`,
    };
  }
  // iTerm2 / Terminal.app: tty üzerinden ilgili session'a write text (özgün, GPL ref-only)
  const script = tab.app === "iterm2"
    ? `tell application "iTerm" to repeat with w in windows
         repeat with t in tabs of w
           repeat with s in sessions of t
             if (tty of s) is "${tab.tty}" then tell s to write text "${cmd}"
           end repeat
         end repeat
       end repeat`
    : `tell application "Terminal" to repeat with w in windows
         repeat with t in tabs of w
           if (tty of t) is "${tab.tty}" then do script "${cmd}" in t
         end repeat
       end repeat`;
  return { file: "osascript", args: ["-e", script], human: `osascript write "${cmd}" → ${tab.app} ${tab.tty}` };
}

/**
 * Idle/stuck bir sekmeye teşhis komutu gönderir. dry-run DEFAULT (gönderme yok).
 * Allowlist dışı komut → reddedilir, runner ASLA çağrılmaz.
 */
export function nudge(tab: NudgeTarget, cmd: string, opts: NudgeOpts = {}): NudgeResult {
  const dryRun = opts.dryRun !== false;     // yalnız açıkça false ise gerçek gönder
  const run = opts.run ?? realRunner;
  const log = opts.log ?? auditDefault;
  const { file, args, human } = buildPlan(tab, cmd);

  if (!isAllowedCmd(cmd)) {
    return { sent: false, rejected: true, reason: `allowlist reddi: "${cmd}" read-only teşhis değil`, plan: human };
  }
  if (dryRun) return { sent: false, plan: `[dry-run] ${human}` };

  run(file, args);
  log({ ts: new Date().toISOString(), action: "nudge", app: tab.app, target: tab.session || tab.tty, cmd });
  return { sent: true, plan: human };
}

export interface NotifyOpts { run?: Runner; log?: (e: Record<string, unknown>) => void; }
export interface NotifyResult { delivered: boolean; via: "terminal-notifier" | "stdout"; }

/** macOS bildirimi (terminal-notifier MIT varsa), yoksa stdout fallback. */
export function notify(msg: string, opts: NotifyOpts = {}): NotifyResult {
  const run = opts.run ?? realRunner;
  const has = run("which", ["terminal-notifier"]);
  if (has) {
    run("terminal-notifier", ["-title", "ollamas conductor", "-message", msg, "-group", "ollamas-orchestration"]);
    (opts.log ?? auditDefault)({ ts: new Date().toISOString(), action: "notify", msg });
    return { delivered: true, via: "terminal-notifier" };
  }
  console.log(`[notify] ${msg}`);
  return { delivered: false, via: "stdout" };
}
