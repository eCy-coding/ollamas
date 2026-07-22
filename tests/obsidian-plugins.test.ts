// L25 plugin runtime installer — pin/lock integrity and the guards that caught two real
// upstream defects (dataview's tag/manifest skew, calendar shipping no styles.css).
import { describe, test, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { PLUGINS, loadLock, lockEntryFor, sha256, assetUrl, lockPath, vaultPath, pluginsTrusted } from "../scripts/obsidian-plugins";

describe("pinned plugin set", () => {
  test("every plugin is fully pinned and uniquely id'd", () => {
    expect(PLUGINS.length).toBeGreaterThanOrEqual(11);
    const ids = PLUGINS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of PLUGINS) {
      expect(p.version, p.id).toMatch(/^\d+\.\d+\.\d+/);
      expect(p.repo, p.id).toMatch(/^[\w.-]+\/[\w.-]+$/);
      expect(p.why.length, p.id).toBeGreaterThan(10); // every entry justifies itself
      // main.js + manifest.json are load-bearing; styles.css is optional upstream.
      expect(p.files, p.id).toContain("main.js");
      expect(p.files, p.id).toContain("manifest.json");
    }
  });

  test("Smart Connections stays excluded — it would duplicate the brain's KNN neighbours", () => {
    expect(PLUGINS.some((p) => /smart-connections/i.test(p.id))).toBe(false);
  });

  test("calendar pins no styles.css (upstream 1.5.10 ships none)", () => {
    const cal = PLUGINS.find((p) => p.id === "calendar")!;
    expect(cal.files).not.toContain("styles.css");
  });

  test("dataview records the upstream manifest skew instead of dropping the check", () => {
    const dv = PLUGINS.find((p) => p.id === "dataview")!;
    expect(dv.version).toBe("0.5.70");
    expect(dv.manifestVersion).toBe("0.5.68");
  });

  test("asset URLs point at the pinned release tag", () => {
    const dv = PLUGINS.find((p) => p.id === "dataview")!;
    expect(assetUrl(dv, "main.js"))
      .toBe("https://github.com/blacksmithgu/obsidian-dataview/releases/download/0.5.70/main.js");
  });
});

describe("lockfile", () => {
  const lock = loadLock();

  test("is committed and covers every pinned plugin at the pinned version", () => {
    expect(existsSync(lockPath())).toBe(true);
    for (const p of PLUGINS) {
      const e = lockEntryFor(lock, p);
      expect(e, `${p.id} missing/stale in lock`).toBeTruthy();
      for (const f of p.files) expect(e!.sha256[f], `${p.id}/${f}`).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("lockEntryFor rejects a version bump — a re-pin must be re-locked", () => {
    const p = PLUGINS[0];
    expect(lockEntryFor(lock, p)).toBeTruthy();
    expect(lockEntryFor(lock, { ...p, version: "999.0.0" })).toBeNull();
  });

  test("sha256 is content-addressed (guards the fail-closed compare)", () => {
    expect(sha256("a")).toBe(sha256(Buffer.from("a")));
    expect(sha256("a")).not.toBe(sha256("b"));
  });
});

describe("installed runtime", () => {
  // Skipped on a machine without the real vault (CI) — asserted live in the L32 e2e gate.
  const vault = vaultPath();
  const has = existsSync(join(vault, ".obsidian", "plugins"));

  test.skipIf(!has)("on-disk bytes match the lock for every plugin", () => {
    const lock = loadLock();
    for (const p of PLUGINS) {
      const e = lockEntryFor(lock, p)!;
      for (const f of p.files) {
        const dst = join(vault, ".obsidian", "plugins", p.id, f);
        expect(existsSync(dst), `${p.id}/${f} not installed`).toBe(true);
        expect(sha256(readFileSync(dst)), `${p.id}/${f}`).toBe(e.sha256[f]);
      }
    }
  });

  test("trust probe is read-only and total — unknown vault yields null, never a throw", () => {
    // The probe must never crash a sync tick just because the app was never launched.
    expect(pluginsTrusted("/nonexistent/vault/path")).toBeNull();
    const v = pluginsTrusted();
    expect(v === true || v === false || v === null).toBe(true);
  });

  test.skipIf(!has)("every installed plugin is enabled", () => {
    const enabled: string[] = JSON.parse(readFileSync(join(vault, ".obsidian", "community-plugins.json"), "utf8"));
    for (const p of PLUGINS) expect(enabled, p.id).toContain(p.id);
  });
});
