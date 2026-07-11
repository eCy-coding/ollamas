// O5 notes-tasks module store — the ONLY place this module touches persistence,
// exclusively through the _core/store facade (never server/store directly; the
// eslint import-guard enforces this, server/store/__tests__/module-migrations.test.ts).
// Claims the next free migration versions off the GLOBAL ledger in
// server/modules/registry.ts (v8 notes+tasks, v9 reminders — "cron tables" in the
// ledger comment; this module keeps the reminder side deliberately minimal/graceful:
// a due-at check, not a background scheduler loop — see docs/odyssey/05-features/
// notes-tasks.md K7/K8 for why an in-process tick loop is out of scope here).
import crypto from "node:crypto";
import type { Migration } from "../../store/migrations";
import { getModuleDb } from "../_core/store";
import type { NoteRecord, ReminderRecord, TaskPriority, TaskRecord, TaskStatus } from "./schema";

const NOTES_TABLE = "module_notes_tasks_notes";
const TASKS_TABLE = "module_notes_tasks_tasks";
const REMINDERS_TABLE = "module_notes_tasks_reminders";

export const MIGRATION_V8_NOTES_TASKS: Migration = {
  version: 8,
  name: "notes_tasks_core",
  up: async (db) => {
    await db.exec(`CREATE TABLE IF NOT EXISTS ${NOTES_TABLE} (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      tags TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS ${TASKS_TABLE} (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      detail TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'med',
      due_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_tasks_tasks_status ON ${TASKS_TABLE}(status)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_tasks_tasks_due ON ${TASKS_TABLE}(due_at)`);
  },
  down: async (db) => {
    await db.exec(`DROP INDEX IF EXISTS idx_notes_tasks_tasks_due`);
    await db.exec(`DROP INDEX IF EXISTS idx_notes_tasks_tasks_status`);
    await db.exec(`DROP TABLE IF EXISTS ${TASKS_TABLE}`);
    await db.exec(`DROP TABLE IF EXISTS ${NOTES_TABLE}`);
  },
};

export const MIGRATION_V9_REMINDERS: Migration = {
  version: 9,
  name: "notes_tasks_reminders",
  up: async (db) => {
    await db.exec(`CREATE TABLE IF NOT EXISTS ${REMINDERS_TABLE} (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      remind_at TEXT NOT NULL,
      sent INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_notes_tasks_reminders_due ON ${REMINDERS_TABLE}(sent, remind_at)`);
  },
  down: async (db) => {
    await db.exec(`DROP INDEX IF EXISTS idx_notes_tasks_reminders_due`);
    await db.exec(`DROP TABLE IF EXISTS ${REMINDERS_TABLE}`);
  },
};

