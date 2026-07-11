// O6 calendar module store — the ONLY place this module touches persistence,
// exclusively through the _core/store facade (mirrors
// server/modules/notes-tasks/store.ts). Claims v10 off the GLOBAL ledger in
// ../registry.ts ("v10 O6 calendar: events/reminders").
import crypto from "node:crypto";
import type { Migration } from "../../store/migrations";
import { getModuleDb } from "../_core/store";
import type { CalendarRecord, CalendarSource, EventRecord } from "./schema";

const CALENDARS_TABLE = "module_calendar_calendars";
const EVENTS_TABLE = "module_calendar_events";

export const MIGRATION_V10_CALENDAR: Migration = {
  version: 10,
  name: "calendar_core",
  up: async (db) => {
    await db.exec(`CREATE TABLE IF NOT EXISTS ${CALENDARS_TABLE} (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#7B5EA7',
      source TEXT NOT NULL DEFAULT 'caldav',
      caldav_url TEXT,
      read_only INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )`);
    await db.exec(`CREATE TABLE IF NOT EXISTS ${EVENTS_TABLE} (
      id TEXT PRIMARY KEY,
      calendar_id TEXT NOT NULL,
      uid TEXT NOT NULL,
      summary TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      location TEXT NOT NULL DEFAULT '',
      dtstart TEXT NOT NULL,
      dtend TEXT NOT NULL,
      all_day INTEGER NOT NULL DEFAULT 0,
      tzid TEXT NOT NULL DEFAULT 'UTC',
      rrule TEXT,
      exdate TEXT NOT NULL DEFAULT '[]',
      reminder_offset_sec INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_events_dtstart ON ${EVENTS_TABLE}(dtstart)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_calendar_events_calendar ON ${EVENTS_TABLE}(calendar_id)`);
  },
  down: async (db) => {
    await db.exec(`DROP INDEX IF EXISTS idx_calendar_events_calendar`);
    await db.exec(`DROP INDEX IF EXISTS idx_calendar_events_dtstart`);
    await db.exec(`DROP TABLE IF EXISTS ${EVENTS_TABLE}`);
    await db.exec(`DROP TABLE IF EXISTS ${CALENDARS_TABLE}`);
  },
};

function rowToCalendar(r: Record<string, unknown>): CalendarRecord {
  return {
    id: String(r.id),
    name: String(r.name),
    color: String(r.color ?? "#7B5EA7"),
    source: r.source as CalendarSource,
    caldav_url: r.caldav_url === null || r.caldav_url === undefined ? null : String(r.caldav_url),
    read_only: Number(r.read_only) === 1,
    created_at: String(r.created_at),
  };
}

function rowToEvent(r: Record<string, unknown>): EventRecord {
  return {
    id: String(r.id),
    calendar_id: String(r.calendar_id),
    uid: String(r.uid),
    summary: String(r.summary),
    description: String(r.description ?? ""),
    location: String(r.location ?? ""),
    dtstart: String(r.dtstart),
    dtend: String(r.dtend),
    all_day: Number(r.all_day) === 1,
    tzid: String(r.tzid ?? "UTC"),
    rrule: r.rrule === null || r.rrule === undefined ? null : String(r.rrule),
    exdate: JSON.parse(String(r.exdate ?? "[]")) as string[],
    reminder_offset_sec:
      r.reminder_offset_sec === null || r.reminder_offset_sec === undefined ? null : Number(r.reminder_offset_sec),
    created_at: String(r.created_at),
    updated_at: String(r.updated_at),
  };
}

// ── Calendars ────────────────────────────────────────────────────────────────

export async function insertCalendar(input: {
  name: string;
  color: string;
  source: CalendarSource;
  caldavUrl: string | null;
  readOnly: boolean;
}): Promise<CalendarRecord> {
  const db = await getModuleDb();
  const cal: CalendarRecord = {
    id: crypto.randomUUID(),
    name: input.name,
    color: input.color,
    source: input.source,
    caldav_url: input.caldavUrl,
    read_only: input.readOnly,
    created_at: new Date().toISOString(),
  };
  await db.run(
    `INSERT INTO ${CALENDARS_TABLE} (id, name, color, source, caldav_url, read_only, created_at) VALUES (?,?,?,?,?,?,?)`,
    [cal.id, cal.name, cal.color, cal.source, cal.caldav_url, cal.read_only ? 1 : 0, cal.created_at],
  );
  return cal;
}

export async function selectCalendars(): Promise<CalendarRecord[]> {
  const db = await getModuleDb();
  const { rows } = await db.query(
    `SELECT id, name, color, source, caldav_url, read_only, created_at FROM ${CALENDARS_TABLE} ORDER BY created_at ASC`,
  );
  return rows.map(rowToCalendar);
}

