// server/jobs.test.ts — TDD suite for the durable job queue (B1).
// DB setup mirrors server/store/__tests__/module-migrations.test.ts (temp sqlite
// via SAAS_DB_PATH, one throwaway file per test via freshDb()).
import { describe, test, expect, afterAll, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAdapter, type DbClient } from "./store/db-adapter";
import {
  initJobsSchema,
  enqueue,
  claimNext,
  markJobDone,
  markJobFailed,
  listRecentJobs,
  countsByState,
  computeRetry,
  nextBackoffMs,
  selectPruneVictims,
  pruneBackups,
  backupDb,
  registerJobHandler,
  _resetHandlersForTest,
  runClaimedJob,
  startJobs,
  stopJobs,
  getJobsSnapshot,
  type Job,
} from "./jobs";

const files: string[] = [];

async function freshDb(tag: string): Promise<DbClient> {
  const file = path.join(os.tmpdir(), `ollamas-jobs-${process.pid}-${tag}-${Date.now()}-${Math.random().toString(36).slice(2)}.db`);
  for (const f of [file, `${file}-wal`, `${file}-shm`]) try { fs.unlinkSync(f); } catch {}
  files.push(file);
  delete process.env.DATABASE_URL;
  process.env.SAAS_DB_PATH = file;
  const db = await createAdapter();
  await initJobsSchema(db);
  return db;
}

afterEach(() => _resetHandlersForTest());
afterAll(async () => {
  await stopJobs();
  for (const file of files) for (const f of [file, `${file}-wal`, `${file}-shm`]) try { fs.unlinkSync(f); } catch {}
});

describe("enqueue / claimNext", () => {
  test("enqueue then claimNext returns the job and flips it to running", async () => {
    const db = await freshDb("claim-basic");
    const id = await enqueue(db, "greet", { name: "eCy" });
    const job = await claimNext(db);
    expect(job).not.toBeNull();
    expect(job!.id).toBe(id);
    expect(job!.name).toBe("greet");
    expect(job!.payload).toEqual({ name: "eCy" });
    expect(job!.state).toBe("running");
    await db.close();
  });

  test("a job scheduled in the future is NOT claimed yet", async () => {
    const db = await freshDb("claim-future");
    await enqueue(db, "later", {}, { runAt: new Date(Date.now() + 60_000) });
    const job = await claimNext(db);
    expect(job).toBeNull();
    await db.close();
  });

  test("claimNext is exhausted after one claim — a second call returns null", async () => {
    const db = await freshDb("claim-once");
    await enqueue(db, "solo", {});
    const first = await claimNext(db);
    const second = await claimNext(db);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    await db.close();
  });

  test("two due jobs claim oldest run_at first", async () => {
    const db = await freshDb("claim-order");
    await enqueue(db, "second", {}, { runAt: new Date(Date.now() - 1_000) });
    await enqueue(db, "first", {}, { runAt: new Date(Date.now() - 5_000) });
    const job = await claimNext(db);
    expect(job!.name).toBe("first");
    await db.close();
  });
});

describe("state transitions", () => {
  test("markJobDone sets state='done'", async () => {
    const db = await freshDb("done");
    await enqueue(db, "job", {});
    const claimed = await claimNext(db);
    await markJobDone(db, claimed!.id);
    const [row] = (await listRecentJobs(db, 5));
    expect(row.state).toBe("done");
    await db.close();
  });

  test("markJobFailed below max_attempts retries with a future run_at and stays pending", async () => {
    const db = await freshDb("retry");
    await enqueue(db, "job", {}, { maxAttempts: 5 });
    const claimed = await claimNext(db);
    const decision = await markJobFailed(db, claimed!, "boom", 1_000, 60_000);
    expect(decision.state).toBe("pending");
    expect(decision.attempts).toBe(1);
    expect(new Date(decision.runAt).getTime()).toBeGreaterThan(Date.now());
    const [row] = await listRecentJobs(db, 5);
    expect(row.state).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.last_error).toBe("boom");
    await db.close();
  });

  test("markJobFailed at max_attempts-1 → attempts reaches max → state='failed', not retried", async () => {
    const db = await freshDb("exhaust");
    await enqueue(db, "job", {}, { maxAttempts: 1 });
    const claimed = await claimNext(db);
    const decision = await markJobFailed(db, claimed!, "fatal", 1_000, 60_000);
    expect(decision.state).toBe("failed");
    expect(decision.attempts).toBe(1);
    const [row] = await listRecentJobs(db, 5);
    expect(row.state).toBe("failed");
    // A failed (exhausted) job must never be claimable again.
    const reclaim = await claimNext(db);
    expect(reclaim).toBeNull();
    await db.close();
  });

  test("a retried job (run_at in the past again) becomes claimable once more", async () => {
    const db = await freshDb("reclaim");
    await enqueue(db, "job", {}, { maxAttempts: 5 });
    const claimed = await claimNext(db);
    // backoff 0ms so run_at lands at "now" (immediately claimable) for the test
    await markJobFailed(db, claimed!, "transient", 0, 0);
    const reclaimed = await claimNext(db, Date.now() + 1);
    expect(reclaimed).not.toBeNull();
    expect(reclaimed!.attempts).toBe(1);
    await db.close();
  });
});

