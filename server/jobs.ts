// server/jobs.ts — durable sqlite/pg job queue + croner scheduler (B1).
//
// Architecture mirrors server/key-health.ts: pure exported functions (schema-free
// business logic, fully unit-testable against a real DbClient or plain arrays) +
// a thin IO loop at the bottom (startJobs/stopJobs/getJobsSnapshot, timer.unref()).
//
// Storage: server/store/db-adapter.ts's createAdapter() (sqlite by default, pg when
// DATABASE_URL is set) — this module owns its OWN DbClient (same pattern as
// server/rag.ts / server/store/vector.ts, each with a dedicated connection onto the
// same on-disk file; sqlite's WAL mode makes that safe).
//
// Claim semantics mirror server/store/index.ts's claimDeliveries(): pg uses
// FOR UPDATE SKIP LOCKED + RETURNING; sqlite (single-writer) uses a two-step
// select-then-conditional-update so a crashed claim never silently vanishes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Cron } from "croner";
import { createAdapter, type DbClient } from "./store/db-adapter";
import { jobsRunsTotal, jobsDurationMs } from "./metrics";

export type JobState = "pending" | "running" | "done" | "failed";

export interface Job {
  id: string;
  name: string;
  payload: any;
  state: JobState;
  attempts: number;
  max_attempts: number;
  run_at: string;
  updated_at: string;
  last_error: string | null;
}

const nowIso = () => new Date().toISOString();

/** Pure: map a raw DB row (payload still a JSON string) into a typed Job. */
export function rowToJob(row: any): Job {
  let payload: any = {};
  try { payload = row.payload ? JSON.parse(row.payload) : {}; } catch { payload = {}; }
  return {
    id: row.id,
    name: row.name,
    payload,
    state: row.state,
    attempts: Number(row.attempts),
    max_attempts: Number(row.max_attempts),
    run_at: row.run_at,
    updated_at: row.updated_at,
    last_error: row.last_error ?? null,
  };
}

/** Pure: circuit-breaker-style exponential backoff — mirrors key-health.ts's
 *  nextBackoffMs so both loops back off identically on repeated failure. */
export function nextBackoffMs(consecutiveFailures: number, baseMs: number, maxMs: number): number {
  if (consecutiveFailures <= 0) return baseMs;
  const grown = baseMs * 2 ** Math.min(consecutiveFailures, 6);
  return Math.min(grown, maxMs);
}

export interface RetryDecision { state: "pending" | "failed"; runAt: string; attempts: number; }

/** Pure: decide the next state for a failed job — retry with backoff, or give up
 *  once max_attempts is reached. */
export function computeRetry(
  currentAttempts: number,
  maxAttempts: number,
  baseBackoffMs: number,
  maxBackoffMs: number,
  nowMs = Date.now(),
): RetryDecision {
  const attempts = currentAttempts + 1;
  if (attempts >= maxAttempts) return { state: "failed", runAt: new Date(nowMs).toISOString(), attempts };
  const delay = nextBackoffMs(attempts, baseBackoffMs, maxBackoffMs);
  return { state: "pending", runAt: new Date(nowMs + delay).toISOString(), attempts };
}

/** Pure: given a list of backup directory names (ISO-timestamp-derived, so they
 *  sort chronologically as plain strings), return the ones to delete to keep
 *  only the most recent `keep`. */
export function selectPruneVictims(names: string[], keep: number): string[] {
  const sorted = [...names].sort();
  if (sorted.length <= keep) return [];
  return sorted.slice(0, sorted.length - keep);
}

