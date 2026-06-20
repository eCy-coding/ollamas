// Scripts domain v15 — REAL end-to-end against a spawned terminal-bridge. Closes
// the mock-only gap: proves the production bridge actually serves tools AND locks
// the v14 security fixes (403 traversal / 413 payload / 401 auth / fail-closed bind)
// against regression. Opt-in (BRIDGE_E2E=1) so the normal gate stays fast and never
// spawns a process; CI (scripts-ci.yml) sets the env. Headless: uses /exec (bash),
// never /run (osascript/TCC).
import { describe, test, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startRealBridge } from "./helpers/real-bridge.mjs";

// NOTE (honest limitation): every host tool calls the bridge's /run endpoint,
// which drives a VISIBLE macOS terminal via osascript and needs TCC Automation
// permission + a GUI session — so a per-tool roundtrip CANNOT run headless/CI
// (this is why tools-golden marks them Class-C "DEFERRED"; RISK-SCR-021). This
// suite instead proves the real bridge's HEADLESS surface: /exec command
// execution + the v14 security controls + fail-closed startup — the parts that
// CAN be automated. The /run→osascript path stays a manual/local check.
const TOKEN = "e2e-secret-tok";
const bridges: Array<{ close: () => Promise<void> }> = [];
async function spawnBridge(opts = {}) {
  const b = await startRealBridge(opts);
  bridges.push(b);
  return b;
}
afterEach(async () => {
  while (bridges.length) await bridges.pop()!.close();
});

const post = (url: string, p: string, body: unknown, token?: string) =>
  fetch(url + p, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { "x-bridge-token": token } : {}) },
    body: JSON.stringify(body),
  });

describe.skipIf(!process.env.BRIDGE_E2E)("real bridge e2e", () => {
  test("tokenless loopback: /health + /exec roundtrip", async () => {
    const b = await spawnBridge({});
    expect(b.started).toBe(true);
    const h = await fetch(b.url + "/health").then((r) => r.json());
    expect(h.ok).toBe(true);
    const r = await post(b.url, "/exec", { command: "echo e2e-ok" }).then((r) => r.json());
    expect(r.ok).toBe(true);
    expect(r.output).toContain("e2e-ok");
  });

  test("v14 security locked: traversal 403 / oversized 413 / no-auth 401 / in-root 200", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "v15-e2e-"));
    const b = await spawnBridge({ token: TOKEN, writeRoots: root, maxBody: 1024 });

    const tr = await post(b.url, "/write", { path: `${root}/../../etc/evilx`, contentB64: "aGk=" }, TOKEN);
    expect(tr.status).toBe(403);
    expect(fs.existsSync("/etc/evilx")).toBe(false);

    const big = "A".repeat(4096);
    const ov = await post(b.url, "/write", { path: `${root}/big`, contentB64: big }, TOKEN);
    expect(ov.status).toBe(413);

    const na = await post(b.url, "/write", { path: `${root}/x`, contentB64: "aGk=" }); // no token
    expect(na.status).toBe(401);

    const ok = await post(b.url, "/write", { path: `${root}/ok.txt`, contentB64: "aGk=" }, TOKEN);
    expect(ok.status).toBe(200);
    expect(fs.existsSync(`${root}/ok.txt`)).toBe(true);

    fs.rmSync(root, { recursive: true, force: true });
  });

  test("fail-closed: non-loopback bind without auth refuses to start", async () => {
    const b = await spawnBridge({ bind: "0.0.0.0", token: "" });
    expect(b.started).toBe(false);
    expect(b.exitCode).not.toBe(0); // process exited (refused), health never came up
  });
});