describe("pure: nextBackoffMs / computeRetry", () => {
  test("nextBackoffMs grows exponentially and caps at maxMs", () => {
    expect(nextBackoffMs(0, 1000, 60_000)).toBe(1000);
    expect(nextBackoffMs(1, 1000, 60_000)).toBe(2000);
    expect(nextBackoffMs(2, 1000, 60_000)).toBe(4000);
    expect(nextBackoffMs(10, 1000, 60_000)).toBe(60_000);
  });

  test("computeRetry gives up exactly at maxAttempts", () => {
    const now = Date.now();
    expect(computeRetry(1, 3, 1000, 60_000, now).state).toBe("pending");
    expect(computeRetry(2, 3, 1000, 60_000, now).state).toBe("failed");
  });
});

describe("counts / recent listing", () => {
  test("countsByState aggregates across states", async () => {
    const db = await freshDb("counts");
    await enqueue(db, "a", {});
    await enqueue(db, "b", {});
    const claimed = await claimNext(db);
    await markJobDone(db, claimed!.id);
    const counts = await countsByState(db);
    expect(counts.done).toBe(1);
    expect(counts.pending).toBe(1);
    await db.close();
  });
});

describe("handler registry + runClaimedJob", () => {
  test("a registered handler runs and the job is marked done", async () => {
    const db = await freshDb("handler-ok");
    const seen: any[] = [];
    registerJobHandler("echo", (payload) => { seen.push(payload); });
    await enqueue(db, "echo", { x: 1 });
    const job = (await claimNext(db)) as Job;
    await runClaimedJob(db, job);
    expect(seen).toEqual([{ x: 1 }]);
    const [row] = await listRecentJobs(db, 5);
    expect(row.state).toBe("done");
    await db.close();
  });

  test("a throwing handler marks the job failed/pending via markJobFailed, not silently", async () => {
    const db = await freshDb("handler-throw");
    registerJobHandler("boom", () => { throw new Error("kaboom"); });
    await enqueue(db, "boom", {}, { maxAttempts: 5 });
    const job = (await claimNext(db)) as Job;
    await runClaimedJob(db, job);
    const [row] = await listRecentJobs(db, 5);
    expect(row.state).toBe("pending");
    expect(row.last_error).toContain("kaboom");
    await db.close();
  });

  test("an unregistered job name fails instead of vanishing", async () => {
    const db = await freshDb("handler-missing");
    await enqueue(db, "no-such-handler", {}, { maxAttempts: 1 });
    const job = (await claimNext(db)) as Job;
    await runClaimedJob(db, job);
    const [row] = await listRecentJobs(db, 5);
    expect(row.state).toBe("failed");
    expect(row.last_error).toMatch(/no handler registered/);
    await db.close();
  });
});

describe("pure: selectPruneVictims", () => {
  test("keeps only the most recent `keep` names, deletes the rest", () => {
    const names = ["2026-01-01T00-00-00", "2026-01-02T00-00-00", "2026-01-03T00-00-00", "2026-01-04T00-00-00"];
    expect(selectPruneVictims(names, 2)).toEqual(["2026-01-01T00-00-00", "2026-01-02T00-00-00"]);
  });

  test("no victims when count <= keep", () => {
    expect(selectPruneVictims(["a", "b"], 7)).toEqual([]);
  });

  test("order of input does not matter — sorted lexically first", () => {
    const shuffled = ["c", "a", "b"];
    expect(selectPruneVictims(shuffled, 1)).toEqual(["a", "b"]);
  });
});

