// FIX B3 (lazy/non-blocking MCP-Consume upstream connect) + FIX B5 (shutdown drain
// correctness) — TDD regression guards for server.ts + server/mcp/supervisor.ts.
//
// Hermetic: no real network, no real MCP upstream. The upstream client
// (connectUpstream/pingUpstream/disconnectUpstream) is mocked exactly like
// tests/upstream-supervisor.test.ts, so these tests never spawn a real npx/python3
// subprocess even though tools.json declares real `mcpServers` entries.
import { describe, test, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import http from "node:http";
import path from "node:path";
import os from "node:os";

const { connectUpstream, pingUpstream, disconnectUpstream } = vi.hoisted(() => ({
  connectUpstream: vi.fn(),
  pingUpstream: vi.fn(),
  disconnectUpstream: vi.fn(),
}));
vi.mock("../server/mcp/client", () => ({ connectUpstream, pingUpstream, disconnectUpstream }));

// ---------------------------------------------------------------------------
// FIX B5 — drainHttp(): server.close(cb)'s callback previously never fired while
// an SSE-style client stayed attached (no res.end()) — /api/cockpit/stream and
// /api/telemetry/stream never close on their own — so the SHUTDOWN_GRACE_MS force
// timer fired `process.exit(1)` on every restart. drainHttp() must resolve well
// inside its `graceMs` even with such a connection open, by forcibly closing it.
// ---------------------------------------------------------------------------
describe("drainHttp (FIX B5)", () => {
  test("resolves quickly even with a never-ending chunked response attached", async () => {
    process.env.OLLAMAS_NO_AUTOBOOT = "1"; // import "../server" WITHOUT booting the real stack
    const { drainHttp } = await import("../server");

    const httpServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.write("start\n"); // never calls res.end() — mirrors an attached SSE client
      const tick = setInterval(() => { try { res.write("tick\n"); } catch { /* client gone */ } }, 50);
      req.on("close", () => clearInterval(tick));
    });
    await new Promise<void>((resolve) => httpServer.listen(0, resolve));
    const port = (httpServer.address() as any).port;

    // Open a request and never let it close client-side either — this is the exact
    // shape (an active, non-idle connection) that used to make server.close()'s
    // callback never fire.
    const clientReq = http.get(`http://127.0.0.1:${port}/stream`);
    await new Promise<void>((resolve) => clientReq.on("response", () => resolve()));

    const t0 = Date.now();
    await drainHttp(httpServer, 300); // small graceMs keeps the test itself fast
    const elapsed = Date.now() - t0;

    expect(elapsed).toBeLessThan(3000); // task spec bound
    // Proves the promise waited for the force-close path (not a coincidental early
    // resolve): it must take at least roughly `graceMs`.
    expect(elapsed).toBeGreaterThanOrEqual(250);

    clientReq.destroy();
  });
});

