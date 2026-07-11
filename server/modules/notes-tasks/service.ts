// O5 notes-tasks module service — thin business layer over ./store (which is
// the only file touching persistence, via _core/store). Mirrors demo/service
// naming (createItem/getItems) and cookbook's honest style: no silent coercion,
// callers (router) validate input via ./schema before reaching here.
import type { NoteRecord, ReminderRecord, TaskPriority, TaskRecord, TaskStatus } from "./schema";
import * as store from "./store";

// ── Notes ────────────────────────────────────────────────────────────────────

export async function createNote(input: { title: string; body: string; tags: string[] }): Promise<NoteRecord> {
  return store.insertNote(input);
}

export async function listNotes(filter: { q?: string; tag?: string }): Promise<NoteRecord[]> {
  const all = await store.selectNotes();
  let out = all;
  if (filter.q) {
    const q = filter.q.toLowerCase();
    out = out.filter((n) => n.title.toLowerCase().includes(q) || n.body.toLowerCase().includes(q));
  }
  if (filter.tag) {
    out = out.filter((n) => n.tags.includes(filter.tag as string));
  }
  return out;
}

export async function getNote(id: string): Promise<NoteRecord | undefined> {
  return store.selectNote(id);
}

export async function updateNote(
  id: string,
  patch: Partial<{ title: string; body: string; tags: string[] }>,
): Promise<NoteRecord | undefined> {
  return store.applyNoteUpdate(id, patch);
}

export async function deleteNote(id: string): Promise<boolean> {
  return store.removeNote(id);
}

// ── Tasks ────────────────────────────────────────────────────────────────────

export async function createTask(input: {
  title: string;
  detail: string;
  priority: TaskPriority;
  dueAt: string | null;
}): Promise<TaskRecord> {
  return store.insertTask(input);
}

export async function listTasks(filter: { status?: TaskStatus; priority?: TaskPriority }): Promise<TaskRecord[]> {
  const all = await store.selectTasks();
  let out = all;
  if (filter.status) out = out.filter((t) => t.status === filter.status);
  if (filter.priority) out = out.filter((t) => t.priority === filter.priority);
  return out;
}

export async function getTask(id: string): Promise<TaskRecord | undefined> {
  return store.selectTask(id);
}

export async function updateTask(
  id: string,
  patch: Partial<{ title: string; detail: string; status: TaskStatus; priority: TaskPriority; dueAt: string | null }>,
): Promise<TaskRecord | undefined> {
  return store.applyTaskUpdate(id, patch);
}

export async function deleteTask(id: string): Promise<boolean> {
  return store.removeTask(id);
}

// ── Reminders (minimal/graceful — see store.ts header) ───────────────────────

export async function createReminder(taskId: string, remindAt: string): Promise<ReminderRecord> {
  return store.insertReminder(taskId, remindAt);
}

export async function dueReminders(nowIso: string): Promise<ReminderRecord[]> {
  return store.selectDueReminders(nowIso);
}

export async function markReminderSent(id: string): Promise<boolean> {
  return store.markSent(id);
}
