// O5 notes-tasks module — wire types + input validation (honest 400 before any
// work). Mirrors server/modules/demo/schema.ts / cookbook/schema.ts. Types are
// shared with the frontend NotesTasksPanel via the /api/modules/notes-tasks/*
// JSON payloads.

export const TASK_STATUSES = ["todo", "running", "done", "failed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["high", "med", "low"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface NoteRecord {
  id: string;
  title: string;
  body: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface TaskRecord {
  id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReminderRecord {
  id: string;
  task_id: string;
  remind_at: string;
  sent: boolean;
  created_at: string;
}

/** Single enum source (mirrors cookbook FIT_RATIO single-source discipline). */
export function sanitizeStatus(raw: unknown): TaskStatus {
  if (typeof raw !== "string" || !(TASK_STATUSES as readonly string[]).includes(raw)) {
    throw new Error(`invalid status (allowed: ${TASK_STATUSES.join(", ")})`);
  }
  return raw as TaskStatus;
}

export function sanitizePriority(raw: unknown): TaskPriority {
  if (typeof raw !== "string" || !(TASK_PRIORITIES as readonly string[]).includes(raw)) {
    throw new Error(`invalid priority (allowed: ${TASK_PRIORITIES.join(", ")})`);
  }
  return raw as TaskPriority;
}

function isValidIsoDate(raw: unknown): raw is string {
  return typeof raw === "string" && raw.trim() !== "" && !Number.isNaN(Date.parse(raw));
}

/** Validate a { title, body?, tags? } note-create body. */
export function parseNoteInput(body: unknown): { title: string; body: string; tags: string[] } {
  const title = (body as { title?: unknown })?.title;
  if (typeof title !== "string" || title.trim() === "") {
    throw new Error("field 'title' must be a non-empty string");
  }
  const rawBody = (body as { body?: unknown })?.body;
  if (rawBody !== undefined && typeof rawBody !== "string") {
    throw new Error("field 'body' must be a string");
  }
  const tags = parseTagsField((body as { tags?: unknown })?.tags);
  return { title: title.trim(), body: typeof rawBody === "string" ? rawBody : "", tags };
}

function parseTagsField(raw: unknown): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some((t) => typeof t !== "string")) {
    throw new Error("field 'tags' must be an array of strings");
  }
  return raw as string[];
}

/** Validate a PUT note patch — every field optional, but present fields must be well-typed. */
export function parseNoteUpdate(
  body: unknown,
): Partial<{ title: string; body: string; tags: string[] }> {
  const out: Partial<{ title: string; body: string; tags: string[] }> = {};
  const b = (body ?? {}) as { title?: unknown; body?: unknown; tags?: unknown };
  if (b.title !== undefined) {
    if (typeof b.title !== "string" || b.title.trim() === "") {
      throw new Error("field 'title' must be a non-empty string");
    }
    out.title = b.title.trim();
  }
  if (b.body !== undefined) {
    if (typeof b.body !== "string") throw new Error("field 'body' must be a string");
    out.body = b.body;
  }
  if (b.tags !== undefined) out.tags = parseTagsField(b.tags);
  return out;
}

/** Validate a { title, detail?, priority?, dueAt? } task-create body. */
export function parseTaskInput(
  body: unknown,
): { title: string; detail: string; priority: TaskPriority; dueAt: string | null } {
  const title = (body as { title?: unknown })?.title;
  if (typeof title !== "string" || title.trim() === "") {
    throw new Error("field 'title' must be a non-empty string");
  }
  const rawDetail = (body as { detail?: unknown })?.detail;
  if (rawDetail !== undefined && typeof rawDetail !== "string") {
    throw new Error("field 'detail' must be a string");
  }
  const rawPriority = (body as { priority?: unknown })?.priority;
  const priority = rawPriority === undefined ? "med" : sanitizePriority(rawPriority);
  const rawDueAt = (body as { dueAt?: unknown })?.dueAt;
  let dueAt: string | null = null;
  if (rawDueAt !== undefined && rawDueAt !== null) {
    if (!isValidIsoDate(rawDueAt)) throw new Error("field 'dueAt' must be a valid ISO date string");
    dueAt = rawDueAt;
  }
  return { title: title.trim(), detail: typeof rawDetail === "string" ? rawDetail : "", priority, dueAt };
}

/** Validate a PUT task patch — status/priority validated against the single enum. */
export function parseTaskUpdate(body: unknown): Partial<{
  title: string;
  detail: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
}> {
  const out: Partial<{
    title: string;
    detail: string;
    status: TaskStatus;
    priority: TaskPriority;
    dueAt: string | null;
  }> = {};
  const b = (body ?? {}) as {
    title?: unknown;
    detail?: unknown;
    status?: unknown;
    priority?: unknown;
    dueAt?: unknown;
  };
  if (b.title !== undefined) {
    if (typeof b.title !== "string" || b.title.trim() === "") {
      throw new Error("field 'title' must be a non-empty string");
    }
    out.title = b.title.trim();
  }
  if (b.detail !== undefined) {
    if (typeof b.detail !== "string") throw new Error("field 'detail' must be a string");
    out.detail = b.detail;
  }
  if (b.status !== undefined) out.status = sanitizeStatus(b.status);
  if (b.priority !== undefined) out.priority = sanitizePriority(b.priority);
  if (b.dueAt !== undefined) {
    if (b.dueAt === null) out.dueAt = null;
    else if (!isValidIsoDate(b.dueAt)) throw new Error("field 'dueAt' must be a valid ISO date string");
    else out.dueAt = b.dueAt;
  }
  return out;
}

/** Validate a { remindAt } reminder-create body (minimal/graceful — no cron engine, K4-lite). */
export function parseReminderInput(body: unknown): { remindAt: string } {
  const remindAt = (body as { remindAt?: unknown })?.remindAt;
  if (!isValidIsoDate(remindAt)) {
    throw new Error("field 'remindAt' must be a valid ISO date string");
  }
  return { remindAt: remindAt as string };
}
