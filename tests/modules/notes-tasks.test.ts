// O5 notes-tasks module (docs/odyssey/05-features/notes-tasks.md) — mirrors
// tests/modules/cookbook.test.ts + server/modules/demo/__tests__/demo.test.ts:
// schema validation (pure), store/service CRUD (real SQLite via _core/store,
// restart-persist), route + toggle (functional), reminders (minimal/graceful),
// and the localOwnerGuard invariant (SAAS_ENFORCE=1 → 403).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import "../../server/modules/notes-tasks"; // side-effect: register the real module
import { mountEnabledModules, enabledModules } from "../../server/modules/registry";
import {
  parseNoteInput,
  parseNoteUpdate,
  parseTaskInput,
  parseTaskUpdate,
  sanitizeStatus,
  sanitizePriority,
  TASK_STATUSES,
  TASK_PRIORITIES,
} from "../../server/modules/notes-tasks/schema";
import {
  createNote,
  listNotes,
  getNote,
  updateNote,
  deleteNote,
  createTask,
  listTasks,
  updateTask,
  deleteTask,
  createReminder,
  dueReminders,
  markReminderSent,
} from "../../server/modules/notes-tasks/service";
import { closeStore } from "../../server/store";

// NOTE (gotcha found live): server/modules/_core/store.ts's getModuleDb() runs
// the combined core+module migrations exactly ONCE per process
// (`moduleMigrationsDone`, a module-level flag) — pointing SAAS_DB_PATH at a
// NEW tmp file mid-file after that first call would skip migrations on the new
// file ("no such table"). So this file uses a SINGLE tmp sqlite file for every
// describe block below (set once here, before any test runs), mirroring
// server/modules/demo/__tests__/demo.test.ts's one-db-per-file pattern.
const sharedTmp = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-o5-notes-tasks-"));
beforeAll(() => {
  delete process.env.DATABASE_URL;
  process.env.SAAS_DB_PATH = path.join(sharedTmp, "saas.db");
});
afterAll(async () => {
  await closeStore();
  fs.rmSync(sharedTmp, { recursive: true, force: true });
});

// ── Schema validation (pure, P1) ─────────────────────────────────────────────
describe("O5 notes-tasks — schema validation (P1)", () => {
  test("parseNoteInput requires a non-empty title; body/tags default", () => {
    expect(() => parseNoteInput({})).toThrow();
    expect(() => parseNoteInput({ title: "  " })).toThrow();
    const n = parseNoteInput({ title: "Hello" });
    expect(n).toEqual({ title: "Hello", body: "", tags: [] });
    const full = parseNoteInput({ title: "Hi", body: "# md", tags: ["a", "b"] });
    expect(full).toEqual({ title: "Hi", body: "# md", tags: ["a", "b"] });
  });

  test("parseNoteUpdate accepts a partial patch, rejects wrong types", () => {
    expect(parseNoteUpdate({ title: "New" })).toEqual({ title: "New" });
    expect(() => parseNoteUpdate({ title: 5 })).toThrow();
    expect(() => parseNoteUpdate({ tags: "not-an-array" })).toThrow();
  });

  test("parseTaskInput requires title; priority/status default; due_at validated", () => {
    expect(() => parseTaskInput({})).toThrow();
    const t = parseTaskInput({ title: "Ship it" });
    expect(t.title).toBe("Ship it");
    expect(t.priority).toBe("med");
    expect(t.dueAt).toBeNull();
    expect(() => parseTaskInput({ title: "x", priority: "urgent" })).toThrow();
    expect(() => parseTaskInput({ title: "x", dueAt: "not-a-date" })).toThrow();
    const withDue = parseTaskInput({ title: "x", dueAt: "2026-01-01T00:00:00.000Z", priority: "high" });
    expect(withDue.dueAt).toBe("2026-01-01T00:00:00.000Z");
    expect(withDue.priority).toBe("high");
  });

  test("parseTaskUpdate validates status against the enum, rejects garbage", () => {
    expect(parseTaskUpdate({ status: "running" })).toEqual({ status: "running" });
    expect(() => parseTaskUpdate({ status: "in-progress" })).toThrow();
  });

  test("sanitizeStatus / sanitizePriority — single enum source (TASK_STATUSES/TASK_PRIORITIES)", () => {
    for (const s of TASK_STATUSES) expect(sanitizeStatus(s)).toBe(s);
    for (const p of TASK_PRIORITIES) expect(sanitizePriority(p)).toBe(p);
    expect(() => sanitizeStatus("bogus")).toThrow();
    expect(() => sanitizePriority("bogus")).toThrow();
  });
});

