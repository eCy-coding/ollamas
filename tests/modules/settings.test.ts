// O8 settings module (docs/odyssey/07-security.md O8.1-O8.5) — mirrors
// tests/modules/cookbook.test.ts + notes-tasks.test.ts: pure TOTP crypto
// (RFC 6238 known vectors), service CRUD (real SQLite via _core/store,
// restart-persist), route + toggle (functional), and the localOwnerGuard
// invariant (SAAS_ENFORCE=1 → 403).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import "../../server/modules/settings"; // side-effect: register the real module
import { mountEnabledModules, enabledModules } from "../../server/modules/registry";
import { base32Decode, base32Encode, generateBackupCodes, generateTotpSecret, hashBackupCode, otpauthUrl, totp, verifyTotp } from "../../server/modules/settings/totp";
import {
  parseGeneralPatch,
  parseRolePermsPatch,
  parseToolPolicyPatch,
  parseTotpCredential,
  parseTotpToken,
  sanitizeRoleName,
  sanitizeToolId,
  ROLE_NAMES,
  TOOL_IDS,
} from "../../server/modules/settings/schema";
import * as settingsService from "../../server/modules/settings/service";
import { closeStore } from "../../server/store";

const sharedTmp = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-o8-settings-"));
beforeAll(() => {
  delete process.env.DATABASE_URL;
  process.env.SAAS_DB_PATH = path.join(sharedTmp, "saas.db");
});
afterAll(async () => {
  await closeStore();
  fs.rmSync(sharedTmp, { recursive: true, force: true });
});

// ── TOTP — pure crypto, RFC 6238 known vectors (P1) ─────────────────────────
describe("O8 TOTP — RFC 6238 known test vectors (Appendix B, SHA1, 8-digit)", () => {
  // Official RFC 6238 vectors use the raw ASCII secret "12345678901234567890"
  // as the HMAC key directly. Our totp()/verifyTotp() take a base32 secret (the
  // real-world authenticator-app convention), so we base32-encode that exact
  // ASCII key here — this ALSO exercises the base32 round-trip, not a shortcut.
  const rfcSecretB32 = base32Encode(Buffer.from("12345678901234567890", "ascii"));

  test.each([
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
  ])("T=%i → %s (8-digit, step=30)", (time, expected) => {
    expect(totp(rfcSecretB32, { digits: 8, time })).toBe(expected);
  });

  test("base32Decode(base32Encode(x)) round-trips arbitrary bytes", () => {
    const raw = Buffer.from("12345678901234567890", "ascii");
    expect(base32Decode(base32Encode(raw)).equals(raw)).toBe(true);
  });

  test("generateTotpSecret() produces a 32-char base32 string (20 random bytes)", () => {
    const secret = generateTotpSecret();
    expect(secret).toHaveLength(32);
    expect(secret).toMatch(/^[A-Z2-7]+$/);
  });

  test("verifyTotp accepts a code within ±1 step window, rejects outside it", () => {
    const secret = generateTotpSecret();
    const now = 1_700_000_000;
    const code = totp(secret, { time: now });
    expect(verifyTotp(secret, code, { time: now })).not.toBeNull();
    expect(verifyTotp(secret, code, { time: now + 29 })).not.toBeNull(); // same step
    expect(verifyTotp(secret, code, { time: now + 31 })).not.toBeNull(); // +1 step (window=1)
    expect(verifyTotp(secret, code, { time: now + 61 })).toBeNull(); // +2 steps, out of window
  });

  test("verifyTotp rejects a garbage/non-numeric token", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "not-a-code")).toBeNull();
  });

  test("otpauthUrl embeds issuer, account, and secret", () => {
    const url = otpauthUrl({ issuer: "ollamas", account: "local-owner", secret: "ABCDEFGH" });
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain("secret=ABCDEFGH");
    expect(url).toContain("issuer=ollamas");
  });

  test("backup codes: 10 unique codes, sha256 hash is deterministic + one-way", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    const hash1 = hashBackupCode(codes[0]);
    const hash2 = hashBackupCode(codes[0]);
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(codes[0]);
  });
});

