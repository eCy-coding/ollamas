// Brain backup (P4) — daily snapshot of brain.db with restore-verification, so the
// operator's memory survives disk loss / a bad migration. Design:
//   1. best-effort WAL checkpoint (TRUNCATE → busy fallback is fine: the -wal file
//      is copied alongside, and SQLite recovers it on open)
//   2. copy brain.db (+ -wal if present) into ~/.llm-mission-control/backups/
//   3. VERIFY: open the copy, compare memory+fact row counts to the source —
//      an unreadable backup is worse than none, so mismatch throws
//   4. retention: keep the newest N (default 7) daily snapshots
// Runs from brain-maintain (BRAIN_BACKUP=0 opts out) or `make brain-backup`.
import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";

export interface BackupResult {
  dest: string;
  bytes: number;
  memories: number;
  facts: number;
  removed: number;
}

const countRows = (dbPath: string) => {
  const db = new DatabaseSync(dbPath);
  try {
    const m = (db.prepare("SELECT COUNT(*) AS n FROM brain_memories").get() as { n: number }).n;
    const f = (db.prepare("SELECT COUNT(*) AS n FROM brain_facts").get() as { n: number }).n;
    return { memories: Number(m), facts: Number(f) };
  } finally {
    db.close();
  }
};

export function backupBrain(
  opts: { dbPath?: string; dir?: string; keep?: number; now?: () => number } = {},
): BackupResult {
  const dbPath =
    opts.dbPath || process.env.BRAIN_DB_PATH || `${process.env.HOME}/.llm-mission-control/brain.db`;
  const dir = opts.dir || `${process.env.HOME}/.llm-mission-control/backups`;
  const keep = opts.keep ?? 7;
  const now = opts.now ?? Date.now;

  const db = new DatabaseSync(dbPath);
  try {
    db.exec("PRAGMA busy_timeout=5000");
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } catch { /* live writer holds the WAL — the -wal copy below still makes it whole */ }
  db.close();

  mkdirSync(dir, { recursive: true });
  const stamp = new Date(now()).toISOString().slice(0, 10);
  const dest = path.join(dir, `brain-${stamp}.db`);
  copyFileSync(dbPath, dest);
  if (existsSync(`${dbPath}-wal`)) copyFileSync(`${dbPath}-wal`, `${dest}-wal`);
  else if (existsSync(`${dest}-wal`)) unlinkSync(`${dest}-wal`); // stale wal from an earlier same-day run

  const src = countRows(dbPath);
  const copy = countRows(dest); // opening also replays the copied wal
  if (copy.memories !== src.memories || copy.facts !== src.facts) {
    unlinkSync(dest);
    throw new Error(
      `brain backup verify FAILED: source ${src.memories}m/${src.facts}f vs copy ${copy.memories}m/${copy.facts}f`,
    );
  }

  const snapshots = readdirSync(dir)
    .filter((f) => /^brain-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort(); // ISO dates sort chronologically
  let removed = 0;
  while (snapshots.length > keep) {
    const victim = snapshots.shift()!;
    unlinkSync(path.join(dir, victim));
    if (existsSync(path.join(dir, `${victim}-wal`))) unlinkSync(path.join(dir, `${victim}-wal`));
    removed++;
  }

  return { dest, bytes: statSync(dest).size, memories: copy.memories, facts: copy.facts, removed };
}

if (process.argv[1] && process.argv[1].endsWith("brain-backup.ts")) {
  const r = backupBrain();
  console.log(JSON.stringify({ event: "brain.backup", ...r }));
}