// ── Store/service CRUD (real SQLite via _core/store, P2) ────────────────────
describe("O5 notes-tasks — notes + tasks CRUD (restart-persist)", () => {
  test("createNote → listNotes/getNote → updateNote → deleteNote", async () => {
    const note = await createNote({ title: "First note", body: "# md body", tags: ["work"] });
    expect(note.id).toBeTruthy();
    expect(note.title).toBe("First note");

    const listed = await listNotes({});
    expect(listed.map((n) => n.id)).toContain(note.id);

    const got = await getNote(note.id);
    expect(got?.title).toBe("First note");

    const updated = await updateNote(note.id, { title: "Renamed" });
    expect(updated?.title).toBe("Renamed");
    expect(updated?.updated_at >= note.updated_at).toBe(true);

    const bySearch = await listNotes({ q: "renamed" });
    expect(bySearch.map((n) => n.id)).toContain(note.id);

    const byTag = await listNotes({ tag: "work" });
    expect(byTag.map((n) => n.id)).toContain(note.id);

    const gone = await deleteNote(note.id);
    expect(gone).toBe(true);
    expect(await getNote(note.id)).toBeUndefined();
    expect(await deleteNote(note.id)).toBe(false); // already gone
  });

  test("data survives closeStore→re-init (restart-persist, mirrors demo module)", async () => {
    const note = await createNote({ title: "Persist me", body: "", tags: [] });
    await closeStore();
    const after = await getNote(note.id);
    expect(after?.title).toBe("Persist me");
  });

  test("createTask → listTasks(filter) → updateTask(status transition) → deleteTask", async () => {
    const task = await createTask({ title: "Write tests", detail: "", priority: "high", dueAt: null });
    expect(task.status).toBe("todo");
    expect(task.priority).toBe("high");

    const all = await listTasks({});
    expect(all.map((t) => t.id)).toContain(task.id);

    const running = await updateTask(task.id, { status: "running" });
    expect(running?.status).toBe("running");

    const byStatus = await listTasks({ status: "running" });
    expect(byStatus.map((t) => t.id)).toContain(task.id);
    const byOtherStatus = await listTasks({ status: "done" });
    expect(byOtherStatus.map((t) => t.id)).not.toContain(task.id);

    expect(await updateTask("nope", { status: "done" })).toBeUndefined();

    expect(await deleteTask(task.id)).toBe(true);
    expect(await deleteTask(task.id)).toBe(false);
  });
});

// ── Reminders — minimal/graceful (P3) ────────────────────────────────────────
describe("O5 notes-tasks — reminders (minimal/graceful, optional feature)", () => {
  test("a past-due, unsent reminder shows up in dueReminders(now); future one does not", async () => {
    const task = await createTask({ title: "Remind me", detail: "", priority: "med", dueAt: null });
    const past = await createReminder(task.id, new Date(Date.now() - 60_000).toISOString());
    await createReminder(task.id, new Date(Date.now() + 60_000).toISOString()); // future — not due yet

    const due = await dueReminders(new Date().toISOString());
    expect(due.map((r) => r.id)).toContain(past.id);
    expect(due.length).toBe(1);

    const acked = await markReminderSent(past.id);
    expect(acked).toBe(true);
    expect((await dueReminders(new Date().toISOString())).map((r) => r.id)).not.toContain(past.id);
    expect(await markReminderSent("nope")).toBe(false);
  });
});

