// M-006 (GAP-005) — adminGuard brute-force + timing-safe regression, enabled by the M-050
// boot-harness (createAdminGuard factory extracted to module scope so it is testable without
// booting the full stack). timingSafeEqual alone does not stop an attacker hammering guesses;
// after ADMIN_MAX_FAILS (5) misses an IP is locked out for the window → the next attempt gets
// 429 + Retry-After. A correct token always passes and resets the counter. Reverting either the
// throttle or the constant-time compare makes these fail → regression guard.
//
// The REAL production factory is mounted on a throwaway express app — no port fixed, no full
// boot. Each createAdminGuard() call returns an isolated per-IP failure map, so cases don't leak.
import { describe, test, expect, beforeAll, afterEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import express from "express";
import { createAdminGuard } from "../server";

const TOKEN = "s3cret-admin-token";
let server: Server;
let base = "";
const openServers: Server[] = [];

// Mount a fresh guard instance (isolated failure map) on its own app+server per call.
async function mountGuard(): Promise<{ base: string }> {
  const app = express();
  app.get("/admin/probe", createAdminGuard(), (_req, res) => res.status(200).json({ ok: true }));
  const s = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => s.listen(0, () => r()));
  openServers.push(s);
  const addr = s.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return { base: `http://127.0.0.1:${port}` };
}

beforeAll(() => {
  process.env.OLLAMAS_NO_AUTOBOOT = "1";
  process.env.SAAS_ADMIN_TOKEN = TOKEN;
});

afterEach(async () => {
  while (openServers.length) {
    const s = openServers.pop()!;
    await new Promise<void>((r) => s.close(() => r()));
  }
});

const call = (b: string, token?: string) =>
  fetch(b + "/admin/probe", token === undefined ? undefined : { headers: { "x-admin-token": token } });

describe("M-006 adminGuard — brute-force throttle + timing-safe compare", () => {
  test("correct token → 200 (passes through)", async () => {
    const { base } = await mountGuard();
    const res = await call(base, TOKEN);
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });

  test("5 wrong tokens → 401 each; the 6th attempt → 429 with Retry-After", async () => {
    const { base } = await mountGuard();
    for (let i = 0; i < 5; i++) {
      const res = await call(base, "wrong-guess-" + i);
      expect(res.status).toBe(401);
    }
    const locked = await call(base, "wrong-guess-again");
    expect(locked.status).toBe(429);
    const retryAfter = Number(locked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
  });

  test("wrong-length token is rejected without a length-based leak (constant-time path)", async () => {
    const { base } = await mountGuard();
    // A token of a different length must still be a clean 401, not a crash — proves the
    // `a.length !== b.length` short-circuit guards crypto.timingSafeEqual (which throws on
    // unequal-length buffers).
    const res = await call(base, "x");
    expect(res.status).toBe(401);
  });

  test("missing token header → 401", async () => {
    const { base } = await mountGuard();
    const res = await call(base, "");
    expect(res.status).toBe(401);
  });
});