// ── Schema validation (pure) ─────────────────────────────────────────────────
describe("O8 settings — schema validation", () => {
  test("parseGeneralPatch: partial + well-typed only", () => {
    expect(parseGeneralPatch({ theme: "light" })).toEqual({ theme: "light" });
    expect(() => parseGeneralPatch({ theme: "neon" })).toThrow();
    expect(() => parseGeneralPatch({ reduceMotion: "yes" })).toThrow();
    expect(parseGeneralPatch({ density: "compact", reduceMotion: true })).toEqual({
      density: "compact",
      reduceMotion: true,
    });
  });

  test("parseTotpToken requires a 6-8 digit numeric string", () => {
    expect(parseTotpToken({ token: "123456" })).toBe("123456");
    expect(() => parseTotpToken({ token: "12a456" })).toThrow();
    expect(() => parseTotpToken({})).toThrow();
  });

  test("parseTotpCredential requires token or backupCode", () => {
    expect(() => parseTotpCredential({})).toThrow();
    expect(parseTotpCredential({ token: "123456" })).toEqual({ token: "123456" });
    expect(parseTotpCredential({ backupCode: "ABCDE-FGHIJ" })).toEqual({ backupCode: "ABCDE-FGHIJ" });
  });

  test("sanitizeRoleName / sanitizeToolId reject unknown ids", () => {
    for (const r of ROLE_NAMES) expect(sanitizeRoleName(r)).toBe(r);
    expect(() => sanitizeRoleName("superuser")).toThrow();
    for (const t of TOOL_IDS) expect(sanitizeToolId(t)).toBe(t);
    expect(() => sanitizeToolId("bogus")).toThrow();
  });

  test("parseRolePermsPatch / parseToolPolicyPatch require at least one field", () => {
    expect(() => parseRolePermsPatch({})).toThrow();
    expect(parseRolePermsPatch({ vault: "deny" })).toEqual({ vault: "deny" });
    expect(() => parseRolePermsPatch({ vault: "maybe" })).toThrow();
    expect(() => parseToolPolicyPatch({})).toThrow();
    expect(parseToolPolicyPatch({ policy: "ask" })).toEqual({ policy: "ask" });
  });
});

// ── Service — RBAC roles CRUD (real SQLite) ──────────────────────────────────
describe("O8 settings — RBAC roles (service, real store)", () => {
  test("listRoles returns the 5 default roles, owner locked", async () => {
    const roles = await settingsService.listRoles();
    expect(roles.map((r) => r.name).sort()).toEqual([...ROLE_NAMES].sort());
    const owner = roles.find((r) => r.name === "owner")!;
    expect(owner.locked).toBe(true);
    expect(owner.perms.vault).toBe("allow");
  });

  test("updateRolePerms updates a non-locked role", async () => {
    const updated = await settingsService.updateRolePerms("operator", { vault: "scoped" });
    expect(updated.perms.vault).toBe("scoped");
    const roles = await settingsService.listRoles();
    expect(roles.find((r) => r.name === "operator")!.perms.vault).toBe("scoped");
  });

  test("updateRolePerms on 'owner' (locked) throws — owner always retains full control", async () => {
    await expect(settingsService.updateRolePerms("owner", { vault: "deny" })).rejects.toThrow(/locked/);
  });

  test("updateRolePerms on unknown role throws", async () => {
    await expect(settingsService.updateRolePerms("nope" as never, { vault: "deny" })).rejects.toThrow();
  });
});

// ── Service — tool policy CRUD ────────────────────────────────────────────────
describe("O8 settings — tool policy (service, real store)", () => {
  test("listToolPolicy returns the 8 default tools", async () => {
    const tools = await settingsService.listToolPolicy();
    expect(tools.map((t) => t.tool).sort()).toEqual([...TOOL_IDS].sort());
  });

  test("updateToolPolicy updates policy + scope and persists", async () => {
    const updated = await settingsService.updateToolPolicy("sh", { policy: "deny", scope: "none" });
    expect(updated.policy).toBe("deny");
    expect(updated.scope).toBe("none");
    const tools = await settingsService.listToolPolicy();
    expect(tools.find((t) => t.tool === "sh")!.policy).toBe("deny");
  });
});