// ── Route + toggle (functional, P4) ──────────────────────────────────────────
describe("O5 notes-tasks — route + toggle", () => {
  let server: Server;
  let base = "";

  const post = (p: string, body: unknown) =>
    fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const put = (p: string, body: unknown) =>
    fetch(base + p, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountEnabledModules(app, { MODULE_NOTES_TASKS: "1" } as NodeJS.ProcessEnv);
    server = http.createServer(app as unknown as http.RequestListener);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  test("MODULE_NOTES_TASKS=1 → module listed in /api/modules", async () => {
    process.env.MODULE_NOTES_TASKS = "1";
    expect(enabledModules().map((m) => m.id)).toContain("notes-tasks");
    delete process.env.MODULE_NOTES_TASKS;
  });

  test("POST/GET/PUT/DELETE /api/modules/notes-tasks/notes round-trip", async () => {
    const created = await (await post("/api/modules/notes-tasks/notes", { title: "Note A", body: "body" })).json();
    expect(created.id).toBeTruthy();

    const list = await (await fetch(`${base}/api/modules/notes-tasks/notes`)).json();
    expect(list.notes.map((n: { id: string }) => n.id)).toContain(created.id);

    const updated = await (await put(`/api/modules/notes-tasks/notes/${created.id}`, { title: "Note A2" })).json();
    expect(updated.title).toBe("Note A2");

    const delRes = await fetch(`${base}/api/modules/notes-tasks/notes/${created.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    expect((await fetch(`${base}/api/modules/notes-tasks/notes/${created.id}`)).status).toBe(404);
  });

  test("POST invalid note body → 400 (honest validation)", async () => {
    const res = await post("/api/modules/notes-tasks/notes", {});
    expect(res.status).toBe(400);
  });

  test("POST/GET/PUT/DELETE /api/modules/notes-tasks/tasks round-trip + invalid status → 400", async () => {
    const created = await (await post("/api/modules/notes-tasks/tasks", { title: "Task A" })).json();
    expect(created.status).toBe("todo");

    const updated = await (await put(`/api/modules/notes-tasks/tasks/${created.id}`, { status: "done" })).json();
    expect(updated.status).toBe("done");

    const badStatus = await put(`/api/modules/notes-tasks/tasks/${created.id}`, { status: "bogus" });
    expect(badStatus.status).toBe(400);

    const delRes = await fetch(`${base}/api/modules/notes-tasks/tasks/${created.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    expect((await fetch(`${base}/api/modules/notes-tasks/tasks/${created.id}`)).status).toBe(404);
  });

  test("reminders: create → GET /reminders/due includes past-due, excludes future", async () => {
    const task = await (await post("/api/modules/notes-tasks/tasks", { title: "Task R" })).json();
    const rPast = await (
      await post(`/api/modules/notes-tasks/tasks/${task.id}/reminders`, {
        remindAt: new Date(Date.now() - 1000).toISOString(),
      })
    ).json();
    expect(rPast.id).toBeTruthy();

    const due = await (await fetch(`${base}/api/modules/notes-tasks/reminders/due`)).json();
    expect(due.due.map((r: { id: string }) => r.id)).toContain(rPast.id);

    const ack = await fetch(`${base}/api/modules/notes-tasks/reminders/${rPast.id}/ack`, { method: "POST" });
    expect(ack.status).toBe(200);
    const dueAfter = await (await fetch(`${base}/api/modules/notes-tasks/reminders/due`)).json();
    expect(dueAfter.due.map((r: { id: string }) => r.id)).not.toContain(rPast.id);
  });

  test("MODULE_NOTES_TASKS unset → routes 404 (toggle-off blackout)", async () => {
    const off = express();
    off.use(express.json());
    mountEnabledModules(off, {} as NodeJS.ProcessEnv);
    const s = http.createServer(off as unknown as http.RequestListener);
    await new Promise<void>((r) => s.listen(0, () => r()));
    const addr = s.address();
    const b = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    try {
      expect((await fetch(`${b}/api/modules/notes-tasks/notes`)).status).toBe(404);
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});

// ── localOwnerGuard invariant: /api/modules/notes-tasks is 403 under SaaS (P5) ──
describe("O5 notes-tasks — localOwnerGuard (SAAS_ENFORCE=1 → 403)", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    process.env.OLLAMAS_NO_AUTOBOOT = "1";
    process.env.MODULE_NOTES_TASKS = "1";
    delete process.env.SAAS_ENFORCE;
    const { app } = await import("../../server");
    server = http.createServer(app as unknown as http.RequestListener);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 60_000);
  afterAll(async () => {
    delete process.env.SAAS_ENFORCE;
    delete process.env.MODULE_NOTES_TASKS;
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  test("SAAS_ENFORCE=1 → /api/modules/notes-tasks/* is 403 (inherits the guard)", async () => {
    process.env.SAAS_ENFORCE = "1";
    expect((await fetch(`${base}/api/modules/notes-tasks/notes`)).status).toBe(403);
    delete process.env.SAAS_ENFORCE;
  });

  test("SAAS_ENFORCE unset → guard calls next() (not 403)", async () => {
    delete process.env.SAAS_ENFORCE;
    expect((await fetch(`${base}/api/modules/notes-tasks/notes`)).status).not.toBe(403);
  });
});
