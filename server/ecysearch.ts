// server/ecysearch.ts — run the external `ecysearch` app (a zero-token GitHub keyword searcher,
// its own TS+React+Express project) as a SUPERVISED SUB-SERVICE under ollamas.
//
// Production-grade supervision: a state machine (stopped→starting→ready, unhealthy, crashed) with a
// background health loop, exponential restart backoff that RESETS after a stable run, a crash-loop
// CIRCUIT BREAKER (stop hammering a broken service), structured status, Prometheus metrics, and
// PERSISTENT rotating .log files on disk. The "Search" tab embeds ecysearch's own UI via an iframe.
// ecysearch's port is env-driven (PORT) → NOTHING in the ecysearch repo changes.
//
// Zero runtime dep: node builtins (child_process/fetch/path/os/fs) + prom-client (already present).
import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { appendLogLine, fmtLogLine, maskSecrets } from "./logfile";
import { ecysearchRestartsTotal, ecysearchUp, ecysearchReady } from "./metrics";

export interface EcyConfig { dir: string; port: number; cmd: string; args: string[]; healthUrl: string; logFile: string }

function dataDir(env: NodeJS.ProcessEnv, home: string): string {
  return env.MISSION_CONTROL_DATA_DIR || join(home, ".llm-mission-control");
}

/** Resolve config from the environment (pure). Everything overridable; defaults assume the checkout
 * at ~/Desktop/ecysearch. `npm run dev` = ecysearch's `tsx server/index.ts` (one self-serving proc). */
export function resolveEcyConfig(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): EcyConfig {
  const dir = env.ECYSEARCH_DIR || join(home, "Desktop", "ecysearch");
  const port = Number(env.ECYSEARCH_PORT) || 3100;
  const cmdStr = (env.ECYSEARCH_CMD || "npm run dev").trim();
  const [cmd, ...args] = cmdStr.split(/\s+/);
  return { dir, port, cmd, args, healthUrl: healthUrl(port), logFile: join(dataDir(env, home), "ecysearch.log") };
}

export function healthUrl(port: number): string { return `http://127.0.0.1:${port}/api/health`; }

/** Capped exponential backoff for supervised restarts (pure). attempt 0→500ms … capped at 30s. */
export function backoffMs(attempt: number, base = 500, cap = 30_000): number {
  if (attempt <= 0) return base;
  return Math.min(cap, base * 2 ** attempt);
}

/** Circuit-breaker decision (pure): ≥max restarts within the trailing window = a crash loop. */
export function isCrashLoop(restartTimesMs: number[], nowMs: number, max = 5, windowMs = 60_000): boolean {
  return restartTimesMs.filter((t) => nowMs - t <= windowMs).length >= max;
}

/** Backoff-reset decision (pure): a child up longer than stableMs has earned a clean slate. */
export function shouldResetBackoff(uptimeMs: number, stableMs = 60_000): boolean {
  return uptimeMs >= stableMs;
}

/** Fixed-size FIFO log ring (last N lines), secrets masked. Mirrors what is persisted to disk. */
export class RingBuffer {
  private buf: string[] = [];
  constructor(private readonly max = 200) {}
  push(line: string): void {
    for (const l of maskSecrets(line).split(/\r?\n/)) { if (l) this.buf.push(l); }
    if (this.buf.length > this.max) this.buf = this.buf.slice(-this.max);
  }
  lines(): string[] { return [...this.buf]; }
}

// Kill the child's WHOLE process group, not just the immediate child. `npm run dev` forks a node
// grandchild (the real ecysearch server); signalling only the npm wrapper orphans that grandchild
// (it gets reparented to launchd and keeps the port alive). With `detached:true` the child is a
// group leader, so `process.kill(-pid)` reaps npm + grandchild together. Falls back to a direct
// kill. Best-effort — never throws.
function killGroup(child: ChildProcess | null, signal: NodeJS.Signals): void {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); }
  catch { try { child.kill(signal); } catch { /* already gone */ } }
}

export type EcyState = "stopped" | "starting" | "ready" | "unhealthy" | "crashed";

