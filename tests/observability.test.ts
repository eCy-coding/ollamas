import { describe, test, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Observability accessors + Prometheus gauges (Faz 14C), hermetic (no self-boot).
const DB = path.join(os.tmpdir(), `ollamas-obs-${process.pid}.db`);
let store: typeof import("../server/store/index");
let metrics: typeof import("../server/metrics");

beforeAll(async () => {
  process.env.SAAS_DB_PATH = DB;
  store = await import("../server/store/index");
  metrics = await import("../server/metrics");
  await store.initStore();
});
afterAll(() => {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) try { fs.unlinkSync(f); } catch {}
});

describe("store observability accessors (Faz 14C)", () => {
  test("migrationVersion reflects applied baseline; poolStats null on sqlite / counts on pg", async () => {
    expect(await store.migrationVersion()).toBeGreaterThanOrEqual(1);
    const ps = store.poolStats();
    if (process.env.DATABASE_URL) {
      expect(ps).not.toBeNull(); // pg pool exposes counters
      expect(typeof ps!.total).toBe("number");
    } else {
      expect(ps).toBeNull(); // sqlite has no connection pool
    }
  });

  test("pendingDeliveryCount tracks queued webhook deliveries", async () => {
    expect(await store.pendingDeliveryCount()).toBe(0);
    const t = await store.createTenant("obswh", "pro");
    await store.addWebhook(t.id, "http://127.0.0.1:1/hook", ["key.created"]);
    await store.queueWebhookEvent(t.id, "key.created", { keyId: "k1" });
    expect(await store.pendingDeliveryCount()).toBeGreaterThanOrEqual(1);
  });
});

describe("prometheus gauges (Faz 14C)", () => {
  test("registerStoreMetrics exposes the new series + shutdown counter", async () => {
    metrics.registerStoreMetrics({
      poolStats: store.poolStats,
      migrationVersion: store.migrationVersion,
      pendingDeliveryCount: store.pendingDeliveryCount,
    });
    metrics.shutdownTotal.inc(); // exercise the counter
    const out = await metrics.register.metrics();
    expect(out).toContain("ollamas_migration_version");
    expect(out).toContain("ollamas_webhook_queue_depth");
    expect(out).toContain("ollamas_shutdown_total");
  });

  test("registerStoreMetrics is idempotent (no duplicate-name throw)", () => {
    expect(() => metrics.registerStoreMetrics({
      poolStats: store.poolStats,
      migrationVersion: store.migrationVersion,
      pendingDeliveryCount: store.pendingDeliveryCount,
    })).not.toThrow();
  });
});