// ---------------------------------------------------------------------------
// FIX B3 — ensureUpstream(): bridges a /mcp tools/call that lands while its
// upstream's connect is still in flight (now fire-and-forget from server.ts, no
// longer blocking boot). Never throws; resolves either on connect-settle or at
// the deadline, whichever comes first.
// ---------------------------------------------------------------------------
describe("ensureUpstream (FIX B3)", () => {
  let sup: typeof import("../server/mcp/supervisor");

  beforeEach(async () => {
    vi.clearAllMocks();
    sup = await import("../server/mcp/supervisor");
    sup.resetSupervisor();
  });
  afterEach(() => sup.resetSupervisor());

  test("resolves immediately when the upstream is already connected", async () => {
    connectUpstream.mockResolvedValue({ name: "s1", ok: true, tools: 1, toolNames: ["ping"] });
    await sup.superviseUpstream({ name: "s1", transport: "stdio", command: "x" });

    const t0 = Date.now();
    await sup.ensureUpstream("s1", 5000);
    expect(Date.now() - t0).toBeLessThan(50);
  });

  test("resolves immediately when the upstream isn't supervised at all", async () => {
    const t0 = Date.now();
    await sup.ensureUpstream("nonexistent-upstream", 5000);
    expect(Date.now() - t0).toBeLessThan(50);
  });

  test("resolves at the deadline — never throws — when the connect never settles", async () => {
    connectUpstream.mockImplementationOnce(() => new Promise(() => { /* never resolves — mirrors a hung stdio spawn */ }));
    // Fire-and-forget, exactly like server.ts's void-wrapped boot call: superviseUpstream
    // itself never resolves either (it awaits connectUpstream internally), so it must
    // NOT be awaited here — only its synchronous prefix (which sets `.connecting`) runs
    // before this line returns control.
    void sup.superviseUpstream({ name: "s2", transport: "stdio", command: "x" }).catch(() => {});

    const t0 = Date.now();
    await expect(sup.ensureUpstream("s2", 150)).resolves.toBeUndefined();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(elapsed).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// FIX B3 — boot: the MCP-Consume block (global tools.json upstreams + per-tenant
// fan-out) must never be `await`ed before app.listen. Mock the upstream connect to
// resolve after ~5s (tools.json has 6 real mcpServers entries — ukp/fs/memory/
// thinking/everything/ecysearcher — all of them hit this mock); before FIX B3 the
// block was `await Promise.all(...)`, so boot would not reach `/api/health` until
// ~5s. After FIX B3 it must reach 200 almost immediately.
// ---------------------------------------------------------------------------
describe("boot never blocks on a slow upstream connect (FIX B3)", () => {
  const PORT = 47651; // dedicated, unusual port — avoids colliding with a real dev server on 3000

  afterAll(() => {
    // Best-effort cleanup: initializeServer()'s `app.listen()` return value isn't
    // exported, so this test has no direct handle to `server.close()`. A still-
    // listening (non-unref'd) http.Server would otherwise keep this vitest worker's
    // event loop alive after the suite finishes. process._getActiveHandles() is a
    // long-standing (if undocumented) Node API used by leak-detection tooling (e.g.
    // wtfnode) for exactly this — unref every TCP server handle bound to OUR test
    // port so the process can exit naturally. Best-effort only; never throws.
    try {
      const handles: any[] = (process as any)._getActiveHandles?.() || [];
      for (const h of handles) {
        try {
          if (h && typeof h.address === "function" && typeof h.unref === "function") {
            const addr = h.address();
            if (addr && typeof addr === "object" && addr.port === PORT) h.unref();
          }
        } catch { /* best-effort */ }
      }
    } catch { /* best-effort */ }
  });

  test("GET /api/health reaches 200 well before the mocked upstream connect (~5s) resolves", async () => {
    vi.clearAllMocks();
    connectUpstream.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ name: "slow", ok: true, tools: 0, toolNames: [] }), 5000))
    );

    delete process.env.OLLAMAS_NO_AUTOBOOT; // let the real autoboot run this time
    process.env.PORT = String(PORT);
    process.env.NODE_ENV = "production"; // skip vite dev-server bootstrap — an unrelated boot cost
    process.env.CODESANDBOX_SSE = "1"; // forces detectMode() → "demo": skips the local-Ollama network probe
    process.env.SAAS_DB_PATH = path.join(os.tmpdir(), `boot-test-${process.pid}-${Date.now()}.db`);
    process.env.MCP_CONSUME_EAGER = "0"; // no tenant rows exist anyway (fresh DB) — keep the exercised path to the global tools.json loop

    // server.ts's autoboot check runs once at module-evaluation time, so a fresh
    // evaluation is required to pick up the env changes above (an already-cached
    // import would just return the same module without re-running that check).
    vi.resetModules();
    await import("../server");

    const t0 = Date.now();
    const deadline = t0 + 4500; // must stay well inside the 5s mocked connect delay
    let status = 0;
    let bootElapsedMs = -1;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
        status = res.status;
        if (status === 200) { bootElapsedMs = Date.now() - t0; break; }
      } catch { /* not listening yet */ }
      await new Promise((r) => setTimeout(r, 20));
    }

    expect(status).toBe(200);
    // The regression this guards: before FIX B3 the global upstream connect was
    // `await Promise.all(...)`, so boot latency summed every upstream's connect
    // time — with the 5s mock above, health would not turn 200 until ~5s. Reaching
    // it in a small fraction of that proves boot no longer waits on it.
    expect(bootElapsedMs).toBeGreaterThanOrEqual(0);
    expect(bootElapsedMs).toBeLessThan(2500);
  }, 10000);
});
