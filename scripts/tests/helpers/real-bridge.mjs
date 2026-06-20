// Spawn the REAL host terminal-bridge for e2e tests (scripts lane, v15). Unlike
// helpers/mock-bridge.mjs (in-memory fake), this runs bin/host-bridge/terminal-bridge.mjs
// as a child process so the actual production code path (auth, /exec, v14 /write
// confinement + payload cap + fail-closed bind) is exercised. NOT a *.test file.
import http from "node:http";
import net from "node:net";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// scripts/tests/helpers -> up 3 = worktree root
const REPO = join(HERE, "..", "..", "..");
const BRIDGE = join(REPO, "bin", "host-bridge", "terminal-bridge.mjs");

// Find a free TCP port (terminal-bridge needs a fixed PORT; PORT=0 falls back to
// 7345 because `0 || 7345`, so we must pick a real free one).
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

function getHealth(url) {
  return new Promise((resolve) => {
    const req = http.get(url + "/health", (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on("error", () => resolve(false));
    req.setTimeout(500, () => { req.destroy(); resolve(false); });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Start the real bridge. Returns {started, url, port, proc, exitCode, close}.
 * started=false (with exitCode) when the process exits before health is up —
 * the expected outcome for the fail-closed (non-loopback + no auth) case.
 */
export async function startRealBridge({ token = "", bind = "127.0.0.1", writeRoots = "", maxBody = "", timeoutMs = 4000 } = {}) {
  const port = await freePort();
  const env = { ...process.env, PORT: String(port), BRIDGE_BIND: bind };
  if (token) env.HOST_BRIDGE_TOKEN = token; else delete env.HOST_BRIDGE_TOKEN;
  if (writeRoots) env.BRIDGE_WRITE_ROOTS = writeRoots;
  if (maxBody) env.BRIDGE_MAX_BODY = String(maxBody);
  // ensure no inherited HMAC secret turns a "no token" case into authed
  delete env.HOST_BRIDGE_HMAC_SECRET;

  const proc = spawn("node", [BRIDGE], { cwd: REPO, env, stdio: "ignore" });
  let exitCode = null;
  proc.on("exit", (code) => { exitCode = code; });

  const url = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exitCode !== null) return { started: false, url, port, proc, exitCode, close: async () => {} };
    if (await getHealth(url)) {
      return {
        started: true, url, port, proc, exitCode: null,
        close: () => new Promise((resolve) => {
          if (exitCode !== null) return resolve();
          proc.once("exit", () => resolve());
          proc.kill("SIGTERM");
        }),
      };
    }
    await wait(100);
  }
  // timed out without health and without exit — kill and report not-started
  try { proc.kill("SIGKILL"); } catch {}
  return { started: false, url, port, proc, exitCode, close: async () => {} };
}

export { REPO, BRIDGE };
