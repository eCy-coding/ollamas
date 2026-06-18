import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Lifecycle: graceful close/re-init, versioned migrations, readiness ping (Faz 13).
const DB = path.join(os.tmpdir(), `ollamas-life-${process.pid}.db`);
let store: typeof import("../server/store/index");

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  store = await import("../server/store/index");
  await store.initStore();
});
afterAll(() => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

describe("store lifecycle (Faz 13A)", () => {
  test("pingStore true when initialized; false after closeStore; re-init recovers", async () => {
    expect(await store.pingStore()).toBe(true);
    await store.closeStore();
    expect(await store.pingStore()).toBe(false); // probe reports down → /api/ready 503
    await store.initStore(); // graceful restart path
    expect(await store.pingStore()).toBe(true);
  });

  test("closeStore is idempotent", async () => {
    await store.closeStore();
    await store.closeStore(); // second call no-ops, does not throw
    await store.initStore();
    expect(await store.pingStore()).toBe(true);
  });
});

describe("versioned migrations (Faz 13B)", () => {
  test("baseline migrations recorded at boot", async () => {
    const versions = await store.appliedVersions();
    expect(versions).toContain(1); // usage_events_ts_index shipped in v1.4
    expect(versions).toEqual([...versions].sort((a, b) => a - b)); // ascending, no gaps in order
  });

  test("runMigrations is idempotent — second run applies nothing", async () => {
    const applied = await store.migrateNow();
    expect(applied).toEqual([]); // all versions already in schema_migrations
  });

  test("MIGRATIONS are uniquely + monotonically versioned", async () => {
    const v = store.MIGRATIONS.map((m) => m.version);
    expect(new Set(v).size).toBe(v.length); // no duplicate versions
    expect(v).toEqual([...v].sort((a, b) => a - b)); // declared in order
  });
});
