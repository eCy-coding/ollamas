// O6 calendar module (docs/odyssey/05-features/calendar-caldav.md) — mirrors
// tests/modules/notes-tasks.test.ts: pure recurrence unit tests, schema
// validation (pure), store/service CRUD (real SQLite via _core/store,
// restart-persist), route + toggle (functional), and the localOwnerGuard
// invariant (SAAS_ENFORCE=1 → 403).
import { describe, test, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { Server } from "node:http";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import "../../server/modules/calendar"; // side-effect: register the real module
import { mountEnabledModules, enabledModules } from "../../server/modules/registry";
import { expandOccurrences, parseRRule, humanizeRRule } from "../../server/modules/calendar/recurrence";
import {
  parseCalendarInput,
  parseEventInput,
  parseEventUpdate,
  parseRange,
  isWritableSource,
} from "../../server/modules/calendar/schema";
import {
  createCalendar,
  listCalendars,
  createEvent,
  listEventOccurrences,
  getEvent,
  updateEvent,
  deleteEvent,
} from "../../server/modules/calendar/service";
import { closeStore } from "../../server/store";

// ── Recurrence engine (pure, P0) ─────────────────────────────────────────────
describe("O6 calendar — RRULE expansion (pure)", () => {
  test("parseRRule reads FREQ/INTERVAL/BYDAY/COUNT/UNTIL", () => {
    expect(parseRRule("FREQ=WEEKLY;BYDAY=MO,WE")).toEqual({ freq: "WEEKLY", interval: 1, byday: ["MO", "WE"] });
    expect(parseRRule("FREQ=DAILY;INTERVAL=2;COUNT=5")).toEqual({ freq: "DAILY", interval: 2, count: 5 });
    expect(() => parseRRule("FREQ=BOGUS")).toThrow();
    expect(() => parseRRule("FREQ=WEEKLY;BYDAY=ZZ")).toThrow();
  });

  test("DAILY: interval + window bound the occurrence count", () => {
    const occ = expandOccurrences(
      { dtstart: "2026-07-01T09:00:00.000Z", dtend: "2026-07-01T10:00:00.000Z", rrule: "FREQ=DAILY" },
      { from: "2026-07-01T00:00:00.000Z", to: "2026-07-05T23:59:59.000Z" },
    );
    expect(occ).toHaveLength(5); // Jul 1..5 inclusive
    expect(occ[0].start).toBe("2026-07-01T09:00:00.000Z");
    expect(occ[4].start).toBe("2026-07-05T09:00:00.000Z");
  });

  test("WEEKLY BYDAY=MO,WE: correct occurrence count in a 2-week window", () => {
    // 2026-07-06 is a Monday.
    const occ = expandOccurrences(
      { dtstart: "2026-07-06T10:00:00.000Z", dtend: "2026-07-06T11:00:00.000Z", rrule: "FREQ=WEEKLY;BYDAY=MO,WE" },
      { from: "2026-07-06T00:00:00.000Z", to: "2026-07-19T23:59:59.000Z" },
    );
    // Week 1: Mon Jul6, Wed Jul8. Week 2: Mon Jul13, Wed Jul15. => 4
    expect(occ.map((o) => o.start.slice(0, 10))).toEqual(["2026-07-06", "2026-07-08", "2026-07-13", "2026-07-15"]);
  });

  test("humanizeRRule: 'Every weekday' for MO-FR, 'Weekly on Tue' for a single day", () => {
    expect(humanizeRRule("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR")).toBe("Every weekday");
    expect(humanizeRRule("FREQ=WEEKLY;BYDAY=TU")).toBe("Weekly on Tue");
  });

  test("MONTHLY + YEARLY: interval respected", () => {
    const monthly = expandOccurrences(
      { dtstart: "2026-01-15T00:00:00.000Z", dtend: "2026-01-15T01:00:00.000Z", rrule: "FREQ=MONTHLY" },
      { from: "2026-01-01T00:00:00.000Z", to: "2026-04-01T00:00:00.000Z" },
    );
    expect(monthly.map((o) => o.start.slice(0, 10))).toEqual(["2026-01-15", "2026-02-15", "2026-03-15"]);

    const yearly = expandOccurrences(
      { dtstart: "2024-02-29T00:00:00.000Z", dtend: "2024-02-29T01:00:00.000Z", rrule: "FREQ=YEARLY" },
      { from: "2024-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z" },
    );
    // Leap day clamps to Feb 28 on non-leap years (no crash, no skip).
    expect(yearly.map((o) => o.start.slice(0, 10))).toEqual(["2024-02-29", "2025-02-28", "2026-02-28"]);
  });

  test("EXDATE removes a matching instance from the expansion", () => {
    const occ = expandOccurrences(
      {
        dtstart: "2026-07-01T09:00:00.000Z",
        dtend: "2026-07-01T10:00:00.000Z",
        rrule: "FREQ=DAILY",
        exdate: ["2026-07-03T09:00:00.000Z"],
      },
      { from: "2026-07-01T00:00:00.000Z", to: "2026-07-04T23:59:59.000Z" },
    );
    expect(occ.map((o) => o.start.slice(0, 10))).toEqual(["2026-07-01", "2026-07-02", "2026-07-04"]);
  });

  test("COUNT limits total generated instances even across a wider window", () => {
    const occ = expandOccurrences(
      { dtstart: "2026-07-01T09:00:00.000Z", dtend: "2026-07-01T10:00:00.000Z", rrule: "FREQ=DAILY;COUNT=3" },
      { from: "2026-07-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" },
    );
    expect(occ).toHaveLength(3);
  });

  test("UNTIL bounds the recurrence regardless of window width", () => {
    const occ = expandOccurrences(
      {
        dtstart: "2026-07-01T09:00:00.000Z",
        dtend: "2026-07-01T10:00:00.000Z",
        rrule: "FREQ=DAILY;UNTIL=20260703T000000Z",
      },
      { from: "2026-07-01T00:00:00.000Z", to: "2026-08-01T00:00:00.000Z" },
    );
    expect(occ.map((o) => o.start.slice(0, 10))).toEqual(["2026-07-01", "2026-07-02"]);
  });

  test("all-day events do not shift across a DST boundary (Europe/Istanbul-relevant date, UTC-anchored)", () => {
    // TR DST historically flips around late March — assert the date string itself
    // never drifts by expanding a daily all-day rule straddling that week.
    const occ = expandOccurrences(
      { dtstart: "2026-03-27", dtend: "2026-03-28", allDay: true, rrule: "FREQ=DAILY" },
      { from: "2026-03-27", to: "2026-03-30" },
    );
    expect(occ.map((o) => o.start)).toEqual(["2026-03-27", "2026-03-28", "2026-03-29", "2026-03-30"]);
  });

  test("K4 OOM guard: an unbounded rule is capped by maxOccurrences", () => {
    const occ = expandOccurrences(
      { dtstart: "2020-01-01T00:00:00.000Z", dtend: "2020-01-01T01:00:00.000Z", rrule: "FREQ=DAILY" },
      { from: "2020-01-01T00:00:00.000Z", to: "2030-01-01T00:00:00.000Z" },
      50,
    );
    expect(occ).toHaveLength(50);
  });

  test("non-recurring event: single occurrence only if it overlaps the window", () => {
    const inWindow = expandOccurrences(
      { dtstart: "2026-07-01T09:00:00.000Z", dtend: "2026-07-01T10:00:00.000Z" },
      { from: "2026-07-01T00:00:00.000Z", to: "2026-07-02T00:00:00.000Z" },
    );
    expect(inWindow).toHaveLength(1);
    const outOfWindow = expandOccurrences(
      { dtstart: "2026-07-01T09:00:00.000Z", dtend: "2026-07-01T10:00:00.000Z" },
      { from: "2026-08-01T00:00:00.000Z", to: "2026-08-02T00:00:00.000Z" },
    );
    expect(outOfWindow).toHaveLength(0);
  });
});

// ── Schema validation (pure, P1) ─────────────────────────────────────────────
describe("O6 calendar — schema validation (P1)", () => {
  test("parseCalendarInput requires a non-empty name; source/color default", () => {
    expect(() => parseCalendarInput({})).toThrow();
    const c = parseCalendarInput({ name: "Personal" });
    expect(c.name).toBe("Personal");
    expect(c.source).toBe("caldav");
    expect(() => parseCalendarInput({ name: "x", source: "bogus" })).toThrow();
  });

  test("parseEventInput requires summary/dtstart/dtend; defaults tzid/allDay/rrule", () => {
    expect(() => parseEventInput({})).toThrow();
    const e = parseEventInput({ summary: "Standup", dtstart: "2026-07-06T09:00:00.000Z", dtend: "2026-07-06T09:15:00.000Z" });
    expect(e.summary).toBe("Standup");
    expect(e.tzid).toBe("UTC");
    expect(e.allDay).toBe(false);
    expect(e.rrule).toBeNull();
    expect(() => parseEventInput({ summary: "x", dtstart: "not-a-date", dtend: "2026-07-06T09:15:00.000Z" })).toThrow();
  });

  test("parseEventUpdate accepts a partial patch, rejects wrong types", () => {
    expect(parseEventUpdate({ summary: "New" })).toEqual({ summary: "New" });
    expect(() => parseEventUpdate({ summary: "" })).toThrow();
    expect(() => parseEventUpdate({ exdate: "not-an-array" })).toThrow();
  });

  test("parseRange requires from<=to", () => {
    expect(parseRange({ from: "2026-01-01", to: "2026-01-31" })).toEqual({ from: "2026-01-01", to: "2026-01-31" });
    expect(() => parseRange({ from: "2026-02-01", to: "2026-01-01" })).toThrow();
    expect(() => parseRange({})).toThrow();
  });

  test("isWritableSource: only caldav is writable (design spec — google/ics read-only)", () => {
    expect(isWritableSource("caldav")).toBe(true);
    expect(isWritableSource("google")).toBe(false);
    expect(isWritableSource("ics")).toBe(false);
  });
});

// ── Store/service CRUD (real SQLite via _core/store, P2) ────────────────────
const sharedTmp = fs.mkdtempSync(path.join(os.tmpdir(), "ollamas-o6-calendar-"));
beforeAll(() => {
  delete process.env.DATABASE_URL;
  process.env.SAAS_DB_PATH = path.join(sharedTmp, "saas.db");
});
afterAll(async () => {
  await closeStore();
  fs.rmSync(sharedTmp, { recursive: true, force: true });
});

describe("O6 calendar — calendars + events CRUD (restart-persist)", () => {
  test("createCalendar → listCalendars", async () => {
    const cal = await createCalendar({ name: "Work", color: "#7B5EA7", source: "caldav", caldavUrl: null });
    expect(cal.id).toBeTruthy();
    expect(cal.read_only).toBe(false);

    const readonlyCal = await createCalendar({ name: "Holidays", color: "#00D4FF", source: "ics", caldavUrl: null });
    expect(readonlyCal.read_only).toBe(true);

    const all = await listCalendars();
    expect(all.map((c) => c.id)).toEqual(expect.arrayContaining([cal.id, readonlyCal.id]));
  });

  test("createEvent → listEventOccurrences(range) expands recurrence → getEvent/updateEvent/deleteEvent", async () => {
    const cal = await createCalendar({ name: "Work2", color: "#7B5EA7", source: "caldav", caldavUrl: null });
    const ev = await createEvent({
      summary: "Standup",
      description: "",
      location: "",
      dtstart: "2026-07-06T09:00:00.000Z",
      dtend: "2026-07-06T09:15:00.000Z",
      allDay: false,
      tzid: "UTC",
      rrule: "FREQ=WEEKLY;BYDAY=MO",
      exdate: [],
      calendarId: cal.id,
      reminderOffsetSec: -600,
    });
    expect(ev.id).toBeTruthy();

    const occ = await listEventOccurrences({ from: "2026-07-06T00:00:00.000Z", to: "2026-07-20T23:59:59.000Z" });
    expect(occ.filter((o) => o.event.id === ev.id)).toHaveLength(3); // Jul 6, 13, 20 (Mondays)

    const got = await getEvent(ev.id);
    expect(got?.summary).toBe("Standup");

    const updated = await updateEvent(ev.id, { summary: "Standup (renamed)" });
    expect(updated?.summary).toBe("Standup (renamed)");

    expect(await deleteEvent(ev.id)).toBe(true);
    expect(await getEvent(ev.id)).toBeUndefined();
    expect(await deleteEvent(ev.id)).toBe(false);
  });

  test("updateEvent/deleteEvent on a read-only (ics/google) calendar's event is rejected", async () => {
    const cal = await createCalendar({ name: "Feed", color: "#00D4FF", source: "ics", caldavUrl: null });
    const ev = await createEvent({
      summary: "Imported",
      description: "",
      location: "",
      dtstart: "2026-07-06T09:00:00.000Z",
      dtend: "2026-07-06T09:15:00.000Z",
      allDay: false,
      tzid: "UTC",
      rrule: null,
      exdate: [],
      calendarId: cal.id,
      reminderOffsetSec: null,
    });
    await expect(updateEvent(ev.id, { summary: "hacked" })).rejects.toThrow(/read-only/i);
    await expect(deleteEvent(ev.id)).rejects.toThrow(/read-only/i);
  });

  test("data survives closeStore→re-init (restart-persist, mirrors notes-tasks module)", async () => {
    const cal = await createCalendar({ name: "Persist", color: "#7B5EA7", source: "caldav", caldavUrl: null });
    await closeStore();
    const after = await listCalendars();
    expect(after.map((c) => c.id)).toContain(cal.id);
  });
});

// ── Route + toggle (functional, P4) ──────────────────────────────────────────
describe("O6 calendar — route + toggle", () => {
  let server: Server;
  let base = "";

  const post = (p: string, body: unknown) =>
    fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const put = (p: string, body: unknown) =>
    fetch(base + p, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    mountEnabledModules(app, { MODULE_CALENDAR: "1" } as NodeJS.ProcessEnv);
    server = http.createServer(app as unknown as http.RequestListener);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  test("MODULE_CALENDAR=1 → module listed in /api/modules", async () => {
    process.env.MODULE_CALENDAR = "1";
    expect(enabledModules().map((m) => m.id)).toContain("calendar");
    delete process.env.MODULE_CALENDAR;
  });

  test("GET /calendars always includes a default writable local CalDAV calendar (graceful, no CALDAV_URL)", async () => {
    const res = await (await fetch(`${base}/api/modules/calendar/calendars`)).json();
    expect(res.calendars.some((c: { source: string; read_only: boolean }) => c.source === "caldav" && c.read_only === false)).toBe(true);
  });

  test("POST/GET/PUT/DELETE /api/modules/calendar/events round-trip", async () => {
    const created = await (
      await post("/api/modules/calendar/events", {
        summary: "Team sync",
        dtstart: "2026-07-06T09:00:00.000Z",
        dtend: "2026-07-06T09:30:00.000Z",
      })
    ).json();
    expect(created.id).toBeTruthy();

    const list = await (
      await fetch(`${base}/api/modules/calendar/events?from=2026-07-06T00:00:00.000Z&to=2026-07-07T00:00:00.000Z`)
    ).json();
    expect(list.occurrences.some((o: { event: { id: string } }) => o.event.id === created.id)).toBe(true);

    const updated = await (await put(`${`/api/modules/calendar/events/${created.id}`}`, { summary: "Team sync 2" })).json();
    expect(updated.summary).toBe("Team sync 2");

    const delRes = await fetch(`${base}/api/modules/calendar/events/${created.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);
    expect((await fetch(`${base}/api/modules/calendar/events/${created.id}`)).status).toBe(404);
  });

  test("POST invalid event body → 400 (honest validation)", async () => {
    const res = await post("/api/modules/calendar/events", {});
    expect(res.status).toBe(400);
  });

  test("GET /events without from/to → 400", async () => {
    const res = await fetch(`${base}/api/modules/calendar/events`);
    expect(res.status).toBe(400);
  });

  test("GET /export.ics returns a parseable VCALENDAR", async () => {
    const res = await fetch(`${base}/api/modules/calendar/export.ics`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("BEGIN:VCALENDAR");
    expect(text).toContain("END:VCALENDAR");
  });

  test("POST /import (ics text) creates events on the ics (read-only) calendar", async () => {
    const ics = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "BEGIN:VEVENT",
      "UID:imported-1@example.com",
      "DTSTAMP:20260101T000000Z",
      "DTSTART:20260710T090000Z",
      "DTEND:20260710T100000Z",
      "SUMMARY:Imported Meeting",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");
    const res = await fetch(`${base}/api/modules/calendar/import`, {
      method: "POST",
      headers: { "Content-Type": "text/calendar" },
      body: ics,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.imported).toBe(1);
  });

  test("MODULE_CALENDAR unset → routes 404 (toggle-off blackout)", async () => {
    const off = express();
    off.use(express.json());
    mountEnabledModules(off, {} as NodeJS.ProcessEnv);
    const s = http.createServer(off as unknown as http.RequestListener);
    await new Promise<void>((r) => s.listen(0, () => r()));
    const addr = s.address();
    const b = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    try {
      expect((await fetch(`${b}/api/modules/calendar/calendars`)).status).toBe(404);
    } finally {
      await new Promise<void>((r) => s.close(() => r()));
    }
  });
});

// ── localOwnerGuard invariant: /api/modules/calendar is 403 under SaaS (P5) ──
describe("O6 calendar — localOwnerGuard (SAAS_ENFORCE=1 → 403)", () => {
  let server: Server;
  let base = "";
  beforeAll(async () => {
    process.env.OLLAMAS_NO_AUTOBOOT = "1";
    process.env.MODULE_CALENDAR = "1";
    delete process.env.SAAS_ENFORCE;
    const { app } = await import("../../server");
    server = http.createServer(app as unknown as http.RequestListener);
    await new Promise<void>((r) => server.listen(0, () => r()));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  }, 60_000);
  afterAll(async () => {
    delete process.env.SAAS_ENFORCE;
    delete process.env.MODULE_CALENDAR;
    await new Promise<void>((r) => (server ? server.close(() => r()) : r()));
  });

  test("SAAS_ENFORCE=1 → /api/modules/calendar/* is 403 (inherits the guard)", async () => {
    process.env.SAAS_ENFORCE = "1";
    expect((await fetch(`${base}/api/modules/calendar/calendars`)).status).toBe(403);
    delete process.env.SAAS_ENFORCE;
  });

  test("SAAS_ENFORCE unset → guard calls next() (not 403)", async () => {
    delete process.env.SAAS_ENFORCE;
    expect((await fetch(`${base}/api/modules/calendar/calendars`)).status).not.toBe(403);
  });
});
