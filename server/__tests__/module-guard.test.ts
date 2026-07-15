// O0 Faz 2 (02-o0-foundation.md §3 FAZ 2, CRITICAL) — INV-O0-1 guard-coverage
// invariant, the V7 lesson made a tested invariant: every module route lives
// under the single /api/modules prefix, and that prefix is inside the
// localOwnerGuard allowlist (server.ts). Behavioral (403/200/401) + structural
// (router-stack scan, KN-O3) + ordering (guard before module mount, KN-A9).
//
// Runs against the REAL exported app (OLLAMAS_NO_AUTOBOOT=1, M-050 pattern);
// fake ModuleDefs are mounted onto it in-test — the demo module (Faz 5) is not
// required for the invariant to hold.
import { describe, test, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import express from "express";

let server: Server;
let base = "";
let app: express.Express;
let mountEnabledModules: typeof import("../modules/registry").mountEnabledModules;
let defineModule: typeof import("../modules/registry").defineModule;

beforeAll(async () => {
  process.env.OLLAMAS_NO_AUTOBOOT = "1";
  delete process.env.SAAS_ENFORCE;
  // Immune to prior tests that booted the app singleton / left modules in the process-global
  // registry: reset the module cache so this suite gets a FRESH app + clean registry. Without
  // this, another test importing server (or mounting modules) before us pollutes the shared
  // singleton and the guard-layer invariants read a stale app.
  vi.resetModules();
  const reg = await import("../modules/registry");
  reg._resetModulesForTest();
  ({ app } = await import("../../server"));
  ({ mountEnabledModules, defineModule } = reg);
  // Fake modules for the invariant tests (registered AFTER the real server's own
  // mount — the /api/modules listing route is already present, WeakSet-deduped).
  defineModule({
    id: "guardtest",
    envFlag: "MODULE_GUARDTEST",
    mountRoutes(router) {
      router.get("/ping", (_req, res) => res.json({ ok: true }));
      // A module trying to escape its prefix can only nest deeper — this path
      // becomes /api/modules/guardtest/api/other/leak (structural test proof).
      router.get("/api/other/leak", (_req, res) => res.json({ leaked: true }));
    },
  });
  defineModule({
    id: "tenantmod",
    envFlag: "MODULE_TENANTMOD",
    authPolicy: "tenant",
    mountRoutes(router) {
      router.get("/ping", (_req, res) => res.json({ ok: true }));
    },
  });
  mountEnabledModules(app, { MODULE_GUARDTEST: "1", MODULE_TENANTMOD: "1" } as NodeJS.ProcessEnv);

  server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 60_000);

afterEach(() => {
  delete process.env.SAAS_ENFORCE;
});

afterAll(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

const status = async (p: string): Promise<number> => (await fetch(base + p)).status;

describe("INV-O0-1 behavioral — localOwnerGuard covers the module surface", () => {
  test("SAAS_ENFORCE=1 → GET /api/modules/guardtest/ping is 403 (fail-closed)", async () => {
    process.env.SAAS_ENFORCE = "1";
    expect(await status("/api/modules/guardtest/ping")).toBe(403);
  });

  test("SAAS_ENFORCE unset → same route is 200 (local-owner UX preserved)", async () => {
    delete process.env.SAAS_ENFORCE;
    const res = await fetch(`${base}/api/modules/guardtest/ping`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  test("authPolicy:'tenant' module routes through authMiddleware → 401 without a key", async () => {
    delete process.env.SAAS_ENFORCE;
    expect(await status("/api/modules/tenantmod/ping")).toBe(401);
  });
});

describe("INV-O0-1 structural — router-stack scan (KN-O3: internal API, secondary defense)", () => {
  // Express 4.22 defines `app.router` as a getter that unconditionally THROWS
  // ("'app.router' is deprecated!") — a `??` fallback never gets a chance to
  // run because merely reading the property already raises. `app._router` is
  // the live base router in this Express major. Guard the read so this also
  // keeps working unmodified on an Express 5 install, where `app.router` is a
  // plain (non-throwing) property and `app._router` is gone.
  const baseRouter = (a: any): any => {
    try {
      if (a.router) return a.router;
    } catch {
      // Express 4's deprecated throwing getter — fall through to `_router`.
    }
    return a._router;
  };

  const moduleLayers = () =>
    (baseRouter(app).stack as any[]).filter((l) => l?.handle?.__moduleId);

  test("no module-stamped layer registers a path outside /api/modules", () => {
    const layers = moduleLayers();
    expect(layers.length).toBeGreaterThan(0);
    const escapees = layers.filter((l) => {
      const rx: RegExp = l.regexp;
      // The mount prefix regexp must match its own /api/modules path and must
      // NOT match a probe outside the prefix.
      const id = l.handle.__moduleId as string;
      return !rx.test(`/api/modules/${id}/ping`) || rx.test("/api/other/leak");
    });
    expect(escapees).toEqual([]);
  });

  test("ordering (KN-A9): localOwnerGuard layer sits BEFORE every module layer", () => {
    const stack = baseRouter(app).stack as any[];
    const guardIdx = stack.findIndex(
      (l) => l?.handle?.name === "localOwnerGuard" && l.regexp?.test("/api/modules/x"),
    );
    expect(guardIdx, "guard layer covering /api/modules must exist").toBeGreaterThanOrEqual(0);
    const firstModuleIdx = stack.findIndex((l) => l?.handle?.__moduleId);
    expect(firstModuleIdx).toBeGreaterThanOrEqual(0);
    expect(guardIdx).toBeLessThan(firstModuleIdx);
  });
});
