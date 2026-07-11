// O0 Faz 3 (02-o0-foundation.md §3 FAZ 3, RED 6-9) — migration discipline for
// module tables: v7 appended to the SINGLE core ledger (idempotent, rollbackable),
// assertUniqueVersions over the COMBINED core+module list (KN-A7), and the
// _core/store facade import-guard (eslint no-restricted-imports, notes-K2).
// DB setup mirrors tests/migration-rollback.test.ts (temp sqlite via SAAS_DB_PATH).
import { describe, test, expect, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createAdapter, type DbClient } from "../db-adapter";
import { MIGRATIONS, runMigrations, rollbackTo, assertUniqueVersions } from "../migrations";
import { defineModule, allModuleMigrations, _resetModulesForTest } from "../../modules/registry";

const files: string[] = [];

async function freshDb(tag: string): Promise<DbClient> {
  const file = path.join(os.tmpdir(), `ollamas-o0-mig-${process.pid}-${tag}.db`);
  for (const f of [file, `${file}-wal`, `${file}-shm`]) try { fs.unlinkSync(f); } catch {}
  files.push(file);
  delete process.env.DATABASE_URL;
  process.env.SAAS_DB_PATH = file;
  const db = await createAdapter();
  // Mirror boot order: v1 indexes the baseline usage_events table.
  await db.exec("CREATE TABLE IF NOT EXISTS usage_events (id INTEGER PRIMARY KEY, ts TEXT)");
  return db;
}

const tableExists = async (db: DbClient, t: string): Promise<boolean> =>
  (await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t])).rows.length > 0;

afterEach(() => _resetModulesForTest());
afterAll(() => {
  for (const file of files) for (const f of [file, `${file}-wal`, `${file}-shm`]) try { fs.unlinkSync(f); } catch {}
});

describe("v7 module tables (O0.migrations)", () => {
  test("v7 exists, applies once, and a second runMigrations is a no-op ([])", async () => {
    const db = await freshDb("idem");
    const first = await runMigrations(db);
    expect(first).toContain(7);
    expect(await tableExists(db, "modules_registry")).toBe(true);
    expect(await tableExists(db, "module_demo_items")).toBe(true);
    const second = await runMigrations(db);
    expect(second).toEqual([]);
    await db.close();
  });

  test("rollbackTo(db, 6) reverses v7; re-running runMigrations re-applies it", async () => {
    const db = await freshDb("rollback");
    await runMigrations(db);
    const rolled = await rollbackTo(db, 6);
    expect(rolled).toEqual([7]);
    expect(await tableExists(db, "modules_registry")).toBe(false);
    expect(await tableExists(db, "module_demo_items")).toBe(false);
    const reapplied = await runMigrations(db);
    expect(reapplied).toEqual([7]);
    expect(await tableExists(db, "module_demo_items")).toBe(true);
    await db.close();
  });
});

describe("combined ledger uniqueness (KN-A7)", () => {
  test("a fake module claiming an already-shipped version → assertUniqueVersions throws", () => {
    const maxCore = Math.max(...MIGRATIONS.map((m) => m.version));
    defineModule({
      id: "clash",
      envFlag: "MODULE_CLASH",
      mountRoutes() {},
      migrations: [{ version: maxCore, name: "clash_dup", up: async () => {} }],
    });
    expect(() => assertUniqueVersions([...MIGRATIONS, ...allModuleMigrations()])).toThrow(
      /Duplicate migration version/,
    );
  });
});

describe("_core/store import-guard (P6, eslint no-restricted-imports)", () => {
  // ESLint's cold-start (config resolution + TS parser load) can exceed the 5s
  // default under full-suite CPU contention (localowner-guard.test.ts uses the
  // same 30s headroom). The assertion is unchanged.
  test("a module file importing server/store directly → lint error; _core stays exempt", async () => {
    const { ESLint } = await import("eslint");
    const eslint = new ESLint({ cwd: path.resolve(__dirname, "../../..") });
    const badCode = 'import { initStore } from "../../store/index";\nvoid initStore;\n';
    const [bad] = await eslint.lintText(badCode, {
      filePath: path.resolve(__dirname, "../../modules/fake-mod/bad-import.ts"),
      warnIgnored: true,
    });
    const restricted = (bad?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports");
    expect(restricted.length, "direct store import from a module must FAIL lint").toBeGreaterThan(0);

    // The facade itself is the ONE sanctioned access point — must lint clean.
    const [core] = await eslint.lintFiles([path.resolve(__dirname, "../../modules/_core/store.ts")]);
    const coreRestricted = (core?.messages ?? []).filter((m) => m.ruleId === "no-restricted-imports");
    expect(coreRestricted).toEqual([]);
  }, 30_000);
});
