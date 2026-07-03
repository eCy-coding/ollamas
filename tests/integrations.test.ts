import { describe, test, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import { parseGhToken, parseScopes } from "../server/integrations";

const GHO = "gho_" + "A".repeat(36);
const GHP = "ghp_" + "b3".repeat(18);

describe("parseGhToken", () => {
  test("accepts gho_/ghp_ with 36+ base62 chars", () => {
    expect(parseGhToken(GHO)).toBe(GHO);
    expect(parseGhToken(GHP)).toBe(GHP);
    expect(parseGhToken(`  ${GHO}\n`)).toBe(GHO); // trimmed
  });
  test("rejects junk / empty / short / wrong-prefix", () => {
    expect(parseGhToken("")).toBeNull();
    expect(parseGhToken("not-a-token")).toBeNull();
    expect(parseGhToken("gho_short")).toBeNull();
    expect(parseGhToken("ghx_" + "A".repeat(36))).toBeNull();
    expect(parseGhToken("gho_" + "A".repeat(36) + " rm -rf")).toBeNull(); // no injection tail
  });
});

describe("parseScopes", () => {
  test("extracts scopes from gh auth status output", () => {
    const out = "  ✓ Logged in\n  - Token scopes: 'gist', 'read:org', 'repo'\n";
    expect(parseScopes(out)).toEqual(["gist", "read:org", "repo"]);
  });
  test("empty when no scopes line", () => {
    expect(parseScopes("no scopes here")).toEqual([]);
  });
});

describe("autoconnectGitHub — writes vault, never leaks token", () => {
  const DB = path.join(os.tmpdir(), `ollamas-int-${process.pid}.db`);
  let mod: typeof import("../server/integrations");
  let store: typeof import("../server/db");

  beforeEach(async () => {
    for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
    process.env.MISSION_CONTROL_DATA_DIR = os.tmpdir();
    vi.resetModules();
    store = await import("../server/db");
    mod = await import("../server/integrations");
    store.db.data.keys = {};
  });

  test("stores the gh token as encrypted github vault key; response has no raw token", async () => {
    const r = await mod.autoconnectGitHub(async () => GHO, async () => "Token scopes: 'repo'");
    expect(r.ok).toBe(true);
    expect(r.source).toBe("gh-cli");
    expect(r.scopes).toContain("repo");
    expect(r.last4).toBe(GHO.slice(-4));
    // The raw token must not appear anywhere in the response.
    expect(JSON.stringify(r)).not.toContain(GHO);
    // Vault holds it, encrypted (not the plaintext).
    const stored = store.db.data.keys!["github"];
    expect(stored).toBeTruthy();
    expect(stored).not.toBe(GHO);
    expect(store.db.decrypt(stored)).toBe(GHO);
  });

  test("gh absent/unauthed → ok:false + actionable hint, no vault write", async () => {
    const r = await mod.autoconnectGitHub(async () => "", async () => "");
    expect(r.ok).toBe(false);
    expect(r.hint).toMatch(/gh auth login|PAT/);
    expect(store.db.data.keys!["github"]).toBeUndefined();
  });

  test("idempotent: re-run overwrites cleanly", async () => {
    await mod.autoconnectGitHub(async () => GHO, async () => "");
    const r = await mod.autoconnectGitHub(async () => GHP, async () => "");
    expect(r.ok).toBe(true);
    expect(store.db.decrypt(store.db.data.keys!["github"])).toBe(GHP);
  });
});
