// O5 notes-tasks router — mounted by the registry at /api/modules/notes-tasks
// (scoped Router; inherits localOwnerGuard via the single /api/modules prefix,
// INV-O0-1). Every route is thin: validate → service → json. Mirrors
// server/modules/demo/router.ts + cookbook/router.ts.
import type { Router } from "express";
import {
  parseNoteInput,
  parseNoteUpdate,
  parseTaskInput,
  parseTaskUpdate,
  parseReminderInput,
  sanitizePriority,
  sanitizeStatus,
} from "./schema";
import {
  createNote,
  listNotes,
  getNote,
  updateNote,
  deleteNote,
  createTask,
  listTasks,
  getTask,
  updateTask,
  deleteTask,
  createReminder,
  dueReminders,
  markReminderSent,
} from "./service";

export function mountNotesTasksRoutes(router: Router): void {
  // ── Notes ──────────────────────────────────────────────────────────────
  router.get("/notes", async (req, res) => {
    const q = typeof req.query.q === "string" ? req.query.q : undefined;
    const tag = typeof req.query.tag === "string" ? req.query.tag : undefined;
    res.json({ notes: await listNotes({ q, tag }) });
  });

  router.post("/notes", async (req, res) => {
    let input: ReturnType<typeof parseNoteInput>;
    try {
      input = parseNoteInput(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.json(await createNote(input));
  });

  router.get("/notes/:id", async (req, res) => {
    const note = await getNote(req.params.id);
    if (!note) {
      res.status(404).json({ error: "note not found" });
      return;
    }
    res.json(note);
  });

  router.put("/notes/:id", async (req, res) => {
    let patch: ReturnType<typeof parseNoteUpdate>;
    try {
      patch = parseNoteUpdate(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const updated = await updateNote(req.params.id, patch);
    if (!updated) {
      res.status(404).json({ error: "note not found" });
      return;
    }
    res.json(updated);
  });

  router.delete("/notes/:id", async (req, res) => {
    const ok = await deleteNote(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "note not found" });
      return;
    }
    res.json({ ok: true });
  });

  // ── Tasks ──────────────────────────────────────────────────────────────
  router.get("/tasks", async (req, res) => {
    let status: ReturnType<typeof sanitizeStatus> | undefined;
    let priority: ReturnType<typeof sanitizePriority> | undefined;
    try {
      if (typeof req.query.status === "string") status = sanitizeStatus(req.query.status);
      if (typeof req.query.priority === "string") priority = sanitizePriority(req.query.priority);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.json({ tasks: await listTasks({ status, priority }) });
  });

  router.post("/tasks", async (req, res) => {
    let input: ReturnType<typeof parseTaskInput>;
    try {
      input = parseTaskInput(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.json(await createTask(input));
  });

  router.get("/tasks/:id", async (req, res) => {
    const task = await getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: "task not found" });
      return;
    }
    res.json(task);
  });

  router.put("/tasks/:id", async (req, res) => {
    let patch: ReturnType<typeof parseTaskUpdate>;
    try {
      patch = parseTaskUpdate(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const updated = await updateTask(req.params.id, patch);
    if (!updated) {
      res.status(404).json({ error: "task not found" });
      return;
    }
    res.json(updated);
  });

  router.delete("/tasks/:id", async (req, res) => {
    const ok = await deleteTask(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "task not found" });
      return;
    }
    res.json({ ok: true });
  });

  // ── Reminders (optional, minimal/graceful — no cron engine) ─────────────
  router.post("/tasks/:id/reminders", async (req, res) => {
    let input: ReturnType<typeof parseReminderInput>;
    try {
      input = parseReminderInput(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    const task = await getTask(req.params.id);
    if (!task) {
      res.status(404).json({ error: "task not found" });
      return;
    }
    res.json(await createReminder(req.params.id, input.remindAt));
  });

  router.get("/reminders/due", async (_req, res) => {
    const due = await dueReminders(new Date().toISOString());
    res.json({ due });
  });

  router.post("/reminders/:id/ack", async (req, res) => {
    const ok = await markReminderSent(req.params.id);
    if (!ok) {
      res.status(404).json({ error: "reminder not found" });
      return;
    }
    res.json({ ok: true });
  });
}
