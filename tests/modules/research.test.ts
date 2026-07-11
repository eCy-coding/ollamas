// O2 Faz 5 (docs/odyssey/05-features/research.md §FAZ 5) — the research module's
// route + toggle + persistence, mirroring server/modules/demo/__tests__. Real
// network/LLM calls are swapped for deterministic fakes via the module's test
// seam (_setResearchTestDeps) — same pattern as demo's _setDemoEmbedder.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import "../../server/modules"; // side-effect: register every shipped module incl. research
import { mountEnabledModules, enabledModules } from "../../server/modules/registry";
import { _setResearchTestDeps } from "../../server/modules/research/service";
import { closeStore } from "../../server/store";

let server: Server;
let base = "";
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-o2-research-"));

const post = (p: string, body: unknown) =>
  fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeAll(async () => {
  delete process.env.DATABASE_URL;
  delete process.env.SAAS_ENFORCE;
  process.env.SAAS_DB_PATH = path.join(tmp, "saas.db");
  process.env.MISSION_CONTROL_DATA_DIR = tmp;

  _setResearchTestDeps({
    planInitial: async () => ["ollama privacy"],
    nextQueries: async () => [],
    search: async () => ({ source: "ddg" as const, results: [{ title: "Ollama", url: "https://ollama.com", snippet: "local LLMs" }] }),
    fetchPage: async () => ({ title: "Ollama", text: "Ollama runs models fully on-device." }),
    summarize: async (s: { url: string; title: string }) => ({ url: s.url, title: s.title, summary: `${s.title} keeps data local.`, keyPoints: ["local"] }),
    buildReport: async (_q: string, sources: { url: string; title: string; summary: string }[]) => ({
      report: sources.length ? sources.map((s, i) => `${s.summary} [${i + 1}]`).join(" ") : "no sources found",
      citations: sources.map((s, i) => ({ n: i + 1, title: s.title, url: s.url, domain: "ollama.com" })),
    }),
    ragIndex: async () => ({ id: "x", dim: 3 }),
    ragSearch: async () => [],
  });

  const app = express();
  app.use(express.json());
  mountEnabledModules(app, { MODULE_RESEARCH: "1" } as NodeJS.ProcessEnv);

  server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 60_000);

afterAll(async () => {
  _setResearchTestDeps(undefined);
  await closeStore();
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("research module — POST /run", () => {
  test("200 with a cited report + sources + rounds (fake pipeline deps)", async () => {
    const res = await post("/api/modules/research/run", { question: "Why are local LLMs more private?" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.question).toBe("Why are local LLMs more private?");
    expect(body.report).toContain("[1]");
    expect(body.citations).toHaveLength(1);
    expect(body.sources).toHaveLength(1);
    expect(body.rounds.length).toBeGreaterThan(0);
    expect(body.runId).toBeTruthy();
  });

  test("400 on a missing/empty question (honest validation, no silent coercion)", async () => {
    const res = await post("/api/modules/research/run", { question: "" });
    expect(res.status).toBe(400);
  });
});

describe("research module — persistence + history", () => {
  test("GET /runs lists a run persisted by POST /run, survives closeStore→re-init", async () => {
    await post("/api/modules/research/run", { question: "another question" });
    await closeStore();
    const after = await (await fetch(`${base}/api/modules/research/runs`)).json();
    expect(after.runs.map((r: { question: string }) => r.question)).toContain("another question");
  });
});

describe("research module — toggle-off total blackout", () => {
  test("MODULE_RESEARCH=0 → routes 404 + module absent from /api/modules list", async () => {
    const off = express();
    off.use(express.json());
    mountEnabledModules(off, { MODULE_RESEARCH: "0" } as NodeJS.ProcessEnv);
    const s = http.createServer(off as unknown as http.RequestListener);
    await new Promise<void>((r) => s.listen(0, () => r()));
    const addr = s.address();
    const b = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    try {
      expect((await fetch(`${b}/api/modules/research/runs`)).status).toBe(404);
      expect(enabledModules({ MODULE_RESEARCH: "0" } as NodeJS.ProcessEnv).map((m) => m.id)).not.toContain("research");
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});

describe("research module — guard inheritance (INV-O0-1, no test-file edit needed)", () => {
  // PIPELINE-LESSONS #5: /api/modules is ALREADY in server.ts's localOwnerGuard
  // allowlist, so a new module inherits the 403 for free — this proves it against
  // the REAL server.ts app (not the bare test express() used above) without
  // touching tests/localowner-guard.test.ts.
  test("SAAS_ENFORCE=1 → /api/modules/research/* is 403 on the real server app", async () => {
    process.env.OLLAMAS_NO_AUTOBOOT = "1";
    process.env.MODULE_RESEARCH = "1";
    process.env.SAAS_ENFORCE = "1";
    try {
      const { app: realApp } = await import("../../server");
      const s = http.createServer(realApp as unknown as http.RequestListener);
      await new Promise<void>((r) => s.listen(0, () => r()));
      const addr = s.address();
      const b = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
      try {
        const res = await fetch(`${b}/api/modules/research/runs`);
        expect(res.status).toBe(403);
      } finally {
        await new Promise<void>((r) => s.close(() => r()));
      }
    } finally {
      delete process.env.SAAS_ENFORCE;
    }
  }, 30_000);
});
