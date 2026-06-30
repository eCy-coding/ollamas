// server/ecysearch.ts — run the external `ecysearch` app (a zero-token GitHub keyword searcher,
// its own TS+React+Express project) as a SUPERVISED SUB-SERVICE under ollamas.
//
// ollamas spawns ecysearch on its own port (default 3100), health-checks it, auto-restarts it on
// an unexpected exit, and never leaves an orphan. The "Search" tab embeds ecysearch's own UI (it
// serves its SPA + /api on its own origin) via an iframe — no proxy, no code merge. ecysearch's
// port is env-driven (PORT), so NOTHING in the ecysearch repo changes.
//
// Zero runtime dep: node builtins only (child_process/fetch/path/os). Pure-core (config + helpers)
// is unit-tested; the spawn/supervise singleton is thin IO.
import { spawn, type ChildProcess } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

export interface EcyConfig { dir: string; port: number; cmd: string; args: string[]; healthUrl: string }

/** Resolve config from the environment (pure). Every value is overridable; defaults assume the
 * checkout at ~/Desktop/ecysearch with deps installed. `npm run dev` = ecysearch's `tsx
 * server/index.ts` (one process, serves SPA + API). */
export function resolveEcyConfig(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): EcyConfig {
  const dir = env.ECYSEARCH_DIR || join(home, "Desktop", "ecysearch");
  const port = Number(env.ECYSEARCH_PORT) || 3100;
  // Split a command string into bin + args (no shell — spawn with an argv array, shell:false).
  const cmdStr = (env.ECYSEARCH_CMD || "npm run dev").trim();
  const [cmd, ...args] = cmdStr.split(/\s+/);
  return { dir, port, cmd, args, healthUrl: healthUrl(port) };
}

export function healthUrl(port: number): string { return `http://127.0.0.1:${port}/api/health`; }

/** Capped exponential backoff for supervised restarts (pure). attempt 0→500ms … capped at 30s. */
export function backoffMs(attempt: number, base = 500, cap = 30_000): number {
  if (attempt <= 0) return base;
  return Math.min(cap, base * 2 ** attempt);
}

/** Fixed-size FIFO log ring (last N lines). Defensive token masking (ecysearch self-masks too). */
export class RingBuffer {
  private buf: string[] = [];
  constructor(private readonly max = 200) {}
  push(line: string): void {
    const masked = line.replace(/\b(gh[posu]_[A-Za-z0-9]{16,}|AIza[0-9A-Za-z_-]{20,})\b/g, "[REDACTED]");
    for (const l of masked.split(/\r?\n/)) { if (l) this.buf.push(l); }
    if (this.buf.length > this.max) this.buf = this.buf.slice(-this.max);
  }
  lines(): string[] { return [...this.buf]; }
}

export interface EcyStatus { running: boolean; ready: boolean; port: number; pid: number | null; restarts: number; lastError: string | null }

class EcySupervisor {
  private child: ChildProcess | null = null;
  private enabled = false;
  private restarts = 0;
  private lastError: string | null = null;
  private readonly log = new RingBuffer();
  private exitHooked = false;
  private restartTimer: NodeJS.Timeout | null = null;

  private cfg(): EcyConfig { return resolveEcyConfig(); }

  /** Idempotent: start ecysearch if no live child exists. Spawns with PORT/HOST in env (no shell). */
  ensureRunning(): EcyStatus {
    this.enabled = true;
    if (this.child && this.child.exitCode === null && !this.child.killed) return this.status();
    this.hookProcessExit();
    const { dir, port, cmd, args } = this.cfg();
    try {
      const child = spawn(cmd, args, {
        cwd: dir,
        env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" },
        stdio: ["ignore", "pipe", "pipe"],
        shell: false,
      });
      this.child = child;
      this.lastError = null;
      child.stdout?.on("data", (d) => this.log.push(String(d)));
      child.stderr?.on("data", (d) => this.log.push(String(d)));
      child.on("error", (e) => { this.lastError = String((e as Error)?.message || e); this.log.push(`[spawn-error] ${this.lastError}`); });
      child.on("exit", (code, signal) => {
        this.log.push(`[exit] code=${code} signal=${signal}`);
        this.child = null;
        // Auto-restart only on an UNEXPECTED exit while still enabled (supervised, backoff).
        if (this.enabled) {
          this.restarts++;
          const delay = backoffMs(this.restarts);
          this.log.push(`[supervise] restarting in ${delay}ms (restart #${this.restarts})`);
          this.restartTimer = setTimeout(() => { if (this.enabled) this.ensureRunning(); }, delay);
          this.restartTimer.unref?.();
        }
      });
    } catch (e) {
      this.lastError = String((e as Error)?.message || e);
      this.log.push(`[spawn-throw] ${this.lastError}`);
    }
    return this.status();
  }

  /** Health probe — true once ecysearch answers /api/health (its SPA+API are up). */
  async probeReady(): Promise<boolean> {
    if (!this.child) return false;
    try {
      const res = await fetch(this.cfg().healthUrl, { signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch { return false; }
  }

  /** Stop supervising + terminate the child (no orphan). */
  stop(): EcyStatus {
    this.enabled = false;
    if (this.restartTimer) { clearTimeout(this.restartTimer); this.restartTimer = null; }
    if (this.child && this.child.exitCode === null) { try { this.child.kill("SIGTERM"); } catch { /* already gone */ } }
    this.child = null;
    return this.status();
  }

  logs(): string[] { return this.log.lines(); }

  status(): EcyStatus {
    const alive = !!(this.child && this.child.exitCode === null && !this.child.killed);
    return { running: alive, ready: false, port: this.cfg().port, pid: this.child?.pid ?? null, restarts: this.restarts, lastError: this.lastError };
  }

  /** Kill the child when ollamas itself exits — never leak a process. Registered once. */
  private hookProcessExit(): void {
    if (this.exitHooked) return;
    this.exitHooked = true;
    const kill = () => { this.enabled = false; if (this.child && this.child.exitCode === null) { try { this.child.kill("SIGTERM"); } catch { /* noop */ } } };
    process.on("exit", kill);
    process.on("SIGTERM", kill);
    process.on("SIGINT", kill);
  }
}

export const ecySupervisor = new EcySupervisor();
