// O0 Faz 4 (02-o0-foundation.md §3 FAZ 4, RED 1-2) — GET /api/modules is the
// single choke-point the frontend reads to register module tabs. It lists ONLY
// enabled modules and lives under the guarded /api/modules prefix (SaaS mode →
// 403 → frontend deny-by-default). Real exported app (OLLAMAS_NO_AUTOBOOT=1).
import { describe, test, expect, beforeAll, afterAll, afterEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import express from "express";

let server: Server;
let base = "";

beforeAll(async () => {
  process.env.OLLAMAS_NO_AUTOBOOT = "1";
  delete process.env.SAAS_ENFORCE;
  const { app } = (await import("../../server")) as { app: express.Express };
  const { defineModule, mountEnabledModules } = await import("../modules/registry");
  // A fake tab-bearing module, enabled — the real demo module is a Faz 5 concern.
  defineModule({
    id: "apitest",
    envFlag: "MODULE_APITEST",
    tab: { labelKey: "tabs.apitest", icon: "Box" },
    mountRoutes(router) {
      router.get("/ping", (_req, res) => res.json({ ok: true }));
    },
  });
  // A second module left OFF proves the listing filters by toggle.
  defineModule({ id: "apihidden", envFlag: "MODULE_APIHIDDEN", tab: { labelKey: "tabs.apihidden", icon: "X" }, mountRoutes() {} });
  mountEnabledModules(app, { MODULE_APITEST: "1", MODULE_APIHIDDEN: "0" } as NodeJS.ProcessEnv);

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

describe("GET /api/modules", () => {
  test("lists only enabled modules with their tab manifests", async () => {
    // The listing route reads enabledModules() at request time against process.env.
    process.env.MODULE_APITEST = "1";
    process.env.MODULE_APIHIDDEN = "0";
    const res = await fetch(`${base}/api/modules`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { modules: { id: string; tab?: unknown }[] };
    const ids = body.modules.map((m) => m.id);
    expect(ids).toContain("apitest");
    expect(ids).not.toContain("apihidden");
    const apitest = body.modules.find((m) => m.id === "apitest");
    expect(apitest?.tab).toEqual({ labelKey: "tabs.apitest", icon: "Box" });
  });

  test("MODULE_*=0 for all → empty list", async () => {
    process.env.MODULE_APITEST = "0";
    process.env.MODULE_APIHIDDEN = "0";
    const res = await fetch(`${base}/api/modules`);
    const body = (await res.json()) as { modules: { id: string }[] };
    expect(body.modules.map((m) => m.id)).not.toContain("apitest");
    process.env.MODULE_APITEST = "1"; // restore for other tests in the file
  });

  test("SAAS_ENFORCE=1 → /api/modules is 403 (guarded → frontend deny-by-default)", async () => {
    process.env.SAAS_ENFORCE = "1";
    expect((await fetch(`${base}/api/modules`)).status).toBe(403);
  });
});
