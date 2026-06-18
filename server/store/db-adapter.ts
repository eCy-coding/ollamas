// Unified async data-access layer (Faz 12A). One async API over BOTH Node's
// built-in node:sqlite (default, zero-config) and node-postgres `pg` (when
// DATABASE_URL is set → multi-replica scale). SQLite calls are sync under the
// hood but wrapped in Promises so every store helper has a single code path.

import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export type Dialect = "sqlite" | "pg";
export interface DbResult { rows: any[]; rowCount: number; }
export interface DbRun { changes: number; lastId?: number | bigint; }

export interface DbClient {
  dialect: Dialect;
  query(sql: string, params?: any[]): Promise<DbResult>;
  run(sql: string, params?: any[]): Promise<DbRun>;
  exec(sql: string): Promise<void>;
}

class SqliteAdapter implements DbClient {
  dialect: Dialect = "sqlite";
  constructor(public raw: DatabaseSync) {}
  async query(sql: string, params: any[] = []): Promise<DbResult> {
    const rows = this.raw.prepare(sql).all(...params) as any[];
    return { rows, rowCount: rows.length };
  }
  async run(sql: string, params: any[] = []): Promise<DbRun> {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastId: r.lastInsertRowid };
  }
  async exec(sql: string): Promise<void> { this.raw.exec(sql); }
}

// Rewrite `?` positional params → `$1, $2, ...` for Postgres. Our SQL has no `?`
// inside string literals, so a plain replace is safe.
function toPg(sql: string): string { let n = 0; return sql.replace(/\?/g, () => `$${++n}`); }

class PostgresAdapter implements DbClient {
  dialect: Dialect = "pg";
  constructor(public pool: any) {}
  async query(sql: string, params: any[] = []): Promise<DbResult> {
    const r = await this.pool.query(toPg(sql), params);
    return { rows: r.rows, rowCount: r.rowCount ?? r.rows.length };
  }
  async run(sql: string, params: any[] = []): Promise<DbRun> {
    const r = await this.pool.query(toPg(sql), params);
    return { changes: r.rowCount ?? 0, lastId: r.rows?.[0]?.id };
  }
  async exec(sql: string): Promise<void> { await this.pool.query(sql); } // simple query → multi-statement ok
}

/** Build the adapter: Postgres when DATABASE_URL is set, else node:sqlite. */
export async function createAdapter(): Promise<DbClient> {
  if (process.env.DATABASE_URL) {
    const { Pool } = await import("pg");
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: Number(process.env.DB_POOL_SIZE || 5),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
    pool.on("error", () => {}); // keep the process alive on idle-client errors
    return new PostgresAdapter(pool);
  }
  const dir = process.env.MISSION_CONTROL_DATA_DIR || path.join(os.homedir(), ".llm-mission-control");
  const dbPath = process.env.SAAS_DB_PATH || path.join(dir, "saas.db");
  fs.mkdirSync(dir, { recursive: true });
  const raw = new DatabaseSync(dbPath);
  return new SqliteAdapter(raw);
}
