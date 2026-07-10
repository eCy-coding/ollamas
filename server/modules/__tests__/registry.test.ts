// O0 Faz 1 (02-o0-foundation.md §3 FAZ 1) — module registry + .env toggle.
// RED-list 1-5: moduleEnabled default-OFF semantics, id-regex validation,
// duplicate-id rejection, mount → 200 / toggle-off → 404 (NOT 403 — the route
// is never mounted), and tool registration gated on the toggle.
// No supertest (zero-new-dep rule): http.createServer(app) + fetch, the same
// in-process pattern as tests/localowner-guard.test.ts.
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import express from "express";
import {
  defineModule,
  moduleEnabled,
  mountEnabledModules,
  _resetModulesForTest,
  type ModuleDef,
} from "../registry";
import { ToolRegistry } from "../../tool-registry";

let server: Server | null = null;

async function listen(app: express.Express): Promise<string> {
  server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server!.listen(0, () => r()));
  const addr = server!.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return `http://127.0.0.1:${port}`;
}

beforeEach(() => {
  _resetModulesForTest();
});

afterEach(async () => {
  _resetModulesForTest();
  if (server) {
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;
  }
});

const demoDef = (extra: Partial<ModuleDef> = {}): ModuleDef => ({
  id: "demo",
  envFlag: "MODULE_DEMO",
  mountRoutes(router) {
    router.get("/ping", (_req, res) => res.json({ ok: true }));
  },
  ...extra,
});

describe("moduleEnabled (default-OFF, KN-A5)", () => {
  test("MODULE_DEMO=1 → true; =0 → false; env absent → false; unknown id → false", () => {
    defineModule(demoDef());
    expect(moduleEnabled("demo", { MODULE_DEMO: "1" } as NodeJS.ProcessEnv)).toBe(true);
    expect(moduleEnabled("demo", { MODULE_DEMO: "0" } as NodeJS.ProcessEnv)).toBe(false);
    expect(moduleEnabled("demo", {} as NodeJS.ProcessEnv)).toBe(false);
    expect(moduleEnabled("nope", { MODULE_NOPE: "1" } as NodeJS.ProcessEnv)).toBe(false);
  });
});

describe("defineModule validation", () => {
  test("invalid id → throw (regex ^[a-z][a-z0-9-]*$)", () => {
    expect(() => defineModule(demoDef({ id: "Demo!" }))).toThrow(/module id/i);
    expect(() => defineModule(demoDef({ id: "has space" }))).toThrow(/module id/i);
  });

  test("same id registered twice → throw", () => {
    defineModule(demoDef());
    expect(() => defineModule(demoDef())).toThrow(/already/i);
  });
});

describe("mountEnabledModules toggle behavior", () => {
  test("MODULE_DEMO=1 → GET /api/modules/demo/ping 200; =0 → 404 (never mounted)", async () => {
    defineModule(demoDef());

    const on = express();
    mountEnabledModules(on, { MODULE_DEMO: "1" } as NodeJS.ProcessEnv);
    let base = await listen(on);
    const okRes = await fetch(`${base}/api/modules/demo/ping`);
    expect(okRes.status).toBe(200);
    expect(await okRes.json()).toEqual({ ok: true });
    await new Promise<void>((r) => server!.close(() => r()));
    server = null;

    const off = express();
    mountEnabledModules(off, { MODULE_DEMO: "0" } as NodeJS.ProcessEnv);
    base = await listen(off);
    expect((await fetch(`${base}/api/modules/demo/ping`)).status).toBe(404);
  });
});

describe("ModuleDef.tools gated on the toggle", () => {
  test("toggle off → ToolRegistry.has('demo_echo') false; on → true", () => {
    defineModule(
      demoDef({
        tools: [
          {
            name: "demo_echo",
            tier: "safe",
            schema: {
              type: "function",
              function: { name: "demo_echo", description: "echo", parameters: { type: "object", properties: {}, required: [] } },
            },
            invoke: async (args: any) => ({ echoed: args }),
          },
        ],
      }),
    );

    const off = express();
    mountEnabledModules(off, { MODULE_DEMO: "0" } as NodeJS.ProcessEnv);
    expect(ToolRegistry.has("demo_echo")).toBe(false);

    const on = express();
    mountEnabledModules(on, { MODULE_DEMO: "1" } as NodeJS.ProcessEnv);
    expect(ToolRegistry.has("demo_echo")).toBe(true);
    ToolRegistry.unregisterByPrefix("demo_echo"); // leave the shared registry clean
  });
});
