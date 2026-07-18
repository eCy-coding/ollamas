// Faz 27 (v1.18) — consume-side upstream resilience supervisor. Hermetic: the
// client module (connectUpstream/pingUpstream/disconnectUpstream) is mocked so the
// supervisor's health-check + backoff + circuit-breaker + reconnect logic is tested
// without real subprocesses. Critical security test: reconnect preserves the owner
// (tenantId) so a per-tenant upstream tool is never demoted to shared (Faz 24).
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";

const { connectUpstream, pingUpstream, disconnectUpstream } = vi.hoisted(() => ({
  connectUpstream: vi.fn(),
  pingUpstream: vi.fn(),
  disconnectUpstream: vi.fn(),
}));
vi.mock("../server/mcp/client", () => ({ connectUpstream, pingUpstream, disconnectUpstream }));

let sup: typeof import("../server/mcp/supervisor");

const ok = (name: string, toolNames: string[] = ["ping"]) => ({ name, ok: true, tools: toolNames.length, toolNames });
const fail = (name: string) => ({ name, ok: false, tools: 0, error: "boom" });
const cfg = (name: string) => ({ name, transport: "stdio" as const, command: "x" });
const status = (name: string) => sup.getUpstreamStatus().find((s) => s.name === name)!;
const FAR = () => Date.now() + 10_000_000;

beforeEach(async () => {
  vi.clearAllMocks();
  process.env.MCP_CB_BASE_BACKOFF_MS = "1000";
  process.env.MCP_CB_MAX_BACKOFF_MS = "8000";
  process.env.MCP_CB_MAX_CYCLES = "3";
  process.env.MCP_CB_COOLDOWN_MS = "60000";
  sup = await import("../server/mcp/supervisor");
  sup.resetSupervisor();
});
afterEach(() => sup.resetSupervisor());

describe("computeBackoff", () => {
  test("exponential with cap", () => {
    expect(sup.computeBackoff(1)).toBe(1000);
    expect(sup.computeBackoff(2)).toBe(2000);
    expect(sup.computeBackoff(3)).toBe(4000);
    expect(sup.computeBackoff(99)).toBe(8000); // capped at MAX
  });
});

describe("circuit breaker", () => {
  test("repeated failures open the circuit after MAX_CYCLES", async () => {
    connectUpstream.mockResolvedValue(fail("s1"));
    await sup.superviseUpstream(cfg("s1")); // cycle 1 → degraded
    await sup.tickOnce(FAR());              // cycle 2
    await sup.tickOnce(FAR());              // cycle 3 → circuit open
    expect(status("s1").circuitOpen).toBe(true);
    expect(status("s1").state).toBe("down");
  });
});

describe("owner-preserving reconnect (Faz 24 isolation)", () => {
  test("reconnect re-registers with the SAME owner", async () => {
    connectUpstream.mockResolvedValue(ok("tA_srv"));
    await sup.superviseUpstream(cfg("tA_srv"), "tenantA");
    expect(connectUpstream).toHaveBeenLastCalledWith(expect.objectContaining({ name: "tA_srv" }), "tenantA");

    pingUpstream.mockResolvedValue(false); // health check fails
    await sup.tickOnce();        // connected + ping fail → degraded
    await sup.tickOnce(FAR());   // due → reconnect

    expect(disconnectUpstream).toHaveBeenCalledWith("tA_srv"); // reconnect dropped the old conn
    expect(connectUpstream).toHaveBeenLastCalledWith(expect.objectContaining({ name: "tA_srv" }), "tenantA");
  });
});

describe("health check", () => {
  test("a connected upstream whose ping fails becomes degraded", async () => {
    connectUpstream.mockResolvedValue(ok("s2"));
    await sup.superviseUpstream(cfg("s2"));
    pingUpstream.mockResolvedValue(false);
    await sup.tickOnce();
    expect(status("s2").state).toBe("degraded");
  });

  test("a healthy ping keeps it connected", async () => {
    connectUpstream.mockResolvedValue(ok("s3"));
    await sup.superviseUpstream(cfg("s3"));
    pingUpstream.mockResolvedValue(true);
    await sup.tickOnce();
    expect(status("s3").state).toBe("connected");
  });
});

describe("collisions + remove", () => {
  test("same raw tool from two upstreams = collision; removeUpstream clears it", async () => {
    connectUpstream.mockResolvedValueOnce(ok("a", ["dup"]));
    connectUpstream.mockResolvedValueOnce(ok("b", ["dup"]));
    await sup.superviseUpstream(cfg("a"));
    await sup.superviseUpstream(cfg("b"));
    expect(sup.getCollisions().find((c) => c.tool === "dup")?.upstreams.sort()).toEqual(["a", "b"]);

    await sup.removeUpstream("a");
    expect(sup.getCollisions().find((c) => c.tool === "dup")).toBeUndefined();
    expect(sup.getUpstreamStatus().some((s) => s.name === "a")).toBe(false);
    expect(disconnectUpstream).toHaveBeenCalledWith("a");
  });
});

// B2 regression (bug 1): startSupervisor's default was 0 (opt-in), so the loop never
// started and the whole backoff/circuit-breaker machinery above was dead code unless an
// operator explicitly set MCP_HEALTH_INTERVAL_MS. Default is now 30s; "0" stays the
// explicit opt-out.
describe("startSupervisor — default interval (B2 bug 1)", () => {
  afterEach(() => sup.stopSupervisor());

  test("the health-check loop starts when MCP_HEALTH_INTERVAL_MS is unset", () => {
    delete process.env.MCP_HEALTH_INTERVAL_MS;
    expect(sup.isSupervisorRunning()).toBe(false);
    sup.startSupervisor();
    expect(sup.isSupervisorRunning()).toBe(true);
  });

  test('the loop does NOT start when MCP_HEALTH_INTERVAL_MS="0" (explicit opt-out)', () => {
    process.env.MCP_HEALTH_INTERVAL_MS = "0";
    sup.startSupervisor();
    expect(sup.isSupervisorRunning()).toBe(false);
    delete process.env.MCP_HEALTH_INTERVAL_MS;
  });
});

// B2 regression (bug 2): setInterval's tick callback didn't await tickOnce(), so with
// ~12 upstreams a slow tick (serial ping+reconnect) could outlive the interval and
// overlap the next tick — two concurrent tickOnce() passes then both try to reconnect
// the same down upstream, spawning duplicate subprocesses. reconnect() must be
// single-flight per upstream regardless of which caller raced in.
describe("overlapping ticks — single-flight reconnect (B2 bug 2)", () => {
  test("two concurrent tickOnce() calls reconnect a down upstream exactly once", async () => {
    connectUpstream.mockResolvedValueOnce(fail("loc2"));
    await sup.superviseUpstream(cfg("loc2")); // degraded, nextRetryAt computed
    expect(status("loc2").state).toBe("degraded");

    // The reconnect attempt itself resolves ~100ms later (mirrors a real spawn/connect
    // taking real time) — long enough that a second overlapping tick would otherwise
    // race in and start its own reconnect before the first one lands.
    connectUpstream.mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(() => resolve(fail("loc2")), 100))
    );

    const t = FAR();
    await Promise.all([sup.tickOnce(t), sup.tickOnce(t)]);

    expect(connectUpstream).toHaveBeenCalledTimes(2); // 1 initial supervise + exactly 1 reconnect
    expect(disconnectUpstream).toHaveBeenCalledTimes(1); // reconnect drops the old conn exactly once
    expect(status("loc2").reconnects).toBe(1);
  });
});