export interface EcyStatus {
  state: EcyState; running: boolean; ready: boolean; port: number; pid: number | null;
  startedAt: number | null; uptimeMs: number; lastReadyAt: number | null; lastExitCode: number | null;
  restarts: number; consecutiveFailures: number; circuitOpen: boolean; logFile: string;
}

const HEALTH_INTERVAL_MS = 3000;
const UNHEALTHY_THRESHOLD = 5; // ~15s of failing health while alive → zombie → recycle
const STABLE_MS = 60_000;      // up this long → forgive prior crashes (reset backoff)

class EcySupervisor {
  private child: ChildProcess | null = null;
  private enabled = false;
  private starting = false;
  private state: EcyState = "stopped";
  private startedAt: number | null = null;
  private lastReadyAt: number | null = null;
  private lastExitCode: number | null = null;
  private readyFlag = false;
  private consecutiveFailures = 0;
  private restartTimes: number[] = [];
  private restartsTotal = 0;
  private readonly log = new RingBuffer();
  private exitHooked = false;
  private restartTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;

  private cfg(): EcyConfig { return resolveEcyConfig(); }

  /** Append a structured, masked, timestamped line to BOTH the in-memory ring and the .log file. */
  private record(level: string, msg: string): void {
    const line = fmtLogLine(new Date().toISOString(), level, msg);
    this.log.push(line);
    appendLogLine(this.cfg().logFile, line, { maxBytes: 1_000_000, keep: 5 });
  }

  /** Start (or restart) ecysearch. Idempotent. `manual` (the route) reopens a tripped circuit. */
  ensureRunning(opts: { manual?: boolean } = {}): EcyStatus {
    this.enabled = true;
    if (opts.manual && (this.state === "crashed" || this.restartTimes.length)) {
      this.restartTimes = [];
      if (this.state === "crashed") this.state = "stopped"; // reopen the tripped circuit
      this.record("info", "[supervise] manual start — circuit reset");
    }
    if (this.starting || (this.child && this.child.exitCode === null && !this.child.killed)) return this.status();
    if (this.state === "crashed") return this.status(); // circuit open — only a manual start (above) reopens
    this.hookProcessExit();
    this.spawnChild();
    return this.status();
  }

  /** The actual spawn + wiring (also the restart entry point). */
  private spawnChild(): void {
    const { dir, port, cmd, args } = this.cfg();
    this.starting = true;
    this.state = "starting";
    this.startedAt = Date.now();
    this.readyFlag = false;
    try {
      const child = spawn(cmd, args, {
        cwd: dir,
        env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
        detached: true, // own process group so killGroup() reaps the `npm`→node grandchild too
      });
      this.child = child;
      this.starting = false;
      ecysearchUp.set(1);
      this.record("info", `[supervise] spawned pid=${child.pid} cmd="${cmd} ${args.join(" ")}" port=${port}`);
      child.stdout?.on("data", (d) => this.record("out", String(d).trimEnd()));
      child.stderr?.on("data", (d) => this.record("err", String(d).trimEnd()));
      child.on("error", (e) => this.record("err", `[spawn-error] ${String((e as Error)?.message || e)}`));
      child.on("exit", (code, signal) => this.onChildExit(code, signal));
      this.startHealthLoop();
    } catch (e) {
      this.starting = false;
      this.child = null;
      ecysearchUp.set(0);
      this.record("err", `[spawn-throw] ${String((e as Error)?.message || e)}`);
      this.onChildExit(null, null);
    }
  }