export async function selectCalendar(id: string): Promise<CalendarRecord | undefined> {
  const db = await getModuleDb();
  const { rows } = await db.query(
    `SELECT id, name, color, source, caldav_url, read_only, created_at FROM ${CALENDARS_TABLE} WHERE id = ?`,
    [id],
  );
  return rows[0] ? rowToCalendar(rows[0]) : undefined;
}

// ── Events ───────────────────────────────────────────────────────────────────

export async function insertEvent(input: {
  calendarId: string;
  uid: string;
  summary: string;
  description: string;
  location: string;
  dtstart: string;
  dtend: string;
  allDay: boolean;
  tzid: string;
  rrule: string | null;
  exdate: string[];
  reminderOffsetSec: number | null;
}): Promise<EventRecord> {
  const db = await getModuleDb();
  const now = new Date().toISOString();
  const ev: EventRecord = {
    id: crypto.randomUUID(),
    calendar_id: input.calendarId,
    uid: input.uid,
    summary: input.summary,
    description: input.description,
    location: input.location,
    dtstart: input.dtstart,
    dtend: input.dtend,
    all_day: input.allDay,
    tzid: input.tzid,
    rrule: input.rrule,
    exdate: input.exdate,
    reminder_offset_sec: input.reminderOffsetSec,
    created_at: now,
    updated_at: now,
  };
  await db.run(
    `INSERT INTO ${EVENTS_TABLE}
      (id, calendar_id, uid, summary, description, location, dtstart, dtend, all_day, tzid, rrule, exdate, reminder_offset_sec, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      ev.id,
      ev.calendar_id,
      ev.uid,
      ev.summary,
      ev.description,
      ev.location,
      ev.dtstart,
      ev.dtend,
      ev.all_day ? 1 : 0,
      ev.tzid,
      ev.rrule,
      JSON.stringify(ev.exdate),
      ev.reminder_offset_sec,
      ev.created_at,
      ev.updated_at,
    ],
  );
  return ev;
}

const EVENT_COLUMNS =
  "id, calendar_id, uid, summary, description, location, dtstart, dtend, all_day, tzid, rrule, exdate, reminder_offset_sec, created_at, updated_at";

export async function selectAllEvents(): Promise<EventRecord[]> {
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT ${EVENT_COLUMNS} FROM ${EVENTS_TABLE} ORDER BY dtstart ASC`);
  return rows.map(rowToEvent);
}

export async function selectEvent(id: string): Promise<EventRecord | undefined> {
  const db = await getModuleDb();
  const { rows } = await db.query(`SELECT ${EVENT_COLUMNS} FROM ${EVENTS_TABLE} WHERE id = ?`, [id]);
  return rows[0] ? rowToEvent(rows[0]) : undefined;
}

export async function applyEventUpdate(
  id: string,
  patch: Partial<{
    summary: string;
    description: string;
    location: string;
    dtstart: string;
    dtend: string;
    allDay: boolean;
    tzid: string;
    rrule: string | null;
    exdate: string[];
    reminderOffsetSec: number | null;
  }>,
): Promise<EventRecord | undefined> {
  const existing = await selectEvent(id);
  if (!existing) return undefined;
  const db = await getModuleDb();
  const merged: EventRecord = {
    ...existing,
    summary: patch.summary ?? existing.summary,
    description: patch.description ?? existing.description,
    location: patch.location ?? existing.location,
    dtstart: patch.dtstart ?? existing.dtstart,
    dtend: patch.dtend ?? existing.dtend,
    all_day: patch.allDay ?? existing.all_day,
    tzid: patch.tzid ?? existing.tzid,
    rrule: patch.rrule !== undefined ? patch.rrule : existing.rrule,
    exdate: patch.exdate ?? existing.exdate,
    reminder_offset_sec: patch.reminderOffsetSec !== undefined ? patch.reminderOffsetSec : existing.reminder_offset_sec,
    updated_at: new Date().toISOString(),
  };
  await db.run(
    `UPDATE ${EVENTS_TABLE} SET summary=?, description=?, location=?, dtstart=?, dtend=?, all_day=?, tzid=?, rrule=?, exdate=?, reminder_offset_sec=?, updated_at=? WHERE id=?`,
    [
      merged.summary,
      merged.description,
      merged.location,
      merged.dtstart,
      merged.dtend,
      merged.all_day ? 1 : 0,
      merged.tzid,
      merged.rrule,
      JSON.stringify(merged.exdate),
      merged.reminder_offset_sec,
      merged.updated_at,
      id,
    ],
  );
  return merged;
}

export async function removeEvent(id: string): Promise<boolean> {
  const db = await getModuleDb();
  const existing = await selectEvent(id);
  if (!existing) return false;
  await db.run(`DELETE FROM ${EVENTS_TABLE} WHERE id = ?`, [id]);
  return true;
}