// ── Service — 2FA enroll → activate → step-up → replay → disable ────────────
// Time is injected (fixed base + explicit ±30s step advances) via the service's
// `{ now }` DI so the replay guard (a code from time-step C can't be reused, and
// a later step C+1 is required for the NEXT verify) is exercised deterministically
// — the same time-injection discipline totp.ts already uses. No wall-clock races.
describe("O8 settings — 2FA TOTP lifecycle (service, real store, real crypto)", () => {
  const BASE = 1_700_000_000; // fixed unix seconds
  const STEP = 30;

  test("enroll → activate with valid code → enabled + 10 backup codes", async () => {
    const status0 = await settingsService.get2faStatus();
    expect(status0.enabled).toBe(false);

    const { secret } = await settingsService.enroll2fa();
    const activated = await settingsService.activate2fa(totp(secret, { time: BASE }), { now: BASE });
    expect(activated.enabled).toBe(true);
    expect(activated.backupCodes).toHaveLength(10);

    const status1 = await settingsService.get2faStatus();
    expect(status1.enabled).toBe(true);
    expect(status1.backupCodesRemaining).toBe(10);
  });

  test("activate2fa with a wrong code throws", async () => {
    await settingsService.enroll2fa();
    await expect(settingsService.activate2fa("000000", { now: BASE })).rejects.toThrow();
  });

  test("verify2fa: a fresh-step code passes once, replay of the SAME code is rejected", async () => {
    const { secret } = await settingsService.enroll2fa();
    await settingsService.activate2fa(totp(secret, { time: BASE }), { now: BASE });

    // Next time-step (C+1) — activation consumed step C, so verifying needs a newer step.
    const t1 = BASE + STEP;
    const code1 = totp(secret, { time: t1 });
    const first = await settingsService.verify2fa({ token: code1 }, { now: t1 });
    expect(first.ok).toBe(true);
    const replay = await settingsService.verify2fa({ token: code1 }, { now: t1 });
    expect(replay.ok).toBe(false); // same time-step counter already consumed
  });

  test("verify2fa accepts a one-time backup code, then rejects it on reuse", async () => {
    const { secret } = await settingsService.enroll2fa();
    const { backupCodes } = await settingsService.activate2fa(totp(secret, { time: BASE }), { now: BASE });

    const useOnce = await settingsService.verify2fa({ backupCode: backupCodes[0] });
    expect(useOnce.ok).toBe(true);
    expect(useOnce.usedBackupCode).toBe(true);
    const reuse = await settingsService.verify2fa({ backupCode: backupCodes[0] });
    expect(reuse.ok).toBe(false);
  });

  test("regenerateBackupCodes requires a valid credential and replaces the set", async () => {
    const { secret } = await settingsService.enroll2fa();
    await settingsService.activate2fa(totp(secret, { time: BASE }), { now: BASE });

    const t1 = BASE + STEP;
    const rejected = await settingsService.regenerateBackupCodes({ token: "000000" }, { now: t1 });
    expect(rejected).toBeNull();

    const fresh = await settingsService.regenerateBackupCodes({ token: totp(secret, { time: t1 }) }, { now: t1 });
    expect(fresh).toHaveLength(10);
  });

  test("disable2fa requires a valid credential, then clears state", async () => {
    const { secret } = await settingsService.enroll2fa();
    await settingsService.activate2fa(totp(secret, { time: BASE }), { now: BASE });

    const t1 = BASE + STEP;
    const rejected = await settingsService.disable2fa({ token: "000000" }, { now: t1 });
    expect(rejected).toBe(false);

    const ok = await settingsService.disable2fa({ token: totp(secret, { time: t1 }) }, { now: t1 });
    expect(ok).toBe(true);
    const status = await settingsService.get2faStatus();
    expect(status.enabled).toBe(false);
    expect(status.backupCodesRemaining).toBe(0);
  });
});

// ── Service — sessions list/revoke ────────────────────────────────────────────
describe("O8 settings — sessions (service, real store)", () => {
  test("listSessions seeds a single 'current' local session", async () => {
    const sessions = await settingsService.listSessions();
    expect(sessions.length).toBeGreaterThanOrEqual(1);
    expect(sessions.some((s) => s.current)).toBe(true);
  });

  test("revokeSession refuses to revoke the current session", async () => {
    const [current] = await settingsService.listSessions();
    expect(await settingsService.revokeSession(current.id)).toBe(false);
  });

  test("revokeSession returns false for an unknown id", async () => {
    expect(await settingsService.revokeSession("does-not-exist")).toBe(false);
  });
});