  private onChildExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.lastExitCode = code;
    this.child = null;
    this.readyFlag = false;
    ecysearchUp.set(0);
    ecysearchReady.set(0);
    this.record("info", `[supervise] exit code=${code} signal=${signal}`);
    if (!this.enabled) return; // a deliberate stop() — do not resurrect
    const now = Date.now();
    this.restartTimes.push(now);
    this.restartsTotal++;
    ecysearchRestartsTotal.inc();
    if (isCrashLoop(this.restartTimes, now)) {
      this.state = "crashed";
      this.record("err", `[supervise] crash-loop (${this.restartTimes.length} restarts/min) — giving up; manual start to retry`);
      this.stopHealthLoop();
      return; // circuit OPEN — schedule nothing
    }
    const delay = backoffMs(this.restartTimes.length);
    this.state = "starting";
    this.record("info", `[supervise] restarting in ${delay}ms (restart #${this.restartsTotal})`);
    this.restartTimer = setTimeout(() => { if (this.enabled && this.state !== "crashed") this.spawnChild(); }, delay);
    this.restartTimer.unref?.();
  }

  /** Background health monitor: keeps `ready` live, resets backoff on stability, recycles a zombie. */
  private startHealthLoop(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => { void this.healthTick(); }, HEALTH_INTERVAL_MS);
    this.healthTimer.unref?.();
  }
  private stopHealthLoop(): void {
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
  }

  private async healthTick(): Promise<void> {
    if (!this.child) return; // between exits — restart logic owns this
    const ok = await this.probeReady();
    if (ok) {
      ecysearchReady.set(1);
      this.consecutiveFailures = 0;
      this.lastReadyAt = Date.now();
      if (this.state !== "ready") { this.state = "ready"; this.record("info", "[supervise] healthy → ready"); }
      if (this.startedAt && shouldResetBackoff(Date.now() - this.startedAt) && this.restartTimes.length) {
        this.restartTimes = [];
        this.record("info", "[supervise] stable uptime — backoff reset");
      }
    } else {
      ecysearchReady.set(0);
      this.readyFlag = false;
      this.consecutiveFailures++;
      if (this.consecutiveFailures >= UNHEALTHY_THRESHOLD && this.state !== "unhealthy") {
        this.state = "unhealthy";
        this.record("err", `[supervise] unhealthy (${this.consecutiveFailures} failed probes) — recycling`);
        killGroup(this.child, "SIGTERM"); // exit handler will restart
      }
    }
    this.readyFlag = ok;
  }

  /** Health probe — true once ecysearch answers /api/health. */
  async probeReady(): Promise<boolean> {
    if (!this.child) return false;
    try {
      const res = await fetch(this.cfg().healthUrl, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch { return false; }
  }

  /** Stop supervising + terminate the child (no orphan), halt the health loop. */
  stop(): EcyStatus {
    this.enabled = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    this.stopHealthLoop();
    if (this.child && this.child.exitCode === null) killGroup(this.child, "SIGTERM");
    this.child = null;
    this.starting = false;
    this.state = "stopped";
    this.readyFlag = false;
    ecysearchUp.set(0);
    ecysearchReady.set(0);
    this.record("info", "[supervise] stopped");
    return this.status();
  }

  /** Recent log lines — from the persisted .log file (survives restart), falling back to the ring. */
  recentLogs(limit = 200): string[] {
    const file = this.cfg().logFile;
    try {
      if (existsSync(file)) {
        const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
        return lines.slice(-limit);
      }
    } catch { /* fall through to the in-memory ring */ }
    return this.log.lines().slice(-limit);
  }

  status(): EcyStatus {
    const alive = !!(this.child && this.child.exitCode === null && !this.child.killed);
    const uptimeMs = alive && this.startedAt ? Date.now() - this.startedAt : 0;
    return {
      state: this.state, running: alive, ready: this.readyFlag && alive, port: this.cfg().port,
      pid: this.child?.pid ?? null, startedAt: this.startedAt, uptimeMs, lastReadyAt: this.lastReadyAt,
      lastExitCode: this.lastExitCode, restarts: this.restartsTotal, consecutiveFailures: this.consecutiveFailures,
      circuitOpen: this.state === "crashed", logFile: this.cfg().logFile,
    };
  }

  /** Kill the child when ollamas itself exits — never leak a process. Registered once. */
  private hookProcessExit(): void {
    if (this.exitHooked) return;
    this.exitHooked = true;
    const kill = () => { this.enabled = false; if (this.child && this.child.exitCode === null) killGroup(this.child, "SIGTERM"); };
    process.on("exit", kill);
    process.on("SIGTERM", kill);
    process.on("SIGINT", kill);
  }
}

export const ecySupervisor = new EcySupervisor();
