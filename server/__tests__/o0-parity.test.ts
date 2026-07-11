// O0 Faz 6 (02-o0-foundation.md §3 FAZ 6, T6.3) — the parity matrix. The four
// cells MODULE_DEMO={0,1} × SAAS_ENFORCE={unset,1} are asserted against (route,
// tool, tab-listing) so the toggle-off blackout AND the guard invariant are
// proven together in one describe.each. Plain express app + a fake tab-bearing
// module (functional matrix; the guard-order structural test is module-guard.ts).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import express from "express";
import {
  defineModule,
  mountEnabledModules,
  _resetModulesForTest,
} from "../modules/registry";
import { ToolRegistry } from "../tool-registry";

// One app per (moduleOn) cell — mount reads the toggle at boot; SAAS_ENFORCE is a
// per-request env read, so the same app covers both enforce cells.
async function buildApp(moduleOn: boolean): Promise<{ server: Server; base: string }> {
  _resetModulesForTest();
  ToolRegistry.unregisterByPrefix("parity_echo");
  defineModule({
    id: "parity",
    envFlag: "MODULE_PARITY",
    tab: { labelKey: "tabs.parity", icon: "Box" },
    mountRoutes(router) {
      router.get("/ping", (_req, res) => res.json({ ok: true }));
    },
    tools: [
      {
        name: "parity_echo",
        tier: "safe",
        schema: { type: "function", function: { name: "parity_echo", description: "echo", parameters: { type: "object", properties: {}, required: [] } } },
        invoke: async (a: unknown) => a,
      },
    ],
  });
  const app = express();
  // Minimal localOwnerGuard mirror over /api/modules (server.ts parity) so the
  // enforce cells are exercised without importing the full 3200-line server.
  app.use("/api/modules", (_req, res, next) => {
    if (process.env.SAAS_ENFORCE === "1") {
      res.status(403).json({ error: "endpoint not available in SaaS mode (local-owner only)" });
      return;
    }
    next();
  });
  mountEnabledModules(app, { MODULE_PARITY: moduleOn ? "1" : "0" } as NodeJS.ProcessEnv);
  const server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  return { server, base: `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}` };
}

const cells = [
  { moduleOn: false, enforce: undefined, route: 404, listed: false },
  { moduleOn: false, enforce: "1", route: 403, listed: false },
  { moduleOn: true, enforce: undefined, route: 200, listed: true },
  { moduleOn: true, enforce: "1", route: 403, listed: false },
] as const;

describe.each(cells)(
  "O0 parity matrix — MODULE_PARITY=$moduleOn × SAAS_ENFORCE=$enforce",
  ({ moduleOn, enforce, route, listed }) => {
    let server: Server;
    let base = "";

    beforeAll(async () => {
      ({ server, base } = await buildApp(moduleOn));
    });
    afterAll(async () => {
      delete process.env.SAAS_ENFORCE;
      _resetModulesForTest();
      ToolRegistry.unregisterByPrefix("parity_echo");
      await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
    });

    test(`route → ${route}, listed → ${listed}, tool → ${moduleOn}`, async () => {
      if (enforce) process.env.SAAS_ENFORCE = enforce;
      else delete process.env.SAAS_ENFORCE;
      // The listing route reads the toggle live; align it with this cell.
      process.env.MODULE_PARITY = moduleOn ? "1" : "0";

      // Route status
      expect((await fetch(`${base}/api/modules/parity/ping`)).status).toBe(route);

      // Tab listing: GET /api/modules is guarded (403 under enforce) → hidden; else
      // reflects the toggle. enabledModules() itself is toggle-only (no guard).
      const listRes = await fetch(`${base}/api/modules`);
      if (enforce) {
        expect(listRes.status).toBe(403);
      } else {
        const body = (await listRes.json()) as { modules: { id: string }[] };
        const has = body.modules.some((m) => m.id === "parity");
        expect(has).toBe(listed);
      }

      // Tool registration is a pure toggle (independent of enforce).
      expect(ToolRegistry.has("parity_echo")).toBe(moduleOn);
    });
  },
);
