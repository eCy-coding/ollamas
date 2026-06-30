// server/ecysearcher.ts — supervise the eCySearcher threat-intel DOCKER-COMPOSE stack under ollamas.
//
// Unlike the sibling ecysearch (one spawned node process), eCySearcher is a docker-compose stack
// (Postgres + Redis + Flask). So supervision is HEALTH-DRIVEN: a background loop probes the Flask
// API; if it is unhealthy for N ticks the supervisor runs `docker compose up -d` to self-heal, with
// the SAME exponential backoff + crash-loop circuit breaker as ecysearch (reused, DRY). State,
// Prometheus metrics + recent container logs are exposed for the cockpit. Never touches :3000/:3020
// or the operator's other containers — it only drives eCySearcher's own compose project on the
// remapped (AirPlay/ecypro-safe) host ports.
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { backoffMs, isCrashLoop, shouldResetBackoff, RingBuffer } from "./ecysearch";
import { appendLogLine, fmtLogLine } from "./logfile";
import { ecysearcherRestartsTotal, ecysearcherUp, ecysearcherReady } from "./metrics";

export interface EcysearcherConfig { dir: string; baseUrl: string; healthUrl: string; logFile: string }

const DEFAULT_DIR = "/Users/emrecnyngmail.com/projem/eCySearcher";

/** Remapped host ports (dodge macOS AirPlay :5000 + the existing ecypro-* containers). Pure. */
export function composeEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    API_PORT: env.ECYSEARCHER_API_PORT || "5055",
    DB_PORT: env.ECYSEARCHER_DB_PORT || "5433",
    REDIS_PORT: env.ECYSEARCHER_REDIS_PORT || "6380",
    FRONTEND_PORT: env.ECYSEARCHER_FRONTEND_PORT || "8088",
  };
}

/** Resolve config (pure). baseUrl honors ECYSEARCHER_URL, else the remapped API port (default 5055). */
export function resolveConfig(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): EcysearcherConfig {
  const dir = env.ECYSEARCHER_DIR || DEFAULT_DIR;
  const base = env.ECYSEARCHER_URL
    ? env.ECYSEARCHER_URL.replace(/\/$/, "")
    : `http://localhost:${env.ECYSEARCHER_API_PORT || "5055"}`;
  const dataDir = env.MISSION_CONTROL_DATA_DIR || join(home, ".llm-mission-control");
  return { dir, baseUrl: base, healthUrl: `${base}/`, logFile: join(dataDir, "ecysearcher.log") };
}

/** Is the eCySearcher `backend` service running, per `docker compose ps --format json`? Pure +
 *  tolerant: compose v2 emits either a JSON array or one object per line. */
export function parseComposeRunning(stdout: string, service = "backend"): boolean {
  const text = (stdout || "").trim();
  if (!text) return false;
  const rows: any[] = [];
  try {
    const asArray = JSON.parse(text);
    if (Array.isArray(asArray)) rows.push(...asArray);
    else rows.push(asArray);
  } catch {
    for (const line of text.split(/\r?\n/)) { if (line.trim()) { try { rows.push(JSON.parse(line)); } catch { /* skip */ } } }
  }
  return rows.some((r) => (r?.Service === service || r?.Name?.includes(service)) && String(r?.State || "").toLowerCase().startsWith("running"));
}

export type EcyState = "stopped" | "starting" | "ready" | "unhealthy" | "crashed";
export interface EcysearcherStatus {
  state: EcyState; running: boolean; ready: boolean; baseUrl: string; startedAt: number | null;
  uptimeMs: number; lastReadyAt: number | null; restarts: number; consecutiveFailures: number;
  circuitOpen: boolean; logFile: string;
}

const HEALTH_INTERVAL_MS = 5000;
const UNHEALTHY_THRESHOLD = 4; // ~20s failing while supposedly up → heal

function dockerCompose(args: string[], dir: string, env: NodeJS.ProcessEnv): Promise<{ code: number; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn("docker", ["compose", ...args], { cwd: dir, env: composeEnv(env), stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout?.on("data", (d) => { out += String(d); });
    child.stderr?.on("data", (d) => { out += String(d); });
    child.on("error", () => resolve({ code: 127, stdout: out }));
    child.on("close", (c) => resolve({ code: c ?? 0, stdout: out }));
  });
}

class EcysearcherSupervisor {
  private enabled = false;
  private starting = false;
  private state: EcyState = "stopped";
  private startedAt: number | null = null;
  private lastReadyAt: number | null = null;
  private consecutiveFailures = 0;
  private restartTimes: number[] = [];
  private restartsTotal = 0;
  private readonly log = new RingBuffer();
  private healthTimer: NodeJS.Timeout | null = null;
  private healing = false;

  private cfg(): EcysearcherConfig { return resolveConfig(); }

  private record(level: string, msg: string): void {
    const line = fmtLogLine(new Date().toISOString(), level, msg);
    this.log.push(line);
    try { appendLogLine(this.cfg().logFile, line, { maxBytes: 1_000_000, keep: 5 }); } catch { /* best-effort */ }
  }

