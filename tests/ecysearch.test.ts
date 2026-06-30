/**
 * ecysearch supervisor — pure config/algorithm helpers + mocked-spawn supervision (hermetic).
 */
import { describe, it, test, expect, vi, afterEach } from "vitest";

const h = vi.hoisted(() => {
  const handlers: Record<string, ((...a: any[]) => void)[]> = {};
  const child: any = {
    pid: 4242, exitCode: null, killed: false,
    kill: vi.fn((_sig?: string) => { child.killed = true; return true; }),
    stdout: { on: () => {} }, stderr: { on: () => {} },
    on: (ev: string, cb: (...a: any[]) => void) => { (handlers[ev] ||= []).push(cb); return child; },
    emit: (ev: string, ...a: any[]) => { (handlers[ev] || []).forEach((f) => f(...a)); },
  };
  // each spawn = a fresh process: clear prior handlers (real ChildProcess objects don't share them)
  const spawn = vi.fn(() => { for (const k of Object.keys(handlers)) delete handlers[k]; child.exitCode = null; child.killed = false; return child; });
  return { child, spawn, handlers };
});
vi.mock("node:child_process", () => ({ spawn: h.spawn }));

import { resolveEcyConfig, healthUrl, backoffMs, isCrashLoop, shouldResetBackoff, RingBuffer, ecySupervisor } from "../server/ecysearch";

describe("resolveEcyConfig (pure)", () => {
  it("defaults to ~/Desktop/ecysearch :3100 + a logFile under the data dir", () => {
    const c = resolveEcyConfig({}, "/home/u");
    expect(c.dir).toBe("/home/u/Desktop/ecysearch");
    expect(c.port).toBe(3100);
    expect(c.cmd).toBe("npm");
    expect(c.args).toEqual(["run", "dev"]);
    expect(c.healthUrl).toBe("http://127.0.0.1:3100/api/health");
    expect(c.logFile).toBe("/home/u/.llm-mission-control/ecysearch.log");
  });
  it("honors env overrides (incl MISSION_CONTROL_DATA_DIR) + splits the command", () => {
    const c = resolveEcyConfig({ ECYSEARCH_DIR: "/x", ECYSEARCH_PORT: "4000", ECYSEARCH_CMD: "node srv.js", MISSION_CONTROL_DATA_DIR: "/data" } as any, "/home");
    expect(c.dir).toBe("/x"); expect(c.port).toBe(4000);
    expect(c.cmd).toBe("node"); expect(c.args).toEqual(["srv.js"]);
    expect(c.logFile).toBe("/data/ecysearch.log");
  });
});

describe("algorithm helpers (pure)", () => {
  it("healthUrl", () => expect(healthUrl(3100)).toBe("http://127.0.0.1:3100/api/health"));
  it("backoffMs monotone + capped", () => {
    expect(backoffMs(0)).toBe(500); expect(backoffMs(2)).toBe(2000); expect(backoffMs(99)).toBe(30_000);
  });
  it("isCrashLoop: ≥max restarts within the window = true; sparse/old = false", () => {
    const now = 1_000_000;
    expect(isCrashLoop([now, now - 1000, now - 2000, now - 3000, now - 4000], now, 5, 60_000)).toBe(true);
    expect(isCrashLoop([now, now - 1000], now, 5, 60_000)).toBe(false); // too few
    expect(isCrashLoop([now - 70_000, now - 80_000, now - 90_000, now - 100_000, now - 110_000], now, 5, 60_000)).toBe(false); // all outside window
  });
  it("shouldResetBackoff once uptime ≥ stableMs", () => {
    expect(shouldResetBackoff(59_000, 60_000)).toBe(false);
    expect(shouldResetBackoff(60_000, 60_000)).toBe(true);
  });
  it("RingBuffer caps FIFO + masks tokens", () => {
    const rb = new RingBuffer(2); rb.push("a"); rb.push("b"); rb.push("c");
    expect(rb.lines()).toEqual(["b", "c"]);
    const m = new RingBuffer(5); m.push("x ghp_ABCDEFGHIJKLMNOPQRST y");
    expect(m.lines().join("")).not.toContain("ghp_ABCDEFGHIJKLMNOPQRST");
  });
});

describe("supervisor state machine (mocked child)", () => {
  afterEach(() => { ecySupervisor.stop(); h.spawn.mockClear(); h.child.kill.mockClear(); });

  test("ensureRunning spawns once with PORT+cwd, idempotent; stop kills + state stopped", () => {
    h.spawn.mockClear(); h.child.exitCode = null; h.child.killed = false;
    const s1 = ecySupervisor.ensureRunning({ manual: true });
    expect(h.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = h.spawn.mock.calls[0] as any;
    expect(cmd).toBe("npm"); expect(args).toEqual(["run", "dev"]);
    expect(opts.env.PORT).toBe("3100"); expect(opts.env.HOST).toBe("127.0.0.1"); expect(opts.shell).toBe(false);
    expect(opts.detached).toBe(true); // own process group → killGroup reaps the npm grandchild
    expect(s1.state).toBe("starting"); expect(s1.running).toBe(true);
    ecySupervisor.ensureRunning(); // live child → no second spawn
    expect(h.spawn).toHaveBeenCalledTimes(1);
    const s2 = ecySupervisor.stop();
    expect(h.child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(s2.state).toBe("stopped"); expect(s2.running).toBe(false);
  });

  test("an unexpected exit increments restarts + schedules a restart (state starting)", () => {
    ecySupervisor.ensureRunning({ manual: true });
    h.child.exitCode = 1;
    h.child.emit("exit", 1, null); // child died
    const s = ecySupervisor.status();
    expect(s.restarts).toBe(1);
    expect(s.lastExitCode).toBe(1);
    expect(s.state).toBe("starting"); // supervised restart pending (backoff)
  });

  test("crash loop trips the circuit (state crashed); a manual start resets it", () => {
    ecySupervisor.ensureRunning({ manual: true });
    for (let i = 0; i < 5; i++) { h.child.exitCode = 1; h.child.emit("exit", 1, null); } // 5 rapid exits
    const crashed = ecySupervisor.status();
    expect(crashed.state).toBe("crashed");
    expect(crashed.circuitOpen).toBe(true);
    const spawnsBefore = h.spawn.mock.calls.length;
    const reset = ecySupervisor.ensureRunning({ manual: true }); // operator retry
    expect(reset.circuitOpen).toBe(false);
    expect(reset.state).toBe("starting");
    expect(h.spawn.mock.calls.length).toBe(spawnsBefore + 1); // respawned on manual reset
  });
});
