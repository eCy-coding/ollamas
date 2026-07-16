// Faz 26 (v1.17) — sweeper LIFECYCLE for server/oauth-gc.ts.
// C2: oauth-gc no longer owns its own setInterval — it registers a durable "oauth-gc"
// job handler on server/jobs.ts's queue (side effect of importing the module), and
// server/jobs.ts's startJobs() croner-schedules it (OAUTH_GC_CRON, default hourly)
// plus enqueues one immediate sweep at boot. purgeExpiredOAuth is mocked so these
// tests are hermetic (no real OAuth rows) and assert the lifecycle contract: the
// handler runs the sweep, never throws even when the sweep itself fails (GC must
// never crash the job queue), and the boot-time immediate sweep actually fires
// through the real durable-queue plumbing (server/jobs.test.ts covers
// registerRecurring / durable-queue mechanics generically).
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAdapter, type DbClient } from "../server/store/db-adapter";

const { purge } = vi.hoisted(() => ({ purge: vi.fn(async () => ({ codes: 0, tokens: 0, refresh: 0 })) }));
vi.mock("../server/store", () => ({ purgeExpiredOAuth: purge }));

import { initJobsSchema, enqueue, claimNext, runClaimedJob, listRecentJobs, startJobs, stopJobs, getJobsSnapshot } from "../server/jobs";
import "../server/oauth-gc"; // registers the "oauth-gc" handler onto the jobs queue above

describe("OAuth GC sweeper lifecycle (server/oauth-gc, migrated onto server/jobs.ts — C2)", () => {
  beforeEach(() => { purge.mockClear(); });

  describe("job-handler contract", () => {
    let db: DbClient;
    beforeEach(async () => {
      const file = path.join(os.tmpdir(), `ollamas-oauthgc-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
      delete process.env.DATABASE_URL;
      process.env.SAAS_DB_PATH = file;
      db = await createAdapter();
      await initJobsSchema(db);
      // Re-import side effect already registered "oauth-gc" at module load; nothing to redo here.
    });
    afterEach(async () => {
      const file = process.env.SAAS_DB_PATH!;
      await db.close();
      for (const f of [file, `${file}-wal`, `${file}-shm`]) try { fs.unlinkSync(f); } catch {}
    });

    test("running the durable job calls purgeExpiredOAuth and marks it done", async () => {
      await enqueue(db, "oauth-gc", {});
      const job = await claimNext(db);
      expect(job).not.toBeNull();
      await runClaimedJob(db, job!);
      expect(purge).toHaveBeenCalledTimes(1);
      const [row] = await listRecentJobs(db, 5);
      expect(row.state).toBe("done"); // GC is best-effort — never left pending/failed
    });

    test("a throwing purge is swallowed — the job still ends up done, not failed", async () => {
      purge.mockRejectedValueOnce(new Error("db locked"));
      await enqueue(db, "oauth-gc", {});
      const job = await claimNext(db);
      await runClaimedJob(db, job!);
      expect(purge).toHaveBeenCalledTimes(1);
      const [row] = await listRecentJobs(db, 5);
      expect(row.state).toBe("done"); // matches the old fire-and-forget .catch(() => {}) semantics
    });
  });

  describe("startJobs() boot-time immediate sweep", () => {
    afterEach(async () => {
      await stopJobs();
      const file = process.env.SAAS_DB_PATH;
      if (file) for (const f of [file, `${file}-wal`, `${file}-shm`]) try { fs.unlinkSync(f); } catch {}
      delete process.env.JOBS_BOOT_DELAY_MS;
      delete process.env.JOBS_POLL_INTERVAL_MS;
      delete process.env.OAUTH_GC_CRON;
    });

    test("startJobs() enqueues and runs an oauth-gc sweep at boot without waiting for the cron", async () => {
      delete process.env.DATABASE_URL;
      process.env.SAAS_DB_PATH = path.join(os.tmpdir(), `ollamas-oauthgc-boot-${process.pid}-${Date.now()}.db`);
      process.env.JOBS_BOOT_DELAY_MS = "10";
      process.env.JOBS_POLL_INTERVAL_MS = "20";
      process.env.OAUTH_GC_CRON = "0 0 1 1 *"; // once a year — proves the boot sweep, not the cron, fired
      startJobs();
      await vi.waitFor(() => expect(purge).toHaveBeenCalled(), { timeout: 3000 });
      await vi.waitFor(() => expect(getJobsSnapshot().recent.some((j) => j.name === "oauth-gc" && j.state === "done")).toBe(true), { timeout: 3000 });
    }, 10_000);
  });
});
