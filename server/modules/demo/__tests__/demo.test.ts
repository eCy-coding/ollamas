// O0 Faz 5 (02-o0-foundation.md §3 FAZ 5, RED 1-4) — the demo module proves the
// FULL modular chain end-to-end: route + SQLite persistence (restart-persist) +
// vector search + tool via the ToolRegistry choke-point + toggle-off blackout.
// Uses a plain express app + mountEnabledModules (functional behavior; the guard
// invariant is Faz 2's job) with a fake embedder + tmp data dirs (no ollama).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import "../index"; // side-effect: register the real demo module
import { mountEnabledModules, enabledModules } from "../../registry";
import { _setDemoEmbedder } from "../store";
import { ToolRegistry, type ToolCtx } from "../../../tool-registry";
import { closeStore } from "../../../store";

let server: Server;
let base = "";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-o0-demo-"));

// Deterministic 3-dim embedder: "alpha" and "bravo" on different axes.
const fakeEmbed = async (text: string): Promise<number[]> => {
  if (text.includes("alpha")) return [1, 0, 0];
  if (text.includes("bravo")) return [0, 1, 0];
  return [0.9, 0.1, 0];
};

const post = (p: string, body: unknown) =>
  fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.SAAS_ENFORCE;
  process.env.SAAS_DB_PATH = path.join(tmp, "saas.db");
  process.env.MISSION_CONTROL_DATA_DIR = tmp; // vector files land under tmp/vec
  _setDemoEmbedder(fakeEmbed);

  const app = express();
  app.use(express.json());
  mountEnabledModules(app, { MODULE_DEMO: "1" } as NodeJS.ProcessEnv);

  server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 60_000);

afterAll(async () => {
  _setDemoEmbedder(undefined);
  ToolRegistry.unregisterByPrefix("demo_echo");
  await closeStore();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("demo module — route + persistence (restart-persist)", () => {
  test("ping, POST item → v7 table, GET items survives closeStore→re-init", async () => {
    expect((await fetch(`${base}/api/modules/demo/ping`)).status).toBe(200);
    expect(await (await fetch(`${base}/api/modules/demo/ping`)).json()).toEqual({ ok: true });

    const created = await (await post("/api/modules/demo/items", { text: "alpha document" })).json();
    expect(created.id).toBeTruthy();
    expect(created.text).toBe("alpha document");

    // Force a store restart — data must persist to the file, not memory.
    await closeStore();
    const after = await (await fetch(`${base}/api/modules/demo/items`)).json();
    expect(after.items.map((i: { text: string }) => i.text)).toContain("alpha document");
  });
});

describe("demo module — vector search", () => {
  test("POST /search returns the nearest neighbor via VectorStore('demo')", async () => {
    await post("/api/modules/demo/items", { text: "bravo document" });
    const res = await (await post("/api/modules/demo/search", { q: "something about alpha" })).json();
    expect(res.hits.length).toBeGreaterThan(0);
    expect(res.hits[0].text).toBe("alpha document");
  });
});

describe("demo module — tool flows through the ToolRegistry choke-point", () => {
  test("demo_echo runs via ToolRegistry.execute (no direct .invoke path)", async () => {
    expect(ToolRegistry.has("demo_echo")).toBe(true);
    const ctx = { isLive: false, workspaceRoot: tmp, autoApply: false, deps: {} } as unknown as ToolCtx;
    const result = await ToolRegistry.execute("demo_echo", { text: "hi" }, ctx);
    expect(result.ok).toBe(true);
    expect(result.output).toEqual({ echoed: "hi" });
  });

  test("no module code calls a tool's .invoke() directly (choke-point discipline)", () => {
    const dir = path.resolve(__dirname, "../..");
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, e.name);
        if (e.isDirectory()) {
          if (e.name === "__tests__") continue;
          walk(full);
        } else if (e.name.endsWith(".ts")) {
          // ".invoke(" would be a direct bypass of ToolRegistry.execute.
          if (/\.invoke\s*\(/.test(fs.readFileSync(full, "utf8"))) offenders.push(full);
        }
      }
    };
    walk(dir);
    expect(offenders).toEqual([]);
  });
});

describe("demo module — toggle-off total blackout", () => {
  test("MODULE_DEMO=0 → routes 404 + module absent from /api/modules list", async () => {
    const off = express();
    off.use(express.json());
    mountEnabledModules(off, { MODULE_DEMO: "0" } as NodeJS.ProcessEnv);
    const s = http.createServer(off as unknown as http.RequestListener);
    await new Promise<void>((r) => s.listen(0, () => r()));
    const addr = s.address();
    const b = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    try {
      expect((await fetch(`${b}/api/modules/demo/ping`)).status).toBe(404);
      const list = await (await fetch(`${b}/api/modules`)).json();
      // enabledModules() reads process.env at request time; force MODULE_DEMO off.
      const prev = process.env.MODULE_DEMO;
      process.env.MODULE_DEMO = "0";
      expect(enabledModules().map((m) => m.id)).not.toContain("demo");
      if (prev === undefined) delete process.env.MODULE_DEMO; else process.env.MODULE_DEMO = prev;
      expect((list.modules as { id: string }[]).map((m) => m.id)).not.toContain("demo");
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});
