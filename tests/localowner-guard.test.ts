// M-001, M-002 (V4) — localOwnerGuard behavior + allowlist-completeness invariant.
// The guard (server.ts:276-294) is registered at MODULE TOP LEVEL via
// `app.use([...prefixes], localOwnerGuard)`, so it runs under the in-process app
// (OLLAMAS_NO_AUTOBOOT=1) exactly like routes-hardening.test.ts. It reads
// process.env.SAAS_ENFORCE at REQUEST time, so we boot once and toggle the env.
//
// Contract: SAAS_ENFORCE=1 → every guarded prefix is 403 (local-owner surface
// unreachable in multi-tenant mode). Unset → the guard calls next() (never 403).
// M-002 invariant: each DANGEROUS prefix MUST be behind the guard — a new
// dangerous route added without the guard prefix makes its 403 assertion fail
// (regression shield). Kod DEĞİŞMEZ.
import { describe, test, expect, beforeAll, afterAll, afterEach } from "vitest";
import http from "node:http";
import type { Server } from "node:http";

let server: Server;
let base = "";

// Every prefix wired into the guard list (server.ts:285-291).
const GUARDED = [
  "/api/terminal", "/api/macos-terminal", "/api/pipeline", "/api/workspace",
  "/api/backup", "/api/cluster", "/api/security", "/api/generate", "/api/ai",
  "/api/agent", "/api/keys", "/api/models", "/api/revenue", "/api/notify",
  "/api/ecysearcher", "/api/threatfeed", "/api/model-overrides",
  "/api/github/actions", "/api/github/search", "/api/integrations",
];

// The local-owner-only, no-per-tenant-auth surface that MUST be gated (12-TEST-PLANI §M-002).
const DANGEROUS = [
  "/api/terminal", "/api/macos-terminal", "/api/pipeline", "/api/workspace",
  "/api/agent", "/api/keys", "/api/cluster", "/api/backup", "/api/security",
  "/api/generate", "/api/ai",
  // Writes per-model overrides incl. an injected system prompt → prompt-injection surface.
  "/api/model-overrides",
];

beforeAll(async () => {
  process.env.OLLAMAS_NO_AUTOBOOT = "1";
  delete process.env.SAAS_ENFORCE;
  const { app } = await import("../server");
  server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
}, 60_000);

afterEach(() => {
  delete process.env.SAAS_ENFORCE;
});

afterAll(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

const status = async (p: string): Promise<number> => (await fetch(base + p)).status;

describe("localOwnerGuard (M-001)", () => {
  test("SAAS_ENFORCE=1 → every guarded prefix is 403", async () => {
    process.env.SAAS_ENFORCE = "1";
    for (const p of GUARDED) {
      expect(await status(p), `${p} should be 403 under SAAS_ENFORCE=1`).toBe(403);
    }
  });

  test("SAAS_ENFORCE unset → guard calls next() (never 403)", async () => {
    delete process.env.SAAS_ENFORCE;
    for (const p of GUARDED) {
      // Handler may 400/404/200/502 — the ONLY forbidden outcome is 403 (the guard blocking).
      expect(await status(p), `${p} must not be 403 in local mode`).not.toBe(403);
    }
  });
});

describe("allowlist completeness invariant (M-002)", () => {
  test("DANGEROUS ⊆ guarded prefix list", () => {
    const guardedSet = new Set(GUARDED);
    const missing = DANGEROUS.filter((p) => !guardedSet.has(p));
    expect(missing).toEqual([]);
  });

  test("behavioral: each DANGEROUS prefix is 403 under enforcement", async () => {
    process.env.SAAS_ENFORCE = "1";
    for (const p of DANGEROUS) {
      expect(await status(p), `${p} is a local-owner surface and MUST be gated`).toBe(403);
    }
  });
});
