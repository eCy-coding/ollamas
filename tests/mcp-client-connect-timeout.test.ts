// FIX B1 — connectUpstream() (server/mcp/client.ts) had no bounded connect
// timeout: client.connect(), client.listTools(), and the roots/list request
// each inherited the MCP SDK's DEFAULT_REQUEST_TIMEOUT_MSEC (60000ms). Three
// sequential unguarded calls meant one dead/unreachable upstream could burn up
// to 180s of boot time, and — for stdio upstreams — a timed-out connect left
// the spawned child process running forever (nothing ever called
// transport.close()).
//
// This proves: (1) a stdio upstream that never speaks MCP is bailed out of
// fast via MCP_CONNECT_TIMEOUT_MS instead of the 60s SDK default, and (2) the
// spawned child does not leak — it is reaped rather than left running.
//
// Timing note: the MCP SDK's own Client.connect() already fires an unawaited
// `void this.close()` when the initialize handshake rejects, which wins the
// race to null out the transport's internal process handle before our own
// `await transport?.close()` (server/mcp/client.ts catch block) gets to run —
// so our call becomes a harmless no-op for THIS specific failure path (it is
// the only cleanup for the listTools()/roots-list timeout paths, which have
// no such SDK-internal safety net). The child's actual SIGTERM/SIGKILL still
// happens, just ~2s after connectUpstream() has already returned (verified
// empirically). We therefore poll for death in a bounded window after
// connectUpstream() resolves rather than asserting it synchronously — an
// immediate check would be a false negative, not evidence of a real leak.
import { describe, test, expect, afterEach, vi } from "vitest";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false; // ESRCH -> process is gone
  }
}

async function waitUntilDead(pid: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (isAlive(pid)) {
    if (Date.now() - start > timeoutMs) return false;
    await new Promise((r) => setTimeout(r, 50));
  }
  return true;
}

describe("connectUpstream — bounded connect timeout + child reaping (FIX B1)", () => {
  const prevTimeout = process.env.MCP_CONNECT_TIMEOUT_MS;

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevTimeout === undefined) delete process.env.MCP_CONNECT_TIMEOUT_MS;
    else process.env.MCP_CONNECT_TIMEOUT_MS = prevTimeout;
  });

  test("a non-MCP-speaking stdio upstream fails fast (ok:false) and its spawned child does not leak", async () => {
    process.env.MCP_CONNECT_TIMEOUT_MS = "500";

    // Wrap the REAL close() (not a stub) so the genuine SIGTERM/SIGKILL cleanup
    // still runs — we only intercept it to capture the child pid before the
    // SDK's internal bookkeeping clears it, and to prove close() gets exercised
    // on the failure path.
    const originalClose = StdioClientTransport.prototype.close;
    let capturedPid: number | null = null;
    const closeSpy = vi
      .spyOn(StdioClientTransport.prototype, "close")
      .mockImplementation(async function (this: StdioClientTransport) {
        if (capturedPid === null) capturedPid = this.pid;
        return originalClose.call(this);
      });

    const { connectUpstream } = await import("../server/mcp/client");

    const started = Date.now();
    const result = await connectUpstream({
      name: "dead-upstream-b1",
      transport: "stdio",
      command: "node",
      args: ["-e", "setInterval(()=>{},1000)"],
    });
    const elapsed = Date.now() - started;

    expect(result.ok).toBe(false);
    expect(result.tools).toBe(0);
    expect(typeof result.error).toBe("string");

    // Bounded by MCP_CONNECT_TIMEOUT_MS (500ms) + scheduling overhead — a world
    // away from the old worst case (up to 180s for a dead upstream, and no
    // bound at all if the process never spoke MCP and never errored on its own).
    expect(elapsed).toBeLessThan(4000);

    // close() was exercised on the failure path (our fix's own call, and/or the
    // SDK's internal one — either way the transport is not simply abandoned).
    expect(closeSpy).toHaveBeenCalled();
    expect(capturedPid).not.toBeNull();

    // The spawned child must not be leaked: it eventually dies. Poll rather
    // than check synchronously (see file header for why an immediate check
    // would be a false negative).
    const died = await waitUntilDead(capturedPid as number, 5000);
    expect(died).toBe(true);
  }, 15000);
});