// ── Schema ───────────────────────────────────────────────────────────────────
export async function initJobsSchema(client: DbClient): Promise<void> {
  await client.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      state TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      max_attempts INTEGER NOT NULL DEFAULT 5,
      run_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs(state, run_at);
  `);
}

// ── Enqueue / claim / complete ──────────────────────────────────────────────
export interface EnqueueOptions { runAt?: Date | string; maxAttempts?: number; }

export async function enqueue(client: DbClient, name: string, payload: unknown = {}, opts: EnqueueOptions = {}): Promise<string> {
  const id = `job_${crypto.randomBytes(8).toString("hex")}`;
  const runAt = opts.runAt ? new Date(opts.runAt).toISOString() : nowIso();
  await client.run(
    "INSERT INTO jobs (id, name, payload, state, attempts, max_attempts, run_at, updated_at) VALUES (?,?,?,?,?,?,?,?)",
    [id, name, JSON.stringify(payload ?? {}), "pending", 0, opts.maxAttempts ?? 5, runAt, nowIso()],
  );
  return id;
}

/** Atomically claim the single most-due pending job (pending → running) so two
 *  workers never double-run it. pg: FOR UPDATE SKIP LOCKED. sqlite: single-writer
 *  select-then-conditional-update (mirrors claimDeliveries in server/store/index.ts).
 *
 *  `registeredNames`, when passed, restricts the candidate pool to job names that
 *  currently have a registered handler (C2r — jobs claim loop skips unregistered
 *  handlers). This makes the loop ordering-proof: a pending row whose handler
 *  hasn't registered yet (e.g. a side-effect import still resolving, or a genuine
 *  typo) is left untouched — no attempt burn, no last_error, no transient
 *  pending→running→pending flap — instead of being claimed and immediately failed
 *  by runClaimedJob's "no handler registered" path. Omit the param (undefined) to
 *  keep the old unrestricted-claim behavior (existing callers/tests). An explicit
 *  empty array means "nothing registered yet" — skip claiming entirely without a
 *  DB round-trip. */
export async function claimNext(client: DbClient, nowMs = Date.now(), registeredNames?: string[]): Promise<Job | null> {
  const now = new Date(nowMs).toISOString();
  if (registeredNames && registeredNames.length === 0) return null;
  if (client.dialect === "pg") {
    if (registeredNames) {
      const sql = `UPDATE jobs SET state='running', updated_at=$1
        WHERE id = (SELECT id FROM jobs WHERE state='pending' AND run_at <= $2 AND name = ANY($3) ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1)
        RETURNING *`;
      const r = await client.query(sql, [now, now, registeredNames]);
      return r.rows[0] ? rowToJob(r.rows[0]) : null;
    }
    const sql = `UPDATE jobs SET state='running', updated_at=$1
      WHERE id = (SELECT id FROM jobs WHERE state='pending' AND run_at <= $2 ORDER BY run_at FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING *`;
    const r = await client.query(sql, [now, now]);
    return r.rows[0] ? rowToJob(r.rows[0]) : null;
  }
  const selectSql = registeredNames
    ? `SELECT id FROM jobs WHERE state='pending' AND run_at <= ? AND name IN (${registeredNames.map(() => "?").join(",")}) ORDER BY run_at LIMIT 1`
    : "SELECT id FROM jobs WHERE state='pending' AND run_at <= ? ORDER BY run_at LIMIT 1";
  const selectParams = registeredNames ? [now, ...registeredNames] : [now];
  const row = (await client.query(selectSql, selectParams)).rows[0];
  if (!row) return null;
  const upd = await client.run("UPDATE jobs SET state='running', updated_at=? WHERE id=? AND state='pending'", [now, row.id]);
  if (upd.changes === 0) return null; // raced with another claimant
  const full = (await client.query("SELECT * FROM jobs WHERE id=?", [row.id])).rows[0];
  return full ? rowToJob(full) : null;
}

export async function markJobDone(client: DbClient, id: string): Promise<void> {
  await client.run("UPDATE jobs SET state='done', updated_at=? WHERE id=?", [nowIso(), id]);
}

export async function markJobFailed(
  client: DbClient,
  job: Pick<Job, "id" | "attempts" | "max_attempts">,
  err: string,
  baseBackoffMs = 30_000,
  maxBackoffMs = 3_600_000,
): Promise<RetryDecision> {
  const decision = computeRetry(job.attempts, job.max_attempts, baseBackoffMs, maxBackoffMs);
  await client.run(
    "UPDATE jobs SET state=?, attempts=?, run_at=?, updated_at=?, last_error=? WHERE id=?",
    [decision.state, decision.attempts, decision.runAt, nowIso(), String(err).slice(0, 500), job.id],
  );
  return decision;
}

export async function listRecentJobs(client: DbClient, limit = 20): Promise<Job[]> {
  const rows = (await client.query("SELECT * FROM jobs ORDER BY updated_at DESC LIMIT ?", [limit])).rows;
  return rows.map(rowToJob);
}

export async function countsByState(client: DbClient): Promise<Record<JobState, number>> {
  const rows = (await client.query("SELECT state, COUNT(*) AS n FROM jobs GROUP BY state")).rows;
  const out: Record<JobState, number> = { pending: 0, running: 0, done: 0, failed: 0 };
  for (const r of rows) out[r.state as JobState] = Number(r.n);
  return out;
}

// ── Handler registry ─────────────────────────────────────────────────────────
export type JobHandler = (payload: any) => Promise<void> | void;
const handlers = new Map<string, JobHandler>();

export function registerJobHandler(name: string, fn: JobHandler): void {
  handlers.set(name, fn);
}

/** Test-only: clear the registry between test files that register fakes. */
export function _resetHandlersForTest(): void {
  handlers.clear();
  warnedUnregisteredNames.clear();
}

/** Run a single already-claimed job through its registered handler, then mark
 *  done/failed. An unregistered job name fails (and retries) rather than being
 *  silently dropped. */
export async function runClaimedJob(
  client: DbClient,
  job: Job,
  backoffOpts: { baseBackoffMs?: number; maxBackoffMs?: number } = {},
): Promise<void> {
  const t0 = Date.now();
  const record = (outcome: "done" | "failed") => {
    jobsRunsTotal.labels(job.name, outcome).inc();
    jobsDurationMs.labels(job.name, outcome).observe(Date.now() - t0);
  };
  const handler = handlers.get(job.name);
  if (!handler) {
    await markJobFailed(client, job, `no handler registered for "${job.name}"`, backoffOpts.baseBackoffMs, backoffOpts.maxBackoffMs);
    record("failed");
    return;
  }
  try {
    await handler(job.payload);
    await markJobDone(client, job.id);
    record("done");
  } catch (e: any) {
    await markJobFailed(client, job, String(e?.message ?? e), backoffOpts.baseBackoffMs, backoffOpts.maxBackoffMs);
    record("failed");
  }
}

// ── Recurring in-memory loops (C2) ──────────────────────────────────────────────
// Sub-minute recurrence (webhook retry @30s, formerly server/webhooks/outbound.ts's
// own setInterval) must NOT enqueue a durable jobs-table row per tick — that's sqlite
// churn for no benefit (nothing about a 15s/30s tick needs to survive a restart; the
// underlying work it drives, e.g. webhook_deliveries, is already itself durable).
// registerRecurring centralizes these loops into jobs.ts (one module owns every
// periodic timer + its graceful shutdown) while keeping them off the durable queue —
// each entry gets its own real `setInterval` (same fire-on-schedule semantics the
// original per-module timers had: ticks are NOT awaited/serialized against each
// other, matching setInterval's normal fire-regardless-of-previous-tick behavior),
// started/stopped centrally by startJobs()/stopJobs(), with run/error/last-run
// bookkeeping surfaced via getJobsSnapshot() and the same jobsRunsTotal /
// jobsDurationMs metrics as durable jobs.
export interface RecurringOptions {
  /** Runs once, fire-and-forget, when the loop starts (mirrors e.g. the webhook
   *  worker's boot-time reclaimStranded() call, which runs once at start, separate
   *  from — and before — the first interval tick). Errors are swallowed. */
  onStart?: () => Promise<void> | void;
}

export interface RecurringSnapshotEntry {
  name: string;
  everyMs: number;
  runs: number;
  errors: number;
  lastRunAt: number | null;
  lastDurationMs: number | null;
  lastError: string | null;
  running: boolean;
}

interface RecurringEntry extends RecurringSnapshotEntry {
  handler: () => Promise<void> | void;
  onStart?: () => Promise<void> | void;
  timer: ReturnType<typeof setInterval> | null;
}

const recurringJobs = new Map<string, RecurringEntry>();

/** Register a sub-minute in-memory recurring loop. Registration is idempotent-safe
 *  to call at module load time (mirrors registerJobHandler); the timer itself is
 *  only created once startJobs() runs (and torn down by stopJobs()). Calling this
 *  twice for the same name replaces the handler but preserves run/error counters. */
export function registerRecurring(name: string, everyMs: number, handler: () => Promise<void> | void, opts: RecurringOptions = {}): void {
  const existing = recurringJobs.get(name);
  if (existing) {
    existing.everyMs = everyMs;
    existing.handler = handler;
    existing.onStart = opts.onStart;
    return;
  }
  recurringJobs.set(name, {
    name, everyMs, handler, onStart: opts.onStart, timer: null,
    runs: 0, errors: 0, lastRunAt: null, lastDurationMs: null, lastError: null, running: false,
  });
}

/** Test-only: clear registered recurring loops between test files. */
export function _resetRecurringForTest(): void {
  for (const entry of recurringJobs.values()) if (entry.timer) clearInterval(entry.timer);
  recurringJobs.clear();
}

async function runRecurringTick(entry: RecurringEntry): Promise<void> {
  const t0 = Date.now();
  try {
    await entry.handler();
    entry.runs++;
    entry.lastError = null;
    jobsRunsTotal.labels(entry.name, "done").inc();
  } catch (e: any) {
    entry.errors++;
    entry.lastError = String(e?.message ?? e).slice(0, 500);
    jobsRunsTotal.labels(entry.name, "failed").inc();
    console.warn(`[Jobs] recurring "${entry.name}" tick failed: ${entry.lastError.slice(0, 120)}`);
  } finally {
    entry.lastDurationMs = Date.now() - t0;
    entry.lastRunAt = Date.now();
    jobsDurationMs.labels(entry.name, entry.lastError ? "failed" : "done").observe(entry.lastDurationMs);
  }
}

/** Start every registered recurring loop's timer (idempotent per-entry). Called by
 *  startJobs(); has no dependency on jobs.ts's own DbClient — recurring handlers
 *  (e.g. webhook retry) own their own IO, exactly as before this migration. */
function startRecurringLoops(): void {
  for (const entry of recurringJobs.values()) {
    if (entry.timer) continue; // already running
    if (entry.onStart) Promise.resolve(entry.onStart()).catch(() => {});
    entry.timer = setInterval(() => { void runRecurringTick(entry); }, entry.everyMs);
    entry.timer.unref?.();
    entry.running = true;
  }
}

/** Stop every recurring loop's timer (graceful shutdown). Does not await an
 *  in-flight tick — matches the original per-module stop*() functions, which only
 *  ever cleared the interval. */
function stopRecurringLoops(): void {
  for (const entry of recurringJobs.values()) {
    if (entry.timer) { clearInterval(entry.timer); entry.timer = null; }
    entry.running = false;
  }
}

function getRecurringSnapshot(): RecurringSnapshotEntry[] {
  return Array.from(recurringJobs.values()).map(({ name, everyMs, runs, errors, lastRunAt, lastDurationMs, lastError, running }) => (
    { name, everyMs, runs, errors, lastRunAt, lastDurationMs, lastError, running }
  ));
}

// ── db-backup job: copy the sqlite db file(s) to var/backups/<ts>/, prune to 7 ──
export async function pruneBackups(backupsDir: string, keep = 7): Promise<string[]> {
  let entries: string[];
  try {
    entries = fs.readdirSync(backupsDir).filter((n) => {
      try { return fs.statSync(path.join(backupsDir, n)).isDirectory(); } catch { return false; }
    });
  } catch {
    return []; // dir doesn't exist yet — nothing to prune
  }
  const victims = selectPruneVictims(entries, keep);
  for (const v of victims) fs.rmSync(path.join(backupsDir, v), { recursive: true, force: true });
  return victims;
}

export interface BackupOptions { dbPath?: string; backupsDir?: string; keep?: number; }
export interface BackupResult { dir: string; files: string[]; pruned: string[]; }

/** IO: copy the live sqlite db (+ -wal/-shm if present) into a fresh timestamped
 *  directory under var/backups/, then prune to the last `keep` (default 7).
 *  No-op (empty files[]) on Postgres — file-copy backup only applies to sqlite. */
export async function backupDb(opts: BackupOptions = {}): Promise<BackupResult> {
  const dataDir = process.env.MISSION_CONTROL_DATA_DIR || path.join(os.homedir(), ".llm-mission-control");
  const dbPath = opts.dbPath ?? process.env.SAAS_DB_PATH ?? path.join(dataDir, "saas.db");
  const backupsDir = opts.backupsDir ?? path.join(process.cwd(), "var", "backups");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dest = path.join(backupsDir, ts);
  const files: string[] = [];
  if (fs.existsSync(dbPath)) {
    fs.mkdirSync(dest, { recursive: true });
    for (const suffix of ["", "-wal", "-shm"]) {
      const src = `${dbPath}${suffix}`;
      if (fs.existsSync(src)) {
        const destFile = path.join(dest, path.basename(src));
        fs.copyFileSync(src, destFile);
        files.push(destFile);
      }
    }
  }
  const pruned = await pruneBackups(backupsDir, opts.keep ?? 7);
  return { dir: dest, files, pruned };
}

registerJobHandler("db-backup", async () => { await backupDb(); });

// ── IO: the always-running poll-claim-execute loop + croner schedules ──────────
export interface JobsSnapshot {
  counts: Record<JobState, number>;
  recent: Job[];
  updatedAt: number;
  running: boolean;
  recurring: RecurringSnapshotEntry[];
}

let client: DbClient | null = null;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let cronTask: InstanceType<typeof Cron> | null = null;
let oauthGcCronTask: InstanceType<typeof Cron> | null = null;
let snapshot: JobsSnapshot | null = null;
let inFlight: Promise<void> | null = null;
let stopping = false;
let consecutiveFailures = 0;

async function refreshSnapshot(c: DbClient): Promise<void> {
  const [counts, recent] = await Promise.all([countsByState(c), listRecentJobs(c, 20)]);
  snapshot = { counts, recent, updatedAt: Date.now(), running: !stopping, recurring: getRecurringSnapshot() };
}

/** Names we've already warned about having pending rows but no registered handler
 *  (C2r) — logged once per name, not once per poll tick, to avoid log spam while a
 *  handler module is still loading or a job name is simply mistyped. */
const warnedUnregisteredNames = new Set<string>();

/** Best-effort, cheap-on-average diagnostic: once claimNext (scoped to registered
 *  names) finds nothing to run, check whether that's because there ARE pending
 *  rows sitting behind an unregistered handler name, and warn once per name so a
 *  genuine typo/missing-registration doesn't fail silently forever. Never throws —
 *  a warning is not worth risking the poll loop over. */
async function warnUnregisteredPendingOnce(c: DbClient, registeredNames: string[]): Promise<void> {
  try {
    const rows = (await c.query("SELECT DISTINCT name FROM jobs WHERE state='pending'", [])).rows;
    for (const r of rows) {
      const name = r.name as string;
      if (registeredNames.includes(name) || warnedUnregisteredNames.has(name)) continue;
      warnedUnregisteredNames.add(name);
      console.warn(`[Jobs] pending job(s) named "${name}" have no registered handler yet — left pending, not failed (C2r)`);
    }
  } catch { /* diagnostic only, never fail the loop over it */ }
}

/** Exported for tests (C2r): drive one claim-run-refresh cycle of the durable
 *  queue loop directly, without waiting on startJobs()'s real setTimeout schedule. */
export async function pollTick(c: DbClient): Promise<void> {
  const registeredNames = Array.from(handlers.keys());
  const job = await claimNext(c, Date.now(), registeredNames);
  if (job) {
    inFlight = runClaimedJob(c, job).finally(() => { inFlight = null; });
    await inFlight;
  } else {
    void warnUnregisteredPendingOnce(c, registeredNames);
  }
  await refreshSnapshot(c);
}

/** Start the always-running job queue loop. Idempotent. Reschedules with
 *  circuit-breaker backoff on failure; the timer is unref'd so it never keeps
 *  the process alive. Mirrors key-health.ts's startKeyHealth() shape. */
export function startJobs(): void {
  if (client || pollTimer) return;
  stopping = false;
  // Sub-minute in-memory loops (e.g. webhook retry) have no dependency on jobs.ts's
  // own DbClient — start them synchronously, exactly as their previous standalone
  // startXWorker() functions did, so a slow/failing durable-queue DB init below
  // never delays them.
  startRecurringLoops();
  const pollMs = Number(process.env.JOBS_POLL_INTERVAL_MS || 5_000);
  const maxBackoffMs = Number(process.env.JOBS_MAX_BACKOFF_MS || 300_000);
  const bootDelay = Number(process.env.JOBS_BOOT_DELAY_MS || 2_000);
  const schedule = (delay: number) => {
    pollTimer = setTimeout(run, delay);
    if (pollTimer && typeof pollTimer.unref === "function") pollTimer.unref();
  };
  const run = async () => {
    if (stopping || !client) return;
    try {
      await pollTick(client);
      consecutiveFailures = 0;
      if (!stopping) schedule(pollMs);
    } catch (e: any) {
      consecutiveFailures++;
      if (snapshot) snapshot = { ...snapshot, running: !stopping };
      if (!stopping) schedule(nextBackoffMs(consecutiveFailures, pollMs, maxBackoffMs));
      console.warn(`[Jobs] tick failed: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  };
  void (async () => {
    try {
      const c = await createAdapter();
      await initJobsSchema(c);
      if (stopping) { await c.close().catch(() => {}); return; } // stopped before init finished
      client = c;
      await refreshSnapshot(c);
      cronTask = new Cron(process.env.JOBS_BACKUP_CRON || "0 3 * * *", { unref: true }, () => {
        if (client) void enqueue(client, "db-backup", {}).catch(() => {});
      });
      // OAuth retention sweeper (Faz 26, migrated from server/oauth-gc.ts's own
      // setInterval in C2): low-frequency (hourly by default) — a durable row per
      // run is cheap, unlike the sub-minute recurring loops above. Croner-scheduled
      // (OAUTH_GC_CRON, default hourly on the hour) + one immediate durable enqueue
      // right now, mirroring the old startOAuthGc()'s "sweep once at boot, don't
      // wait a full interval". The "oauth-gc" handler itself is registered by
      // server/oauth-gc.ts (imported for its side effect) — never-throws by design,
      // so this durable job always ends up "done", matching the old fire-and-forget
      // `.catch(() => {})` semantics.
      oauthGcCronTask = new Cron(process.env.OAUTH_GC_CRON || "0 * * * *", { unref: true }, () => {
        if (client) void enqueue(client, "oauth-gc", {}).catch(() => {});
      });
      void enqueue(c, "oauth-gc", {}).catch(() => {}); // boot-time immediate sweep enqueue — never let this race a test/shutdown DB close into an unhandled rejection
      schedule(bootDelay);
    } catch (e: any) {
      console.warn(`[Jobs] init failed: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  })();
}

/** Stop the loop (graceful shutdown). Idempotent. Finishes any in-flight job
 *  (awaited) but claims no new one — matches the Faz 13A drain contract used by
 *  stopKeyHealth. Also halts every registerRecurring loop (e.g. webhook-retry) and
 *  the oauth-gc cron — both migrated onto this module in C2. */
export async function stopJobs(): Promise<void> {
  stopping = true;
  stopRecurringLoops();
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
  if (cronTask) { cronTask.stop(); cronTask = null; }
  if (oauthGcCronTask) { oauthGcCronTask.stop(); oauthGcCronTask = null; }
  if (inFlight) await inFlight;
  if (client) { await client.close().catch(() => {}); client = null; }
  snapshot = null;
}

/** Cached snapshot for GET /api/jobs (never null — a cheap empty shape before
 *  the first tick populates it, mirroring key-health's liveCheapSnapshot). Always
 *  includes the LIVE recurring-loop snapshot (not cached) since those loops run
 *  independently of the durable-queue poll tick that populates the rest. */
export function getJobsSnapshot(): JobsSnapshot {
  const base = snapshot ?? { counts: { pending: 0, running: 0, done: 0, failed: 0 } as Record<JobState, number>, recent: [], updatedAt: Date.now(), running: false, recurring: [] };
  return { ...base, recurring: getRecurringSnapshot() };
}
