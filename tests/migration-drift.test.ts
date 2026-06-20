// vC1 P4 — regression for the oauth_refresh_tokens migration-drift boot crash.
//
// Bug: migration v4 does `CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (...)`
// then `CREATE INDEX ... ON oauth_refresh_tokens(family_id)`. If an older-shaped
// table already exists (no family_id), the CREATE TABLE is a no-op and the index
// fails with "no such column: family_id" → initStore() crashes on boot.
// Fix: guarded ADD COLUMN drift-repair before the index. These tests reproduce
// the drift scenario and assert the migration is now idempotent against it.

import { describe, test, expect, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createAdapter, type DbClient } from "../server/store/db-adapter";
import { MIGRATIONS } from "../server/store/migrations";

const v4 = MIGRATIONS.find((m) => m.version === 4)!;
const files: string[] = [];

async function freshDb(tag: string): Promise<DbClient> {
  const file = path.join(os.tmpdir(), `ollamas-drift-${process.pid}-${tag}.db`);
  for (const f of [file, `${file}-wal`, `${file}-shm`]) try { fs.unlinkSync(f); } catch {}
  files.push(file);
  delete process.env.DATABASE_URL;
  process.env.SAAS_DB_PATH = file;
  return createAdapter();
}

const columns = async (db: DbClient, t: string) =>
  (await db.query(`PRAGMA table_info(${t})`)).rows.map((r: any) => r.name as string);
const indexes = async (db: DbClient, t: string) =>
  (await db.query(`PRAGMA index_list(${t})`)).rows.map((r: any) => r.name as string);

afterAll(() => {
  for (const file of files) for (const f of [file, `${file}-wal`, `${file}-shm`]) try { fs.unlinkSync(f); } catch {}
});

describe("migration v4 — oauth_refresh_tokens drift", () => {
  test("fresh DB: creates table with family_id + index", async () => {
    const db = await freshDb("fresh");
    await expect(v4.up(db)).resolves.toBeUndefined();
    expect(await columns(db, "oauth_refresh_tokens")).toContain("family_id");
    expect(await indexes(db, "oauth_refresh_tokens")).toContain("idx_oauth_refresh_family");
  });

  test("DRIFT: pre-existing old-shape table (no family_id) does NOT crash", async () => {
    const db = await freshDb("drift");
    // Simulate an older-shaped table from a prior schema.
    await db.exec("CREATE TABLE oauth_refresh_tokens (refresh_token_hash TEXT PRIMARY KEY, created_at TEXT)");
    await db.run("INSERT INTO oauth_refresh_tokens (refresh_token_hash, created_at) VALUES (?, ?)", ["h1", "2026-01-01"]);

    // Pre-fix this threw "no such column: family_id". Now it must self-heal.
    await expect(v4.up(db)).resolves.toBeUndefined();
    expect(await columns(db, "oauth_refresh_tokens")).toContain("family_id");
    expect(await indexes(db, "oauth_refresh_tokens")).toContain("idx_oauth_refresh_family");
    // Existing row survives the repair.
    expect((await db.query("SELECT refresh_token_hash FROM oauth_refresh_tokens")).rows).toHaveLength(1);
  });

  test("idempotent: running twice is a no-op (no duplicate-column throw)", async () => {
    const db = await freshDb("idem");
    await v4.up(db);
    await expect(v4.up(db)).resolves.toBeUndefined();
  });
});
