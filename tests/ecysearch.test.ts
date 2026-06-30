/**
 * ecysearch supervisor — pure config/helpers + mocked-spawn supervision (hermetic, no real child).
 */
import { describe, it, test, expect, vi } from "vitest";

const h = vi.hoisted(() => {
  const child: any = {
    pid: 4242, exitCode: null, killed: false,
    kill: vi.fn((_sig?: string) => { child.killed = true; return true; }),
    stdout: { on: () => {} }, stderr: { on: () => {} }, on: () => {},
  };
  return { child, spawn: vi.fn(() => child) };
});
vi.mock("node:child_process", () => ({ spawn: h.spawn }));

import { resolveEcyConfig, healthUrl, backoffMs, RingBuffer, ecySupervisor } from "../server/ecysearch";

describe("resolveEcyConfig (pure)", () => {
  it("defaults to ~/Desktop/ecysearch on port 3100 via `npm run dev`", () => {
    const c = resolveEcyConfig({}, "/home/u");
    expect(c.dir).toBe("/home/u/Desktop/ecysearch");
    expect(c.port).toBe(3100);
    expect(c.cmd).toBe("npm");
    expect(c.args).toEqual(["run", "dev"]);
    expect(c.healthUrl).toBe("http://127.0.0.1:3100/api/health");
  });
  it("honors env overrides + splits the command (no shell)", () => {
    const c = resolveEcyConfig({ ECYSEARCH_DIR: "/x", ECYSEARCH_PORT: "4000", ECYSEARCH_CMD: "node srv.js" } as any, "/home");
    expect(c.dir).toBe("/x");
    expect(c.port).toBe(4000);
    expect(c.cmd).toBe("node");
    expect(c.args).toEqual(["srv.js"]);
  });
});

describe("pure helpers", () => {
  it("healthUrl", () => expect(healthUrl(3100)).toBe("http://127.0.0.1:3100/api/health"));
  it("backoffMs is monotone and capped", () => {
    expect(backoffMs(0)).toBe(500);
    expect(backoffMs(1)).toBe(1000);
    expect(backoffMs(2)).toBe(2000);
    expect(backoffMs(99)).toBe(30_000); // capped
  });
  it("RingBuffer caps to N (FIFO) and masks tokens", () => {
    const rb = new RingBuffer(2);
    rb.push("a"); rb.push("b"); rb.push("c");
    expect(rb.lines()).toEqual(["b", "c"]);
    const masked = new RingBuffer(5);
    masked.push("using ghp_ABCDEFGHIJKLMNOPQRST now");
    expect(masked.lines().join("")).not.toContain("ghp_ABCDEFGHIJKLMNOPQRST");
    expect(masked.lines().join("")).toContain("[REDACTED]");
  });
});

describe("supervisor spawn/idempotency/stop (mocked child)", () => {
  test("ensureRunning spawns once with PORT+cwd, is idempotent, stop kills", () => {
    h.spawn.mockClear();
    h.child.exitCode = null; h.child.killed = false; h.child.kill.mockClear();

    const s1 = ecySupervisor.ensureRunning();
    expect(h.spawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = h.spawn.mock.calls[0] as any;
    expect(cmd).toBe("npm");
    expect(args).toEqual(["run", "dev"]);
    expect(opts.cwd).toContain("ecysearch");
    expect(opts.env.PORT).toBe("3100");
    expect(opts.env.HOST).toBe("127.0.0.1");
    expect(opts.shell).toBe(false);
    expect(s1.running).toBe(true);

    ecySupervisor.ensureRunning(); // live child → no second spawn
    expect(h.spawn).toHaveBeenCalledTimes(1);

    const s2 = ecySupervisor.stop();
    expect(h.child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(s2.running).toBe(false);
  });
});