  /** Start supervising: `docker compose up -d --build` then the health loop self-heals. Idempotent.
   *  `manual` reopens a tripped circuit. */
  async ensureRunning(opts: { manual?: boolean } = {}): Promise<EcysearcherStatus> {
    this.enabled = true;
    if (opts.manual && (this.state === "crashed" || this.restartTimes.length)) {
      this.restartTimes = [];
      if (this.state === "crashed") this.state = "stopped";
      this.record("info", "[supervise] manual start — circuit reset");
    }
    if (this.state === "crashed") return this.status(); // circuit open — manual only
    if (!this.starting) {
      this.starting = true;
      this.state = "starting";
      this.startedAt = Date.now();
      ecysearcherUp.set(1);
      await this.composeUp("start");
      this.starting = false;
      this.startHealthLoop();
    }
    return this.status();
  }

  private async composeUp(reason: string): Promise<void> {
    this.record("info", `[supervise] docker compose up -d --build (${reason})`);
    const r = await dockerCompose(["up", "-d", "--build"], this.cfg().dir, process.env);
    if (r.code !== 0) this.record("err", `[supervise] compose up exited ${r.code}: ${r.stdout.trim().slice(-240)}`);
  }

  private startHealthLoop(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => { void this.healthTick(); }, HEALTH_INTERVAL_MS);
    this.healthTimer.unref?.();
  }
  private stopHealthLoop(): void {
    if (this.healthTimer) { clearInterval(this.healthTimer); this.healthTimer = null; }
  }

  async probeReady(): Promise<boolean> {
    try {
      const res = await fetch(this.cfg().healthUrl, { signal: AbortSignal.timeout(2500) });
      return res.ok;
    } catch { return false; }
  }

  private async healthTick(): Promise<void> {
    if (!this.enabled || this.healing) return;
    const ok = await this.probeReady();
    if (ok) {
      ecysearcherReady.set(1);
      this.consecutiveFailures = 0;
      this.lastReadyAt = Date.now();
      if (this.state !== "ready") { this.state = "ready"; this.record("info", "[supervise] healthy → ready"); }
      if (this.startedAt && shouldResetBackoff(Date.now() - this.startedAt) && this.restartTimes.length) {
        this.restartTimes = [];
        this.record("info", "[supervise] stable uptime — backoff reset");
      }
      return;
    }
    ecysearcherReady.set(0);
    this.consecutiveFailures++;
    if (this.consecutiveFailures < UNHEALTHY_THRESHOLD) return;

    // Unhealthy → self-heal (with crash-loop circuit breaker + backoff).
    this.state = "unhealthy";
    const now = Date.now();
    if (isCrashLoop(this.restartTimes, now)) {
      this.state = "crashed";
      this.record("err", `[supervise] crash-loop (${this.restartTimes.length} heals/min) — circuit OPEN; manual start to retry`);
      this.stopHealthLoop();
      ecysearcherUp.set(0);
      return;
    }
    this.restartTimes.push(now);
    this.restartsTotal++;
    ecysearcherRestartsTotal.inc();
    this.consecutiveFailures = 0;
    const delay = backoffMs(this.restartTimes.length);
    this.record("err", `[supervise] unhealthy — healing in ${delay}ms (heal #${this.restartsTotal})`);
    this.healing = true;
    setTimeout(async () => {
      if (this.enabled && this.state !== "crashed") { this.startedAt = Date.now(); await this.composeUp("heal"); }
      this.healing = false;
    }, delay).unref?.();
  }

  /** Stop supervising + `docker compose down`. */
  async stop(): Promise<EcysearcherStatus> {
    this.enabled = false;
    this.stopHealthLoop();
    this.record("info", "[supervise] docker compose down");
    await dockerCompose(["down"], this.cfg().dir, process.env);
    this.state = "stopped";
    ecysearcherUp.set(0);
    ecysearcherReady.set(0);
    return this.status();
  }

  /** Halt supervision (health loop) WITHOUT tearing down the containers — for ollamas shutdown, so
   *  eCySearcher keeps running independently. (Use stop() for an explicit `docker compose down`.) */
  haltSupervision(): void {
    this.enabled = false;
    this.stopHealthLoop();
  }

  /** Recent eCySearcher container logs (+ the supervisor's own event ring as a fallback). */
  async recentLogs(limit = 200): Promise<string[]> {
    try {
      const r = await dockerCompose(["logs", "--no-color", "--tail", String(limit)], this.cfg().dir, process.env);
      const lines = r.stdout.split(/\r?\n/).filter(Boolean);
      if (lines.length) return lines.slice(-limit);
    } catch { /* fall through */ }
    return this.log.lines().slice(-limit);
  }

  status(): EcysearcherStatus {
    const uptimeMs = this.startedAt && this.state === "ready" ? Date.now() - this.startedAt : 0;
    return {
      state: this.state, running: this.enabled && this.state !== "stopped" && this.state !== "crashed",
      ready: this.state === "ready", baseUrl: this.cfg().baseUrl, startedAt: this.startedAt, uptimeMs,
      lastReadyAt: this.lastReadyAt, restarts: this.restartsTotal, consecutiveFailures: this.consecutiveFailures,
      circuitOpen: this.state === "crashed", logFile: this.cfg().logFile,
    };
  }
}

export const ecysearcherSupervisor = new EcysearcherSupervisor();
