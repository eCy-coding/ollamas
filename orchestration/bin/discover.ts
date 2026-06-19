/**
 * orchestration/bin/discover.ts — READ-ONLY canlı keşif: çalışan dev-server'ları cwd ile
 * lane'e eşle (port DEĞİL) + Terminal.app sekmelerini say.
 *
 * Kök problem (ERR-ORCH-001 / RISK-ORCH-006): 6 worktree de port 3000'e bind. Port ile
 * lane ayırt EDİLEMEZ. Çözüm: lsof → pid → process cwd → cwd-prefix eşleşen worktree.
 *
 * Pure parser'lar (parse / match aileleri) spawn etmez → test edilebilir. Native sarmalayıcılar
 * (*Live) lsof/ps/osascript çağırır, asla throw etmez (boş döner).
 * Adopt: native lsof/ps/osascript (system, zero-dep). Ref: steipete/macos-automator-mcp (MIT).
 */
import { execFileSync } from "node:child_process";

export interface Listener { port: number; pid: number; command: string; }
export interface ServerLane { lane: string; path: string; port: number; pid: number; }
/** app = sekme kaynağı; session/cwd/cmd vO2-merge ile eklendi (koordinasyon hedefleme + tmux). */
export interface TabInfo { tty: string; busy: boolean; app?: "tmux" | "iterm2" | "terminal"; session?: string; cwd?: string; cmd?: string; }
export interface TabResult { available: boolean; tabs: TabInfo[]; note: string; source?: "tmux" | "applescript" | "none"; }
export interface Worktree { path: string; branch: string; }

/** Read-only native komut; hata → "" (matris asla kırılmaz). */
function sh(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
  } catch {
    return "";
  }
}

// ── Pure parsers ─────────────────────────────────────────────────────────────

/** `lsof -nP -iTCP -sTCP:LISTEN` satırlarını ayrıştır. Name alanı `addr:port`, son `(LISTEN)`. */
export function parseLsofListen(raw: string): Listener[] {
  const out: Listener[] = [];
  for (const line of raw.split("\n")) {
    if (!/\(LISTEN\)/.test(line)) continue;
    const cols = line.trim().split(/\s+/);
    if (cols.length < 9) continue;
    const command = cols[0];
    const pid = parseInt(cols[1], 10);
    const nameCol = cols.find((c) => /:\d+$/.test(c)); // *:3000 | 127.0.0.1:5173 | [::1]:3000
    if (!nameCol) continue;
    const m = nameCol.match(/:(\d+)$/);
    if (!m) continue;
    const port = parseInt(m[1], 10);
    if (!Number.isFinite(pid) || !Number.isFinite(port)) continue;
    out.push({ port, pid, command });
  }
  return out;
}

/** `lsof -a -p PID -d cwd -Fn` çıktısından cwd (ilk `n` alanı). */
export function parseLsofCwd(raw: string): string {
  for (const line of raw.split("\n")) {
    if (line.startsWith("n")) return line.slice(1).trim();
  }
  return "";
}

/** cwd'yi en uzun path-prefix eşleşen worktree'ye ata. `+ "/"` guard kardeş-dizin yanlış eşleşmesini önler. */
export function matchWorktree(cwd: string, worktrees: Worktree[]): Worktree | null {
  let best: Worktree | null = null;
  let bestLen = -1;
  for (const wt of worktrees) {
    if (cwd === wt.path || cwd.startsWith(wt.path + "/")) {
      if (wt.path.length > bestLen) { best = wt; bestLen = wt.path.length; }
    }
  }
  return best;
}

/**
 * Listener'ları worktree'lere eşle. cwd çözümü inject edilir (cwdOf) → saf + test edilebilir.
 * Aynı portta (örn 6×3000) farklı cwd'ler farklı lane'lere ayrışır.
 */
export function mapServersToWorktrees(
  listeners: Listener[],
  worktrees: Worktree[],
  cwdOf: (pid: number) => string,
): ServerLane[] {
  const out: ServerLane[] = [];
  for (const l of listeners) {
    const cwd = cwdOf(l.pid);
    if (!cwd) continue;
    const wt = matchWorktree(cwd, worktrees);
    if (wt) out.push({ lane: wt.branch, path: wt.path, port: l.port, pid: l.pid });
  }
  return out;
}

/** AppleScript çıktısı `tty\tbusy` satırları → TabInfo[]. */
export function parseTabs(raw: string): TabInfo[] {
  const tabs: TabInfo[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [tty, busy] = line.split("\t");
    if (!tty || !tty.trim()) continue;
    tabs.push({ tty: tty.trim(), busy: /true/i.test(busy || "") });
  }
  return tabs;
}

// ── Native wrappers (read-only) ──────────────────────────────────────────────

export function listenersLive(): Listener[] {
  return parseLsofListen(sh("lsof", ["-nP", "-iTCP", "-sTCP:LISTEN"]));
}