// ── Service — general prefs + sandbox toggle ─────────────────────────────────
describe("O8 settings — general prefs + sandbox toggle (service, real store)", () => {
  test("getGeneralPrefs defaults, updateGeneralPrefs persists a partial patch", async () => {
    const defaults = await settingsService.getGeneralPrefs();
    expect(defaults.theme).toBe("dark");
    const updated = await settingsService.updateGeneralPrefs({ theme: "light", reduceMotion: true });
    expect(updated.theme).toBe("light");
    expect(updated.reduceMotion).toBe(true);
    expect(updated.density).toBe(defaults.density); // untouched fields preserved
  });

  test("sandbox toggle flips and persists", async () => {
    expect(await settingsService.getSandboxEnforced()).toBe(true); // default ON
    await settingsService.setSandboxEnforced(false);
    expect(await settingsService.getSandboxEnforced()).toBe(false);
  });
});

// ── Route + toggle (functional) ──────────────────────────────────────────────
describe("O8 settings — route + toggle", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountEnabledModules(app, { MODULE_SETTINGS: "1" } as NodeJS.ProcessEnv);
    server = http.createServer(app as unknown as http.RequestListener);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });
  afterAll(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  test("MODULE_SETTINGS=1 → GET /general 200 + shape; module in /api/modules list", async () => {
    const res = await fetch(`${base}/api/modules/settings/general`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(typeof body.theme).toBe("string");
    process.env.MODULE_SETTINGS = "1";
    expect(enabledModules().map((m) => m.id)).toContain("settings");
    delete process.env.MODULE_SETTINGS;
  });

  test("GET /roles → 200 with 5 roles", async () => {
    const res = await fetch(`${base}/api/modules/settings/roles`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.roles).toHaveLength(5);
  });

  test("GET /tools/policy → 200 with 8 tools", async () => {
    const res = await fetch(`${base}/api/modules/settings/tools/policy`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tools).toHaveLength(8);
  });

  test("PUT /roles/owner (locked) → 403", async () => {
    const res = await fetch(`${base}/api/modules/settings/roles/owner`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ vault: "deny" }),
    });
    expect(res.status).toBe(403);
  });

  test("POST /security/2fa/verify with no credential → 400 (schema validation, state-independent)", async () => {
    const res = await fetch(`${base}/api/modules/settings/security/2fa/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400); // parseTotpCredential rejects empty body — deterministic, no state coupling
  });

  test("MODULE_SETTINGS unset → routes 404 (toggle-off blackout)", async () => {
    const off = express();
    off.use(express.json());
    mountEnabledModules(off, {} as NodeJS.ProcessEnv);
    const s = http.createServer(off as unknown as http.RequestListener);
    await new Promise<void>((r) => s.listen(0, () => r()));
    const addr = s.address();
    const b = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    try {
      expect((await fetch(`${b}/api/modules/settings/general`)).status).toBe(404);
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});

// ── localOwnerGuard invariant: /api/modules/settings is 403 under SaaS (P8) ──
describe("O8 settings — localOwnerGuard (SAAS_ENFORCE=1 → 403)", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    process.env.OLLAMAS_NO_AUTOBOOT = "1";
    process.env.MODULE_SETTINGS = "1";
    delete process.env.SAAS_ENFORCE;
    const { app } = await import("../../server");
    server = http.createServer(app as unknown as http.RequestListener);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 60_000);
  afterAll(async () => {
    delete process.env.SAAS_ENFORCE;
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  test("SAAS_ENFORCE=1 → /api/modules/settings/* is 403 (inherits the guard)", async () => {
    process.env.SAAS_ENFORCE = "1";
    expect((await fetch(`${base}/api/modules/settings/general`)).status).toBe(403);
    delete process.env.SAAS_ENFORCE;
  });

  test("SAAS_ENFORCE unset → guard calls next() (not 403)", async () => {
    delete process.env.SAAS_ENFORCE;
    expect((await fetch(`${base}/api/modules/settings/general`)).status).not.toBe(403);
  });
});
