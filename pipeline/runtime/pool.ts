// Warm sandbox container pool (I/O boundary).
//
// WHY THIS EXISTS
// The prompt names cold-start as a top bottleneck with a measured claim: "each sandbox_test
// spins a fresh container, inflating latency" — baseline p95 ≈ 3400 ms — and prescribes a
// pre-started pool to bring it to ≈ 300 ms. That is the single largest latency item in the
// whole DAG, so it is the one worth real machinery.
//
// Design constraints from this machine (measured, not assumed):
//   • docker daemon IS running, but no small general-purpose image was present — the local
//     set is postgres/redis/mcp servers. `alpine:3.20` (13.7 MB) was pulled once rather than
//     borrowing postgres:16-alpine (411 MB) as a shell host: a 30× larger image costs pool
//     start time on every warm-up for no benefit.
//   • The MacBook is under swap pressure, so the pool has a HARD cap and is torn down at the
//     end of the run. A leaked container here is a real cost to the operator, not a rounding
//     error — every path goes through `stop()`.
//
// Degradation is explicit: with docker unavailable the pool reports `mode: "cold"` and the
// self-audit records warmPoolUsed=false. It never pretends a cold run was warm, because the
// entire point of the measurement is to show what the pool bought.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";

const exec = promisify(execFile);

export type PoolMode = "warm" | "cold" | "unavailable";

export interface PoolOptions {
  image?: string;
  size?: number;
  /** Per-exec ceiling; the DAG's sandbox_test budget is 30 s. */
  timeoutMs?: number;
  /** Memory ceiling per container — keeps a runaway sandbox from swapping the host. */
  memory?: string;
}

export interface ExecResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** True when the work ran inside a pre-warmed container. Feeds the audit fact. */
  warm: boolean;
}

const DEFAULTS: Required<PoolOptions> = {
  image: "alpine:3.20",
  size: 5,
  timeoutMs: 30_000,
  memory: "256m",
};

async function docker(args: string[], timeoutMs = 20_000): Promise<{ stdout: string; stderr: string }> {
  // execFile, never a shell: sandbox payloads are attacker-shaped by definition, and a shell
  // here would turn "run this snippet" into "run this snippet plus whatever it can quote".
  return exec("docker", args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 });
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    await docker(["info", "--format", "{{.ServerVersion}}"], 8_000);
    return true;
  } catch {
    return false;
  }
}

export class WarmPool {
  readonly opts: Required<PoolOptions>;
  /**
   * Per-instance label.
   *
   * MEASURED BUG: `stop()` originally swept every container labelled `ecym-pipeline=sandbox`.
   * With two pipelines in flight (`bench --concurrency 2`) the first run to finish deleted the
   * SECOND run's warm containers mid-flight, and chaos success fell to 0.5 — a failure that
   * never reproduced in isolation because it needs two pools alive at once. Each pool now owns
   * a uuid and only ever removes its own; the broad sweep moved to `sweepOrphans()`, which the
   * CLI calls when nothing else is running.
   */
  readonly poolId = randomUUID().slice(0, 8);
  private idle: string[] = [];
  private busy = new Set<string>();
  mode: PoolMode = "unavailable";

  constructor(opts: PoolOptions = {}) {
    this.opts = { ...DEFAULTS, ...opts };
  }

  /**
   * Pre-start `size` containers. Partial success is still a warm pool: if 3 of 5 start, the
   * run proceeds with 3 rather than falling back to cold — the operator gets the speed-up
   * that is actually available instead of an all-or-nothing failure.
   */
  async start(): Promise<PoolMode> {
    if (!(await dockerAvailable())) {
      this.mode = "unavailable";
      return this.mode;
    }
    const started = await Promise.all(
      Array.from({ length: this.opts.size }, async () => {
        try {
          const { stdout } = await docker([
            "run", "-d", "--rm",
            "--memory", this.opts.memory,
            "--network", "none",       // sandbox: no egress unless a fault injector adds it
            "--label", "ecym-pipeline=sandbox",
            "--label", `ecym-pool=${this.poolId}`,
            this.opts.image, "sleep", "3600",
          ]);
          return stdout.trim();
        } catch {
          return "";
        }
      }),
    );
    this.idle = started.filter(Boolean);
    this.mode = this.idle.length ? "warm" : "cold";
    return this.mode;
  }

  get available(): number {
    return this.idle.length;
  }

  /**
   * Run a command in the sandbox.
   *
   * Warm path: `docker exec` into an already-running container. Cold path: `docker run`,
   * paying the start cost — kept as a working fallback so a pool failure degrades to slow
   * rather than to broken. `warm` in the result says which path ran, so the reported
   * speed-up can never be attributed to a container that was never warmed.
   */
  async run(cmd: string[]): Promise<ExecResult> {
    const t0 = Date.now();
    const id = this.idle.pop();
    if (id) this.busy.add(id);
    try {
      const args = id
        ? ["exec", id, ...cmd]
        : ["run", "--rm", "--memory", this.opts.memory, "--network", "none", this.opts.image, ...cmd];
      const { stdout, stderr } = await docker(args, this.opts.timeoutMs);
      return { ok: true, stdout, stderr, durationMs: Date.now() - t0, warm: Boolean(id) };
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message?: string };
      return {
        ok: false,
        stdout: err.stdout ?? "",
        stderr: err.stderr ?? err.message ?? String(e),
        durationMs: Date.now() - t0,
        warm: Boolean(id),
      };
    } finally {
      if (id) {
        this.busy.delete(id);
        this.idle.push(id);   // return it to the pool; it stays warm for the next borrow
      }
    }
  }

  /**
   * Tear every container down. Safe to call twice, and it also sweeps by LABEL, not just by
   * the ids this instance remembers: a crashed run leaves containers whose ids died with the
   * process, and on a machine already short on memory those would linger for an hour.
   */
  async stop(): Promise<number> {
    const known = [...this.idle, ...this.busy];
    this.idle = [];
    this.busy.clear();
    let removed = 0;
    for (const id of known) {
      try {
        await docker(["rm", "-f", id], 15_000);
        removed++;
      } catch {
        /* already gone */
      }
    }
    // Only THIS pool's leftovers — never the broad label (see poolId).
    try {
      const { stdout } = await docker(["ps", "-aq", "--filter", `label=ecym-pool=${this.poolId}`], 10_000);
      for (const id of stdout.split("\n").map((s) => s.trim()).filter(Boolean)) {
        try {
          await docker(["rm", "-f", id], 15_000);
          removed++;
        } catch {
          /* raced with --rm */
        }
      }
    } catch {
      /* docker went away mid-run; nothing further we can do */
    }
    return removed;
  }
}

/**
 * Remove sandbox containers left by CRASHED runs.
 *
 * Safe only when no pipeline is in flight, because it matches every pool. The CLI calls it
 * before a benchmark starts; `WarmPool.stop()` deliberately does not, so concurrent pools
 * cannot delete each other's containers.
 */
export async function sweepOrphans(): Promise<number> {
  try {
    const { stdout } = await docker(["ps", "-aq", "--filter", "label=ecym-pipeline=sandbox"], 10_000);
    const ids = stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    let n = 0;
    for (const id of ids) {
      try {
        await docker(["rm", "-f", id], 15_000);
        n++;
      } catch {
        /* already gone */
      }
    }
    return n;
  } catch {
    return 0;
  }
}

/** Shell-free snippet runner used by the sandbox_test step. */
export function shellSnippet(code: string): string[] {
  return ["sh", "-c", code];
}
