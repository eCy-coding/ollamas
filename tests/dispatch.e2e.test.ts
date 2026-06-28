// e2e e.1 — distributed dispatch conformance (real mac server + live desktop-ert7724 over
// Tailscale). LIVE GATE, NO MOCKS. Follows the conformance.e2e / smoke-live self-boot pattern:
// spawn the real mac server (npx tsx server.ts) on TEST_DISPATCH_PORT, waitForHealth, then
// dispatch a trivial REAL coding task through the cli/scripts path (scripts/agent-dispatch.mjs)
// and assert a structured report (verdict DONE/OK + files written).
//
// SKIP-WITH-LOUD-WARN (does NOT fail hard) when:
//   - the mac server never boots, OR
//   - the remote worker (desktop-ert7724) is unreachable over the tailnet.
// The fleet is down most of the time (2 Windows boxes pending fleet-join, MEMORY) → a skip is
// the EXPECTED, CORRECT outcome here; the deterministic guarantees live in the pure test
// (tests/cli-remote-dispatch.test.ts), which must always be green.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileP = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.TEST_DISPATCH_PORT || 3987);
const BASE = `http://localhost:${PORT}`;
const DB = path.join(os.tmpdir(), `ollamas-dispatch-${process.pid}.db`);
// Per-task write-root isolation (agent-dispatch.mjs --root). Cleaned up in afterAll.
const WORK = path.join(os.tmpdir(), `ollamas-dispatch-work-${process.pid}`);
// The remote GPU worker the Hybrid dispatch targets (SPEC_DISPATCH). Overridable for other tailnets.
const REMOTE = process.env.TEST_DISPATCH_REMOTE || "desktop-ert7724";
const REMOTE_PORT = process.env.TEST_DISPATCH_REMOTE_PORT || "8090";

let child: ChildProcess | undefined;
let macUp = false;
let remoteUp = false;

async function waitForHealth(timeoutMs = 30000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if ((await fetch(`${BASE}/api/health`)).ok) return true; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// Is the remote worker's ollamas server reachable + LIVE (not demo)? One short-timeout probe.
async function remoteReachable(): Promise<boolean> {
  const url = `http://${REMOTE}:${REMOTE_PORT}/api/health`;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 4000);
  try {
    const r = await fetch(url, { signal: ac.signal });
    return r.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

beforeAll(async () => {
  try { fs.mkdirSync(WORK, { recursive: true }); } catch {}
  child = spawn("npx", ["tsx", "server.ts"], {
    cwd: ROOT, detached: true,
    env: { ...process.env, PORT: String(PORT), SAAS_DB_PATH: DB, HOST_BRIDGE_URL: "http://127.0.0.1:9" },
    stdio: "ignore",
  });
  macUp = await waitForHealth();
  remoteUp = macUp && (await remoteReachable());
  if (!macUp) {
    console.warn(
      "\n⚠️  [dispatch.e2e] mac server did not boot on TEST_DISPATCH_PORT — SKIPPING the live " +
        "distributed-dispatch test. The pure invariants (tests/cli-remote-dispatch.test.ts) still gate.\n",
    );
  } else if (!remoteUp) {
    console.warn(
      `\n⚠️  [dispatch.e2e] remote worker '${REMOTE}:${REMOTE_PORT}' is UNREACHABLE over the tailnet ` +
        "(fleet down — 2 Windows boxes pending fleet-join). SKIPPING the live remote-dispatch test. " +
        "This is the EXPECTED outcome when the fleet is offline; run scripts/fleet-join then re-run.\n",
    );
  }
}, 45000);

afterAll(() => {
  try { if (child?.pid) process.kill(-child.pid, "SIGKILL"); } catch {}
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
  try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
});

describe("distributed dispatch e2e (real mac server + live desktop-ert7724)", () => {
  test("dispatch a trivial coding task to the remote worker → structured report (verdict DONE/OK, files written)", async (ctx) => {
    if (!macUp || !remoteUp) {
      // Loud skip (runtime) — see the beforeAll console.warn. Does NOT fail hard: ctx.skip()
      // marks this test skipped at runtime. The pure test carries the deterministic contract.
      ctx.skip();
      return;
    }

    // Drive the REAL cli/scripts dispatch path against the live remote worker. --json → the
    // structured report (the same shape RemoteAgentClient folds). A trivial, self-verifying
    // task: write a file + run it + emit the VERDICT line.
    const task =
      "Write a Python file hello_dispatch.py that prints exactly DISPATCH_OK, then run it and " +
      "confirm stdout is DISPATCH_OK.";
    const { stdout } = await execFileP(
      "node",
      [
        path.join(ROOT, "scripts", "agent-dispatch.mjs"),
        task,
        "--remote", REMOTE,
        "--port", REMOTE_PORT,
        "--root", WORK,
        "--steps", "8",
        "--json",
      ],
      { cwd: ROOT, timeout: 200000, maxBuffer: 64 << 20 },
    ).catch((e: any) => ({ stdout: e?.stdout || "" })); // non-zero exit (INCOMPLETE) still yields a report

    const report = JSON.parse(stdout);
    // Evidence law (SPEC_DISPATCH §5): a real run drives tools, is not a demo, and reaches a verdict.
    expect(report.demoSuspected).toBe(false);
    expect(report.steps.length).toBeGreaterThan(0);
    expect(["DONE", "OK"]).toContain(report.verdict);
    expect(Array.isArray(report.files)).toBe(true);
    expect(report.files.length).toBeGreaterThan(0); // a file was written on the worker
  }, 220000);
});