export function pidCwdLive(pid: number): string {
  return parseLsofCwd(sh("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"]));
}

const SHELLS = new Set(["sh", "bash", "zsh", "fish", "csh", "tcsh", "dash", "ksh", "login"]);
/** Foreground komut kabuk mu? Kabuk = prompt'ta = idle (busy=false). */
export function isShellCmd(cmd: string): boolean {
  return SHELLS.has((cmd || "").trim().replace(/^-/, ""));
}

/** tmux list-panes tab-ayraçlı (session\ttty\tcwd\tcmd) → TabInfo[]. */
export function parseTmuxPanes(raw: string): TabInfo[] {
  const out: TabInfo[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [session, tty, cwd, cmd] = line.split("\t");
    if (!tty) continue;
    out.push({ app: "tmux", session, tty, cwd: cwd || "", cmd: cmd || "", busy: !isShellCmd(cmd || "") });
  }
  return out;
}

/** AppleScript tek-batch (app\ttty\ttitle\tbusy01) → TabInfo[]. */
export function parseTabsTagged(raw: string): TabInfo[] {
  const out: TabInfo[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const [app, tty, , busy] = line.split("\t");
    if (!app || !tty || !tty.trim()) continue;
    out.push({ app: app === "terminal" ? "terminal" : "iterm2", tty: tty.trim(), busy: busy === "1" || /true/i.test(busy || "") });
  }
  return out;
}

const TMUX_FMT = "#{session_name}\t#{pane_tty}\t#{pane_current_path}\t#{pane_current_command}";
// GOTCHA (ERR-ORCH-003): tell-bloğu içinde AppleScript `tab` SABİTİ uygulamanın `tab`
// CLASS'ı ile çakışır + AppleScript string literal "\t" GERÇEK tab DEĞİL (backslash+t).
// Çözüm: ayraç (D=ASCII 9) tell-bloğu DIŞINDA tanımlanır, içeride değişken kullanılır.
const DELIM = `set D to (ASCII character 9)\nset LF to (ASCII character 10)`;
const ITERM_OSA = `${DELIM}
if application "iTerm" is running then
  set out to ""
  tell application "iTerm"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          set bf to "0"
          if (is processing of s) then set bf to "1"
          set out to out & "iterm2" & D & (tty of s) & D & (name of s) & D & bf & LF
        end repeat
      end repeat
    end repeat
  end tell
  return out
end if
return ""`;
const TERMINAL_OSA = `${DELIM}
if application "Terminal" is running then
  set out to ""
  tell application "Terminal"
    repeat with w in windows
      repeat with t in tabs of w
        set bf to "0"
        if busy of t then set bf to "1"
        set out to out & "terminal" & D & (tty of t) & D & "term" & D & bf & LF
      end repeat
    end repeat
  end tell
  return out
end if
return ""`;

/**
 * Canlı sekme keşfi. Backend önceliği (T0 kararı): tmux-first (~30ms) → AppleScript
 * fallback (iTerm2 + Terminal.app TEK batch, per-tab loop YOK). İzin yok/kapalı → zarafetle atla.
 */
export function discoverTabs(simulateFail = false): TabResult {
  if (simulateFail || process.env.ORCH_TAB_SIM === "fail") {
    return { available: false, tabs: [], note: "simulated-fail (ORCH_TAB_SIM)", source: "none" };
  }
  const tmuxRaw = sh("tmux", ["list-panes", "-a", "-F", TMUX_FMT]);
  if (tmuxRaw.trim()) {
    return { available: true, tabs: parseTmuxPanes(tmuxRaw), note: "", source: "tmux" };
  }
  const it = sh("osascript", ["-e", ITERM_OSA]);
  const tm = sh("osascript", ["-e", TERMINAL_OSA]);
  const tabs = parseTabsTagged([it, tm].filter(Boolean).join("\n"));
  if (!tabs.length) {
    return { available: false, tabs: [], note: "skipped (tmux yok + Automation izni yok / app kapalı)", source: "none" };
  }
  return { available: true, tabs, note: "", source: "applescript" };
}

/** Bir tty üzerindeki pid'ler (ps -t). Tab↔lane cwd eşlemesi için. */
export function pidsOnTty(tty: string): number[] {
  const short = tty.replace("/dev/", "");
  const raw = sh("ps", ["-t", short, "-o", "pid="]);
  return raw.split("\n").map((s) => parseInt(s.trim(), 10)).filter((n) => Number.isFinite(n));
}

/** Tab'ın cwd'sini tty→pid→cwd ile çöz, worktree'ye eşle. İlk eşleşen kazanır. */
export function tabWorktree(tty: string, worktrees: Worktree[]): Worktree | null {
  for (const pid of pidsOnTty(tty)) {
    const cwd = pidCwdLive(pid);
    if (!cwd) continue;
    const wt = matchWorktree(cwd, worktrees);
    if (wt) return wt;
  }
  return null;
}
