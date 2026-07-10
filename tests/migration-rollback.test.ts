// M-045 (GAP-041) — migration rollback/down path. The forward-only runner gains an optional
// down(db) per migration + rollbackTo(db, targetVersion) so a bad upgrade can return to the last
// sound version. down() reverses up() (DROP the table/index/column it created) and the runner
// deletes the schema_migrations row so a later up re-applies cleanly. The existing up-path is
// unchanged — this only ADDS a reverse path.
import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createAdapter, type DbClient } from "../server/store/db-adapter";
import { MIGRATIONS, runMigrations, rollbackTo } from "../server/store/migrations";

const files: string[] = [];

async function freshDb(tag: string): Promise<DbClient> {
  const file = path.join(os.tmpdir(), `ollamas-rollback-${process.pid}-${tag}.db`);
  for (const f of [file, `${file}-wal`, `${file}-shm`]) try { fs.unlinkSync(f); } catch {}
  files.push(file);
  delete process.env.DATABASE_URL;
  process.env.SAAS_DB_PATH = file;
  const db = await createAdapter();
  // Baseline: production runs runMigrations() AFTER initStore()'s CREATE-TABLE DDL. The only
  // baseline table a migration's up-path touches is usage_events (v1 indexes it), so stand it
  // up here to mirror boot order without pulling in the whole store singleton.
  await db.exec("CREATE TABLE IF NOT EXISTS usage_events (id INTEGER PRIMARY KEY, ts TEXT)");
  return db;
}

const appliedVersions = async (db: DbClient): Promise<number[]> =>
  (await db.query("SELECT version FROM schema_migrations ORDER BY version")).rows.map((r: any) => Number(r.version));

const tableExists = async (db: DbClient, t: string): Promise<boolean> => {
  // sqlite-only introspection is enough for this test (SAAS_DB_PATH → node:sqlite).
  const rows = (await db.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?", [t])).rows;
  return rows.length > 0;
};

afterAll(() => {
  for (const file of files) for (const f of [file, `${file}-wal`, `${file}-shm`]) try { fs.unlinkSync(f); } catch {}
});

describe("M-045 migration rollback", () => {
  test("every current migration defines a down() (rollback is total)", () => {
    for (const m of MIGRATIONS) {
      expect(typeof m.down, `migration v${m.version} (${m.name}) missing down()`).toBe("function");
    }
  });

  test("up → rollbackTo(0) removes all applied migrations + their schema objects", async () => {
    const db = await freshDb("full");
    await runMigrations(db);
    expect(await appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await tableExists(db, "oauth_clients")).toBe(true);
    expect(await tableExists(db, "ukp_stage_events")).toBe(true);

    const rolled = await rollbackTo(db, 0);
    expect(rolled).toEqual([6, 5, 4, 3, 2, 1]); // newest-first unwind order
    expect(await appliedVersions(db)).toEqual([]);
    expect(await tableExists(db, "oauth_clients")).toBe(false);
    expect(await tableExists(db, "ukp_stage_events")).toBe(false);
  });

  test("partial rollbackTo(3) unwinds only versions > 3", async () => {
    const db = await freshDb("partial");
    await runMigrations(db);
    const rolled = await rollbackTo(db, 3);
    expect(rolled).toEqual([6, 5, 4]);
    expect(await appliedVersions(db)).toEqual([1, 2, 3]);
    // v4 created oauth_refresh_tokens → gone; v2 oauth_clients (≤3) → retained.
    expect(await tableExists(db, "oauth_refresh_tokens")).toBe(false);
    expect(await tableExists(db, "oauth_clients")).toBe(true);
  });

  test("rollback then re-up returns to full schema (down is a clean reverse)", async () => {
    const db = await freshDb("reup");
    await runMigrations(db);
    await rollbackTo(db, 0);
    const reapplied = await runMigrations(db);
    expect(reapplied).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(await tableExists(db, "ukp_stage_events")).toBe(true);
  });

  test("rollbackTo above the current max is a no-op", async () => {
    const db = await freshDb("noop");
    await runMigrations(db);
    const rolled = await rollbackTo(db, 6);
    expect(rolled).toEqual([]);
    expect(await appliedVersions(db)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});
