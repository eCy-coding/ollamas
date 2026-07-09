// SEC-5 (v1.29.4 µ1) — GET /api/health surfaces the AES master-key SOURCE (name only, never a
// value) + actionable remediation, bound to the REAL key-loading path (server/db.ts). Driven
// in-process against the real exported app (no port fixed, no vite/store boot, OLLAMAS_NO_AUTOBOOT=1)
// — the same http.createServer + listen(0) technique supertest uses internally.
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import { labelMasterKeySource, masterKeyRemediation, type MasterKeySourceLabel } from "./db";

let server: Server;
let base = "";
let health: any;

beforeAll(async () => {
  process.env.OLLAMAS_NO_AUTOBOOT = "1";
  const { app } = await import("../server");
  server = http.createServer(app as unknown as http.RequestListener);
  await new Promise<void>((r) => server.listen(0, () => r()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  base = `http://127.0.0.1:${port}`;
  const res = await fetch(base + "/api/health");
  expect(res.status).toBe(200);
  health = await res.json();
}, 60_000);

afterAll(async () => {
  await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
});

const KNOWN_SOURCES: MasterKeySourceLabel[] = ["env", "secure-enclave", "file", "generated-ephemeral", "missing"];

describe("GET /api/health — master-key source + remediation (SEC-5)", () => {
  test("response carries a truthy masterKeySource drawn from the real key-loading path", () => {
    expect(health.masterKeySource).toBeTruthy();
    expect(typeof health.masterKeySource).toBe("string");
    expect(KNOWN_SOURCES).toContain(health.masterKeySource);
  });

  test("remediation is present (string) and non-empty exactly when the source is weak/ephemeral/missing", () => {
    expect(typeof health.remediation).toBe("string");
    const weak = health.masterKeySource === "file" || health.masterKeySource === "generated-ephemeral" || health.masterKeySource === "missing";
    if (weak) expect(health.remediation.length).toBeGreaterThan(0);
    else expect(health.remediation).toBe("");
  });

  test("labelMasterKeySource maps every internal decision to a reported label", () => {
    expect(labelMasterKeySource("env", false)).toBe("env");
    expect(labelMasterKeySource("keychain", false)).toBe("secure-enclave");
    expect(labelMasterKeySource("file", false)).toBe("file");
    expect(labelMasterKeySource("mint", true)).toBe("generated-ephemeral");
    expect(labelMasterKeySource("mint", false)).toBe("file"); // darwin mint persists to disk
    expect(labelMasterKeySource("fail", false)).toBe("missing");
  });

  test("remediation is actionable for weak sources and silent for strong ones", () => {
    expect(masterKeyRemediation("env")).toBe("");
    expect(masterKeyRemediation("secure-enclave")).toBe("");
    expect(masterKeyRemediation("generated-ephemeral")).toMatch(/MASTER_KEY_B64/);
    expect(masterKeyRemediation("missing")).toMatch(/MASTER_KEY_B64/);
    expect(masterKeyRemediation("file")).toMatch(/MASTER_KEY_B64|KEYCHAIN/);
  });
});
