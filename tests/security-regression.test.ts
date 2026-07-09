import { describe, it, expect } from "vitest";
import path from "node:path";
import { DesktopCommander } from "../server/commander";
import { FilesystemManager } from "../server/files";
import { authMiddleware } from "../server/middleware/auth";
import { rateLimitMiddleware } from "../server/middleware/rate-limit";
import { decideSigGate, planUpdate } from "../cli/commands/update";

// v1.24.4 — Security-regression suite. Each case LOCKS an existing, verified
// security property so a future refactor that reopens the hole fails the gate.
// Tests are written against the REAL current code (no invented API); where a
// property lives in a non-exported inline closure, the case is adapted to the
// nearest exported code path exercising the same behavior (documented inline).

// ── Minimal Express-style req/res doubles (no network) ────────────────────────
function mkRes() {
  const rec = { status: 200, body: undefined as unknown, headers: {} as Record<string, unknown>, ended: false };
  const res = {
    status(s: number) { rec.status = s; return res; },
    json(b: unknown) { rec.body = b; rec.ended = true; return res; },
    setHeader(k: string, v: unknown) { rec.headers[k] = v; },
    _rec: rec,
  };
  return res;
}

describe("security-regression (v1.24.4)", () => {
  // (a) DesktopCommander runs binaries via execFile (argv), never through a shell.
  // Locks server/commander.ts: allowlist gates the binary AND shell metacharacters
  // in args are passed literally to the process (no `/bin/sh -c "cmd args"` sink).
  it("commander: execFile-argv — allowlist gate + shell metacharacters do not inject", async () => {
    // Non-allowlisted binary is refused before any exec.
    await expect(DesktopCommander.execute("rm", ["-rf", "/"])).rejects.toThrow(/not permitted/i);
    // `;whoami` reaches `ls` as a single literal path argument. Under a shell this
    // would run whoami; under execFile it is a nonexistent path → ls fails, and the
    // injected command never executes (proven by the "Execution failed" wrap, not a
    // second command's output).
    await expect(DesktopCommander.execute("ls", [";whoami"])).rejects.toThrow(/Execution failed/i);
  });

  // (b) Path-traversal guard. Locks FilesystemManager.resolveSafePath: any target
  // resolving outside the workspace root throws; in-root targets resolve normally.
  it("files: path-traversal `../` escape is blocked; in-root path allowed", () => {
    const root = path.resolve("/workspace/root");
    expect(() => FilesystemManager.resolveSafePath(root, "../../etc/passwd")).toThrow(/Path traversal/i);
    expect(() => FilesystemManager.resolveSafePath(root, "../root-sibling/secret")).toThrow(/Path traversal/i);
    // Allowlisted (in-root) relative path resolves to a path under the root.
    const ok = FilesystemManager.resolveSafePath(root, "sub/dir/file.txt");
    expect(ok).toBe(path.join(root, "sub/dir/file.txt"));
  });

  // (c) SAAS_ENFORCE protected route with no credential is rejected. authMiddleware
  // is wired as authMiddleware(SAAS_ENFORCE==="1") on /mcp and authMiddleware(true)
  // on every /api/saas/* tenant route. The real reject status is 401 with a
  // WWW-Authenticate challenge (RFC 9110 / OAuth resource-metadata), NOT 403 — the
  // case is bound to the true code behavior.
  it("auth: SAAS_ENFORCE-protected route without credential → 401 (WWW-Authenticate)", async () => {
    const mw = authMiddleware(true); // required=true, as used on /api/saas/* routes
    const req = { headers: {}, protocol: "http", get: (_h: string) => "localhost:3000" } as unknown as import("express").Request;
    const res = mkRes();
    let nextCalled = false;
    await mw(req as never, res as never, () => { nextCalled = true; });
    expect(res._rec.status).toBe(401);
    expect(nextCalled).toBe(false); // request never reaches the handler
    expect(res._rec.headers["WWW-Authenticate"]).toMatch(/Bearer/);
  });

  // (d) Repeated auth failures are throttled to 429. The admin-token brute-force
  // lockout (5 misses → 429) lives as a non-exported inline closure in server.ts,
  // so the same 429 rate-limit property is locked here via the EXPORTED
  // rateLimitMiddleware token bucket: a tenant capped at 1 req/min gets 429 on the
  // 2nd request. (Both are the server's real "too many requests → 429" guarantees.)
  it("rate-limit: tenant over per-minute cap → 429 (locks the 429 throttle path)", async () => {
    const prevRedis = process.env.REDIS_URL;
    delete process.env.REDIS_URL; // force the in-memory bucket (deterministic, no infra)
    try {
      const mw = rateLimitMiddleware();
      const tenant = {
        tenantId: "t_regression_rl",
        keyId: "k",
        scopes: [],
        plan: { id: "free", name: "Free", rate_per_min: 1, monthly_quota: 0, allowed_tiers: [] },
      };
      const call = async () => {
        const req = { tenant } as unknown as import("express").Request;
        const res = mkRes();
        let passed = false;
        await mw(req as never, res as never, () => { passed = true; });
        return { passed, res };
      };
      const first = await call();
      expect(first.passed).toBe(true); // first request consumes the single token
      const second = await call();
      expect(second.passed).toBe(false); // bucket empty → throttled
      expect(second.res._rec.status).toBe(429);
    } finally {
      if (prevRedis === undefined) delete process.env.REDIS_URL;
      else process.env.REDIS_URL = prevRedis;
    }
  });

  // (e) Release self-update binary swap is fail-closed and env-indirected. Locks
  // cli/commands/update.ts: the manifest URL comes from $OLLAMAS_UPDATE_MANIFEST /
  // --manifest (no shell), and decideSigGate refuses an unsigned or tampered asset
  // BEFORE the running binary is touched. planUpdate never selects a bad target.
  it("update: signature gate fail-closed (unsigned/tampered refused before binary swap)", () => {
    // Pinned key present but asset carries NO signature → refuse.
    expect(decideSigGate({ hasPinned: true, hasMinisig: false, verifyOk: false }).proceed).toBe(false);
    // Pinned key present, signature present but verification FAILS (tampered) → refuse.
    expect(decideSigGate({ hasPinned: true, hasMinisig: true, verifyOk: false }).proceed).toBe(false);
    // Pinned key present + valid signature → proceed.
    expect(decideSigGate({ hasPinned: true, hasMinisig: true, verifyOk: true }).proceed).toBe(true);
    // No asset for this machine's target → "no-asset" (never a shell-built path).
    const manifest = { version: "9.9.9", assets: [{ target: "some-other-target", url: "https://x/y", sha256: "0".repeat(64) }] } as never;
    expect(planUpdate(manifest, "0.0.1", "this-machine-target").action).toBe("no-asset");
  });
});