function rowToNote(r: Record<string, unknown>): NoteRecord {
  return {
    id: String(r.id),
    title: String(r.title),
    body: String(r.body ?? ""),
    tags: JSON.parse(String(r.tags ?? "[]")) as string[],
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function rowToTask(r: Record<string, unknown>): TaskRecord {
  return {
    id: String(r.id),
    title: String(r.title),
    detail: String(r.detail ?? ""),
    status: r.status as TaskStatus,
    priority: r.priority as TaskPriority,
    due_at: r.due_at === null || r.due_at === undefined ? null : String(r.due_at),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

function rowToReminder(r: Record<string, unknown>): ReminderRecord {
  return {
    id: String(r.id),
    task_id: String(r.task_id),
    remind_at: String(r.remind_at),
    sent: Number(r.sent) === 1,
    created_at: String(r.created_at),
  };
}

// ── Notes ────────────────────────────────────────────────────────────────────

export async function insertNote(input: { title: string; body: string; tags: string[] }): Promise<NoteRecord> {
  const db = await getModuleDb();
  const now = new Date().toISOString();
  const note: NoteRecord = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...input };
  await db.run(
    `INSERT INTO ${NOTES_TABLE} (id, title, body, tags, created_at, updated_at) VALUES (?,?,?,?,?,?)`,
    [note.id, note.title, note.body, JSON.stringify(note.tags), note.created_at, note.updated_at],
  );
  return note;
}

export async function selectNotes(): Promise<NoteRecord[]> {
  const db = await getModuleDb();
  const { rows } = await db.query(
    `SELECT id, title, body, tags, created_at, updated_at FROM ${NOTES_TABLE} ORDER BY updated_at DESC`,
  );
  return rows.map(rowToNote);
}

export async function selectNote(id: string): Promise<NoteRecord | undefined> {
  const db = await getModuleDb();
  const { rows } = await db.query(
    `SELECT id, title, body, tags, created_at, updated_at FROM ${NOTES_TABLE} WHERE id = ?`,
    [id],
  );
  return rows[0] ? rowToNote(rows[0]) : undefined;
}

export async function applyNoteUpdate(
  id: string,
  patch: Partial<{ title: string; body: string; tags: string[] }>,
): Promise<NoteRecord | undefined> {
  const existing = await selectNote(id);
  if (!existing) return undefined;
  const db = await getModuleDb();
  const merged: NoteRecord = { ...existing, ...patch, updated_at: new Date().toISOString() };
  await db.run(`UPDATE ${NOTES_TABLE} SET title = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?`, [
    merged.title,
    merged.body,
    JSON.stringify(merged.tags),
    merged.updated_at,
    id,
  ]);
  return merged;
}

export async function removeNote(id: string): Promise<boolean> {
  const db = await getModuleDb();
  const existing = await selectNote(id);
  if (!existing) return false;
  await db.run(`DELETE FROM ${NOTES_TABLE} WHERE id = ?`, [id]);
  return true;
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export async function insertTask(input: {
  title: string;
  detail: string;
  priority: TaskPriority;
  dueAt: string | null;
}): Promise<TaskRecord> {
  const db = await getModuleDb();
  const now = new Date().toISOString();
  const task: TaskRecord = {
    id: crypto.randomUUID(),
    title: input.title,
    detail: input.detail,
    status: "todo",
    priority: input.priority,
    due_at: input.dueAt,
    created_at: now,
    updated_at: now,
  };
  await db.run(
    `INSERT INTO ${TASKS_TABLE} (id, title, detail, status, priority, due_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?)`,
    [task.id, task.title, task.detail, task.status, task.priority, task.due_at, task.created_at, task.updated_at],
  );
  return task;
}

export async function selectTasks(): Promise<TaskRecord[]> {
  const db = await getModuleDb();
  const { rows } = await db.query(
    `SELECT id, title, detail, status, priority, due_at, created_at, updated_at FROM ${TASKS_TABLE} ORDER BY created_at DESC`,
  );
  return rows.map(rowToTask);
}

export async function selectTask(id: string): Promise<TaskRecord | undefined> {
  const db = await getModuleDb();
  const { rows } = await db.query(
    `SELECT id, title, detail, status, priority, due_at, created_at, updated_at FROM ${TASKS_TABLE} WHERE id = ?`,
    [id],
  );
  return rows[0] ? rowToTask(rows[0]) : undefined;
}

export async function applyTaskUpdate(
  id: string,
  patch: Partial<{ title: string; detail: string; status: TaskStatus; priority: TaskPriority; dueAt: string | null }>,
): Promise<TaskRecord | undefined> {
  const existing = await selectTask(id);
  if (!existing) return undefined;
  const db = await getModuleDb();
  const merged: TaskRecord = {
    ...existing,
    title: patch.title ?? existing.title,
    detail: patch.detail ?? existing.detail,
    status: patch.status ?? existing.status,
    priority: patch.priority ?? existing.priority,
    due_at: patch.dueAt !== undefined ? patch.dueAt : existing.due_at,
    updated_at: new Date().toISOString(),
  };
  await db.run(
    `UPDATE ${TASKS_TABLE} SET title = ?, detail = ?, status = ?, priority = ?, due_at = ?, updated_at = ? WHERE id = ?`,
    [merged.title, merged.detail, merged.status, merged.priority, merged.due_at, merged.updated_at, id],
  );
  return merged;
}

export async function removeTask(id: string): Promise<boolean> {
  const db = await getModuleDb();
  const existing = await selectTask(id);
  if (!existing) return false;
  await db.run(`DELETE FROM ${TASKS_TABLE} WHERE id = ?`, [id]);
  return true;
}

// ── Reminders (minimal/graceful) ─────────────────────────────────────────────

export async function insertReminder(taskId: string, remindAt: string): Promise<ReminderRecord> {
  const db = await getModuleDb();
  const reminder: ReminderRecord = {
    id: crypto.randomUUID(),
    task_id: taskId,
    remind_at: remindAt,
    sent: false,
    created_at: new Date().toISOString(),
  };
  await db.run(`INSERT INTO ${REMINDERS_TABLE} (id, task_id, remind_at, sent, created_at) VALUES (?,?,?,?,?)`, [
    reminder.id,
    reminder.task_id,
    reminder.remind_at,
    0,
    reminder.created_at,
  ]);
  return reminder;
}

export async function selectDueReminders(nowIso: string): Promise<ReminderRecord[]> {
  const db = await getModuleDb();
  const { rows } = await db.query(
    `SELECT id, task_id, remind_at, sent, created_at FROM ${REMINDERS_TABLE} WHERE sent = 0 AND remind_at <= ? ORDER BY remind_at ASC`,
    [nowIso],
  );
  return rows.map(rowToReminder);
}

export async function markSent(id: string): Promise<boolean> {
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT id FROM ${REMINDERS_TABLE} WHERE id = ?`, [id]);
  if (!rows[0]) return false;
  await db.run(`UPDATE ${REMINDERS_TABLE} SET sent = 1 WHERE id = ?`, [id]);
  return true;
}
