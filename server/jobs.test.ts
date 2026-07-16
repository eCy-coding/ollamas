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
  pollTick,
  startJobs,
  stopJobs,
  getJobsSnapshot,
  registerRecurring,
  _resetRecurringForTest,
  type Job,
} from "./jobs";
import { register as metricsRegister, jobsRunsTotal, jobsDurationMs } from "./metrics";

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

afterEach(() => { _resetHandlersForTest(); _resetRecurringForTest(); });
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

describe("claim loop skips unregistered handlers — boot ordering race (C2r)", () => {
  test("claimNext(client, now, []) — nothing registered yet — claims nothing; pending row untouched", async () => {
    const db = await freshDb("claim-skip-empty-registry");
    await enqueue(db, "oauth-gc", {});
    const job = await claimNext(db, Date.now(), []);
    expect(job).toBeNull();
    const [row] = await listRecentJobs(db, 5);
    expect(row.state).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBeNull();
    await db.close();
  });

  test("claimNext(client, now, registeredNames) skips a pending job whose name isn't in the list, claims one that is", async () => {
    const db = await freshDb("claim-skip-selective");
    await enqueue(db, "oauth-gc", {}, { runAt: new Date(Date.now() - 5_000) });
    await enqueue(db, "db-backup", {}, { runAt: new Date(Date.now() - 1_000) });
    const job = await claimNext(db, Date.now(), ["db-backup"]);
    expect(job).not.toBeNull();
    expect(job!.name).toBe("db-backup");
    const rows = await listRecentJobs(db, 5);
    const oauthRow = rows.find((r) => r.name === "oauth-gc")!;
    expect(oauthRow.state).toBe("pending");
    expect(oauthRow.attempts).toBe(0);
    expect(oauthRow.last_error).toBeNull();
    await db.close();
  });

  test("pollTick never claims/fails a pending job whose handler isn't registered yet; " +
    "once registered, the next tick runs it to done (reproduces the oauth-gc boot race)", async () => {
    const db = await freshDb("polltick-late-handler");
    await enqueue(db, "late-handler", { x: 1 });

    // Tick #1: handler not registered yet — must stay pending, untouched.
    await pollTick(db);
    let [row] = await listRecentJobs(db, 5);
    expect(row.state).toBe("pending");
    expect(row.attempts).toBe(0);
    expect(row.last_error).toBeNull();

    // Register the handler (mirrors server/oauth-gc.ts's side-effect import landing).
    const seen: any[] = [];
    registerJobHandler("late-handler", (payload) => { seen.push(payload); });

    // Tick #2: now runs to completion.
    await pollTick(db);
    [row] = await listRecentJobs(db, 5);
    expect(row.state).toBe("done");
    expect(row.attempts).toBe(0);
    expect(seen).toEqual([{ x: 1 }]);
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

describe("registerRecurring (C2 — sub-minute in-memory loops, no durable row per tick)", () => {
  afterEach(async () => { await stopJobs(); });

  test("a registered recurring loop runs on its own timer once started, independent of the durable DbClient", async () => {
    delete process.env.DATABASE_URL;
    process.env.SAAS_DB_PATH = path.join(os.tmpdir(), `ollamas-recurring-runs-${process.pid}-${Date.now()}.db`);
    process.env.JOBS_BOOT_DELAY_MS = "50000"; // keep the durable poll loop from touching anything here
    let calls = 0;
    registerRecurring("test-recurring-runs", 10, () => { calls++; });
    startJobs();
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    const entry = getJobsSnapshot().recurring.find((r) => r.name === "test-recurring-runs");
    expect(entry).toBeDefined();
    expect(entry!.everyMs).toBe(10);
    expect(entry!.runs).toBeGreaterThanOrEqual(2);
    expect(entry!.errors).toBe(0);
    expect(entry!.running).toBe(true);
    expect(entry!.lastRunAt).not.toBeNull();
    expect(typeof entry!.lastDurationMs).toBe("number");
    try { fs.unlinkSync(process.env.SAAS_DB_PATH); } catch {}
  }, 10_000);

  test("onStart fires once, before the first interval tick", async () => {
    delete process.env.DATABASE_URL;
    process.env.SAAS_DB_PATH = path.join(os.tmpdir(), `ollamas-recurring-onstart-${process.pid}-${Date.now()}.db`);
    process.env.JOBS_BOOT_DELAY_MS = "50000";
    let onStartCalls = 0;
    let tickCalls = 0;
    registerRecurring("test-recurring-onstart", 100_000, () => { tickCalls++; }, { onStart: () => { onStartCalls++; } });
    startJobs();
    await vi.waitFor(() => expect(onStartCalls).toBe(1), { timeout: 2000 });
    expect(tickCalls).toBe(0); // interval (100s) hasn't fired yet — only onStart ran
    try { fs.unlinkSync(process.env.SAAS_DB_PATH); } catch {}
  }, 10_000);

  test("error isolation — a throwing tick increments errors but keeps the loop running for the next tick", async () => {
    delete process.env.DATABASE_URL;
    process.env.SAAS_DB_PATH = path.join(os.tmpdir(), `ollamas-recurring-errors-${process.pid}-${Date.now()}.db`);
    process.env.JOBS_BOOT_DELAY_MS = "50000";
    let calls = 0;
    registerRecurring("test-recurring-errors", 10, () => { calls++; throw new Error("boom"); });
    startJobs();
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(2), { timeout: 2000 });
    const entry = getJobsSnapshot().recurring.find((r) => r.name === "test-recurring-errors");
    expect(entry!.errors).toBeGreaterThanOrEqual(2);
    expect(entry!.runs).toBe(0); // a throwing tick counts as an error, not a run
    expect(entry!.lastError).toContain("boom");
    try { fs.unlinkSync(process.env.SAAS_DB_PATH); } catch {}
  }, 10_000);

  test("snapshot fields are present even before startJobs() runs (registered but not yet started)", () => {
    registerRecurring("test-recurring-unstarted", 5000, () => {});
    const entry = getJobsSnapshot().recurring.find((r) => r.name === "test-recurring-unstarted");
    expect(entry).toEqual({
      name: "test-recurring-unstarted", everyMs: 5000, runs: 0, errors: 0,
      lastRunAt: null, lastDurationMs: null, lastError: null, running: false,
    });
  });

  test("stopJobs() halts further ticks", async () => {
    delete process.env.DATABASE_URL;
    process.env.SAAS_DB_PATH = path.join(os.tmpdir(), `ollamas-recurring-stop-${process.pid}-${Date.now()}.db`);
    process.env.JOBS_BOOT_DELAY_MS = "50000";
    let calls = 0;
    registerRecurring("test-recurring-stop", 10, () => { calls++; });
    startJobs();
    await vi.waitFor(() => expect(calls).toBeGreaterThanOrEqual(1), { timeout: 2000 });
    await stopJobs();
    const afterStop = calls;
    expect(getJobsSnapshot().recurring.find((r) => r.name === "test-recurring-stop")?.running).toBe(false);
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toBe(afterStop); // no further ticks after stop
    try { fs.unlinkSync(process.env.SAAS_DB_PATH); } catch {}
  }, 10_000);
});

describe("metrics (C2) — jobs runs/duration exported via server/metrics.ts", () => {
  test("runClaimedJob (durable path) records a 'done' outcome", async () => {
    const db = await freshDb("metrics-done");
    registerJobHandler("metrics-echo", () => {});
    await enqueue(db, "metrics-echo", {});
    const job = (await claimNext(db)) as Job;
    const before = (await metricsRegister.getSingleMetric("ollamas_jobs_runs_total")!.get()).values
      .filter((v) => v.labels.name === "metrics-echo" && v.labels.outcome === "done")
      .reduce((n, v) => n + v.value, 0);
    await runClaimedJob(db, job);
    const after = (await metricsRegister.getSingleMetric("ollamas_jobs_runs_total")!.get()).values
      .filter((v) => v.labels.name === "metrics-echo" && v.labels.outcome === "done")
      .reduce((n, v) => n + v.value, 0);
    expect(after).toBe(before + 1);
    const durationSample = (await metricsRegister.getSingleMetric("ollamas_jobs_duration_ms")!.get()).values
      .find((v) => v.labels.name === "metrics-echo" && v.labels.outcome === "done" && (v as any).metricName?.endsWith("_count"));
    expect(durationSample).toBeDefined();
    await db.close();
  });

  test("runClaimedJob (durable path) records a 'failed' outcome for a throwing handler", async () => {
    const db = await freshDb("metrics-failed");
    registerJobHandler("metrics-boom", () => { throw new Error("boom"); });
    await enqueue(db, "metrics-boom", {}, { maxAttempts: 5 });
    const job = (await claimNext(db)) as Job;
    await runClaimedJob(db, job);
    const failedCount = (await metricsRegister.getSingleMetric("ollamas_jobs_runs_total")!.get()).values
      .find((v) => v.labels.name === "metrics-boom" && v.labels.outcome === "failed");
    expect(failedCount?.value).toBeGreaterThanOrEqual(1);
    await db.close();
  });

  test("registerRecurring ticks are also recorded under the same metric names", async () => {
    delete process.env.DATABASE_URL;
    process.env.SAAS_DB_PATH = path.join(os.tmpdir(), `ollamas-recurring-metrics-${process.pid}-${Date.now()}.db`);
    process.env.JOBS_BOOT_DELAY_MS = "50000";
    registerRecurring("metrics-recurring", 10, () => {});
    startJobs();
    await vi.waitFor(async () => {
      const values = (await metricsRegister.getSingleMetric("ollamas_jobs_runs_total")!.get()).values;
      const sample = values.find((v) => v.labels.name === "metrics-recurring" && v.labels.outcome === "done");
      expect(sample?.value).toBeGreaterThanOrEqual(1);
    }, { timeout: 2000 });
    await stopJobs();
    try { fs.unlinkSync(process.env.SAAS_DB_PATH); } catch {}
  }, 10_000);
});
