// O6 calendar router — mounted by the registry at /api/modules/calendar
// (scoped Router; inherits localOwnerGuard via the single /api/modules prefix,
// INV-O0-1). Every route is thin: validate → service → json. Mirrors
// server/modules/notes-tasks/router.ts.
import express, { type Router } from "express";
import { parseCalendarInput, parseEventInput, parseEventUpdate, parseRange } from "./schema";
import {
  createCalendar,
  listCalendars,
  createEvent,
  listEventOccurrences,
  getEvent,
  updateEvent,
  deleteEvent,
  importIcs,
  exportIcs,
  syncCaldav,
  ReadOnlyCalendarError,
} from "./service";

export function mountCalendarRoutes(router: Router): void {
  // ── Calendars ────────────────────────────────────────────────────────────
  router.get("/calendars", async (_req, res) => {
    res.json({ calendars: await listCalendars() });
  });

  router.post("/calendars", async (req, res) => {
    let input: ReturnType<typeof parseCalendarInput>;
    try {
      input = parseCalendarInput(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.json(await createCalendar(input));
  });

  // ── Events ───────────────────────────────────────────────────────────────
  router.get("/events", async (req, res) => {
    let range: ReturnType<typeof parseRange>;
    try {
      range = parseRange(req.query);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.json({ occurrences: await listEventOccurrences(range) });
  });

  router.post("/events", async (req, res) => {
    let input: ReturnType<typeof parseEventInput>;
    try {
      input = parseEventInput(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    res.json(await createEvent(input));
  });

  router.get("/events/:id", async (req, res) => {
    const ev = await getEvent(req.params.id);
    if (!ev) {
      res.status(404).json({ error: "event not found" });
      return;
    }
    res.json(ev);
  });

  router.put("/events/:id", async (req, res) => {
    let patch: ReturnType<typeof parseEventUpdate>;
    try {
      patch = parseEventUpdate(req.body);
    } catch (e) {
      res.status(400).json({ error: (e as Error).message });
      return;
    }
    try {
      const updated = await updateEvent(req.params.id, patch);
      if (!updated) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      res.json(updated);
    } catch (e) {
      if (e instanceof ReadOnlyCalendarError) {
        res.status(403).json({ error: e.message });
        return;
      }
      throw e;
    }
  });

  router.delete("/events/:id", async (req, res) => {
    try {
      const ok = await deleteEvent(req.params.id);
      if (!ok) {
        res.status(404).json({ error: "event not found" });
        return;
      }
      res.json({ ok: true });
    } catch (e) {
      if (e instanceof ReadOnlyCalendarError) {
        res.status(403).json({ error: e.message });
        return;
      }
      throw e;
    }
  });

  // ── ICS import/export ────────────────────────────────────────────────────
  // text() is scoped to this route only (type:'*/*' so a text/calendar body is
  // read raw; JSON routes above stay parsed by the app-level express.json()).
  router.post("/import", express.text({ type: () => true, limit: "2mb" }), async (req, res) => {
    const body = typeof req.body === "string" ? req.body : "";
    const imported = await importIcs(body);
    res.json({ imported });
  });

  router.get("/export.ics", async (req, res) => {
    const calendarId = typeof req.query.calendarId === "string" ? req.query.calendarId : undefined;
    const ics = await exportIcs(calendarId);
    res.setHeader("Content-Type", "text/calendar; charset=utf-8");
    res.send(ics);
  });

  // ── CalDAV sync (graceful no-op without CALDAV_URL) ─────────────────────
  router.post("/sync", async (_req, res) => {
    res.json(await syncCaldav());
  });
}