describe("pruneBackups (IO on a temp dir)", () => {
  function tmpBackupsDir(tag: string): string {
    const dir = path.join(os.tmpdir(), `ollamas-jobs-backups-${process.pid}-${tag}-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  test("prunes down to the last 7 of 9 timestamped subdirectories", () => {
    const dir = tmpBackupsDir("prune9");
    const names = Array.from({ length: 9 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}T00-00-00-000Z`);
    for (const n of names) fs.mkdirSync(path.join(dir, n));
    const removed = pruneBackupsSync(dir, 7);
    return removed.then((victims) => {
      expect(victims).toHaveLength(2);
      const remaining = fs.readdirSync(dir).sort();
      expect(remaining).toHaveLength(7);
      expect(remaining).toEqual(names.slice(2));
      fs.rmSync(dir, { recursive: true, force: true });
    });
  });

  test("missing directory prunes to empty array without throwing", async () => {
    const victims = await pruneBackups(path.join(os.tmpdir(), "does-not-exist-jobs-backups"));
    expect(victims).toEqual([]);
  });

  // small helper so the async prune call reads the same as the sync setup above
  function pruneBackupsSync(dir: string, keep: number) {
    return pruneBackups(dir, keep);
  }
});

describe("backupDb", () => {
  test("copies the sqlite db file into var/backups/<ts>/ and prunes to keep", async () => {
    const db = await freshDb("backup-copy");
    await enqueue(db, "noop", {}); // force a write so the file exists on disk
    const dbPath = process.env.SAAS_DB_PATH!;
    const backupsDir = path.join(os.tmpdir(), `ollamas-jobs-backupdb-${process.pid}-${Date.now()}`);
    const result = await backupDb({ dbPath, backupsDir, keep: 7 });
    expect(result.files.length).toBeGreaterThan(0);
    expect(fs.existsSync(result.files[0])).toBe(true);
    expect(fs.existsSync(result.dir)).toBe(true);
    fs.rmSync(backupsDir, { recursive: true, force: true });
    await db.close();
  });

  test("a second+ backup beyond `keep` prunes the oldest", async () => {
    const db = await freshDb("backup-prune");
    await enqueue(db, "noop", {});
    const dbPath = process.env.SAAS_DB_PATH!;
    const backupsDir = path.join(os.tmpdir(), `ollamas-jobs-backupdb-prune-${process.pid}-${Date.now()}`);
    for (let i = 0; i < 9; i++) {
      await backupDb({ dbPath, backupsDir, keep: 7 });
      await new Promise((r) => setTimeout(r, 2)); // ensure distinct ISO timestamps
    }
    const remaining = fs.readdirSync(backupsDir);
    expect(remaining.length).toBeLessThanOrEqual(7);
    fs.rmSync(backupsDir, { recursive: true, force: true });
    await db.close();
  });
});

describe("startJobs / stopJobs loop", () => {
  test("startJobs is idempotent and stopJobs is safe to call before/after start", async () => {
    delete process.env.DATABASE_URL;
    process.env.SAAS_DB_PATH = path.join(os.tmpdir(), `ollamas-jobs-loop-${process.pid}-${Date.now()}.db`);
    process.env.JOBS_BOOT_DELAY_MS = "10";
    process.env.JOBS_POLL_INTERVAL_MS = "10000";
    await expect(stopJobs()).resolves.toBeUndefined(); // stop before start: no-op
    startJobs();
    startJobs(); // second call: idempotent guard, must not throw or double-init
    await vi.waitFor(() => expect(getJobsSnapshot().updatedAt).toBeGreaterThan(0), { timeout: 3000 });
    const snap = getJobsSnapshot();
    expect(snap.counts).toEqual({ pending: 0, running: 0, done: 0, failed: 0 });
    await stopJobs();
    // after stop, snapshot resets to the cheap empty shape
    expect(getJobsSnapshot().running).toBe(false);
    try { fs.unlinkSync(process.env.SAAS_DB_PATH); } catch {}
  }, 10_000);
});
