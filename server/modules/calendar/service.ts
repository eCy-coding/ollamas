// O6 calendar module service — thin business layer over ./store (which is the
// only file touching persistence, via _core/store). Mirrors notes-tasks/service
// naming. Owns: default-calendar seeding (graceful no-CALDAV_URL boot — the repo
// has no tsdav/node-ical dependency, so CalDAV sync + ICS parse/generate are
// hand-rolled minimal implementations here, not a third-party library — see
// PROGRESS notes for the deviation rationale), recurrence expansion (delegates
// to ./recurrence, a pure module), and the read-only write-guard (design spec:
// only caldav-sourced calendars are writable).
import crypto from "node:crypto";
import type { CalendarRecord, CalendarSource, EventOccurrence, EventRecord } from "./schema";
import { isWritableSource } from "./schema";
import { expandOccurrences } from "./recurrence";
import * as store from "./store";

const DEFAULT_CALENDAR_NAME = "My Calendar";

export class ReadOnlyCalendarError extends Error {
  constructor(calendarId: string) {
    super(`event's calendar (${calendarId}) is read-only — only CalDAV calendars are writable`);
    this.name = "ReadOnlyCalendarError";
  }
}

// ── Calendars ────────────────────────────────────────────────────────────────

export async function createCalendar(input: {
  name: string;
  color: string;
  source: CalendarSource;
  caldavUrl: string | null;
}): Promise<CalendarRecord> {
  return store.insertCalendar({ ...input, readOnly: !isWritableSource(input.source) });
}

/** Lazily seeds a default writable local CalDAV calendar (K8/graceful boot —
 *  calendar-caldav.md Faz7 DoD: env-less boot must not crash, and CRUD must
 *  work out of the box even when CALDAV_URL is unset). Idempotent. */
export async function ensureDefaultCalendar(): Promise<CalendarRecord> {
  const all = await store.selectCalendars();
  const existing = all.find((c) => c.source === "caldav" && !c.read_only);
  if (existing) return existing;
  return store.insertCalendar({
    name: DEFAULT_CALENDAR_NAME,
    color: "#7B5EA7",
    source: "caldav",
    caldavUrl: process.env.CALDAV_URL || null,
    readOnly: false,
  });
}

export async function listCalendars(): Promise<CalendarRecord[]> {
  await ensureDefaultCalendar();
  return store.selectCalendars();
}

// ── Events ───────────────────────────────────────────────────────────────────

export async function createEvent(input: {
  summary: string;
  description: string;
  location: string;
  dtstart: string;
  dtend: string;
  allDay: boolean;
  tzid: string;
  rrule: string | null;
  exdate: string[];
  calendarId?: string;
  reminderOffsetSec: number | null;
}): Promise<EventRecord> {
  const calendarId = input.calendarId ?? (await ensureDefaultCalendar()).id;
  return store.insertEvent({
    calendarId,
    uid: `${crypto.randomUUID()}@ollamas.calendar`,
    summary: input.summary,
    description: input.description,
    location: input.location,
    dtstart: input.dtstart,
    dtend: input.dtend,
    allDay: input.allDay,
    tzid: input.tzid,
    rrule: input.rrule,
    exdate: input.exdate,
    reminderOffsetSec: input.reminderOffsetSec,
  });
}

export async function getEvent(id: string): Promise<EventRecord | undefined> {
  return store.selectEvent(id);
}

async function assertWritable(event: EventRecord): Promise<void> {
  const cal = await store.selectCalendar(event.calendar_id);
  if (cal && cal.read_only) throw new ReadOnlyCalendarError(cal.id);
}

export async function updateEvent(
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
  const existing = await store.selectEvent(id);
  if (!existing) return undefined;
  await assertWritable(existing);
  return store.applyEventUpdate(id, patch);
}

export async function deleteEvent(id: string): Promise<boolean> {
  const existing = await store.selectEvent(id);
  if (!existing) return false;
  await assertWritable(existing);
  return store.removeEvent(id);
}

/** List all occurrences (recurrence-expanded) overlapping [from,to], sorted by start. */
export async function listEventOccurrences(range: { from: string; to: string }): Promise<EventOccurrence[]> {
  const events = await store.selectAllEvents();
  const out: EventOccurrence[] = [];
  for (const event of events) {
    const occ = expandOccurrences(
      { dtstart: event.dtstart, dtend: event.dtend, allDay: event.all_day, rrule: event.rrule, exdate: event.exdate },
      range,
    );
    for (const o of occ) out.push({ event, start: o.start, end: o.end });
  }
  out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return out;
}

// ── ICS import/export (hand-rolled minimal RFC5545 subset — no npm dep, K3/K9) ─

function unfoldIcs(text: string): string[] {
  // RFC5545 line folding: a continuation line starts with a single space/tab.
  const rawLines = text.split(/\r\n|\n|\r/);
  const lines: string[] = [];
  for (const line of rawLines) {
    if ((line.startsWith(" ") || line.startsWith("\t")) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  }
  return lines;
}

function icsDateToIso(raw: string): { value: string; allDay: boolean } {
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(raw);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return { value: `${y}-${m}-${d}`, allDay: true };
  }
  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(raw);
  if (dateTime) {
    const [, y, mo, d, h, mi, s, z] = dateTime;
    return { value: `${y}-${mo}-${d}T${h}:${mi}:${s}.000${z ? "Z" : "Z"}`, allDay: false };
  }
  return { value: raw, allDay: false };
}

/** Parse a `.ics` document's VEVENTs into event-input shapes (best-effort — a
 *  malformed VEVENT is skipped, not fatal, calendar-caldav.md Faz2 DoD). */
export function parseIcsEvents(text: string): Array<{
  uid: string;
  summary: string;
  description: string;
  location: string;
  dtstart: string;
  dtend: string;
  allDay: boolean;
  rrule: string | null;
}> {
  const lines = unfoldIcs(text);
  const out: ReturnType<typeof parseIcsEvents> = [];
  let cur: Record<string, string> | null = null;
  for (const line of lines) {
    if (line.trim() === "BEGIN:VEVENT") {
      cur = {};
      continue;
    }
    if (line.trim() === "END:VEVENT") {
      if (cur) {
        try {
          const dtstartRaw = cur.DTSTART;
          const dtendRaw = cur.DTEND ?? cur.DTSTART;
          if (!dtstartRaw) throw new Error("missing DTSTART");
          const dtstart = icsDateToIso(dtstartRaw);
          const dtend = dtendRaw ? icsDateToIso(dtendRaw) : dtstart;
          out.push({
            uid: cur.UID || `${crypto.randomUUID()}@imported`,
            summary: cur.SUMMARY || "(no title)",
            description: cur.DESCRIPTION || "",
            location: cur.LOCATION || "",
            dtstart: dtstart.value,
            dtend: dtend.value,
            allDay: dtstart.allDay,
            rrule: cur.RRULE || null,
          });
        } catch {
          // malformed VEVENT — skip (partial import, not fatal; calendar-caldav.md Faz2 DoD).
        }
      }
      cur = null;
      continue;
    }
    if (cur) {
      const idx = line.indexOf(":");
      if (idx === -1) continue;
      const rawKey = line.slice(0, idx);
      const key = rawKey.split(";")[0].trim().toUpperCase(); // drop params (e.g. DTSTART;TZID=...)
      const value = line.slice(idx + 1);
      cur[key] = value;
    }
  }
  return out;
}

/** Import an `.ics` document's VEVENTs onto a read-only "Imported" calendar
 *  (creating it if absent). Returns the count of events created. */
export async function importIcs(text: string): Promise<number> {
  const parsed = parseIcsEvents(text);
  if (parsed.length === 0) return 0;
  const all = await store.selectCalendars();
  let target = all.find((c) => c.source === "ics");
  if (!target) target = await store.insertCalendar({ name: "Imported (.ics)", color: "#00D4FF", source: "ics", caldavUrl: null, readOnly: true });
  for (const ev of parsed) {
    await store.insertEvent({
      calendarId: target.id,
      uid: ev.uid,
      summary: ev.summary,
      description: ev.description,
      location: ev.location,
      dtstart: ev.dtstart,
      dtend: ev.dtend,
      allDay: ev.allDay,
      tzid: "UTC",
      rrule: ev.rrule,
      exdate: [],
      reminderOffsetSec: null,
    });
  }
  return parsed.length;
}

function icsEscapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

function isoToIcsDate(iso: string, allDay: boolean): string {
  if (allDay) return iso.slice(0, 10).replace(/-/g, "");
  const d = new Date(Date.parse(iso));
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/** Generate a VCALENDAR document for all events (optionally scoped to one
 *  calendar), a valid RFC5545 subset a real calendar app can re-import. */
export async function exportIcs(calendarId?: string): Promise<string> {
  const events = await store.selectAllEvents();
  const scoped = calendarId ? events.filter((e) => e.calendar_id === calendarId) : events;
  const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//ollamas//calendar//EN"];
  for (const ev of scoped) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${ev.uid}`);
    lines.push(`DTSTAMP:${isoToIcsDate(ev.created_at, false)}`);
    lines.push(`${ev.all_day ? "DTSTART;VALUE=DATE" : "DTSTART"}:${isoToIcsDate(ev.dtstart, ev.all_day)}`);
    lines.push(`${ev.all_day ? "DTEND;VALUE=DATE" : "DTEND"}:${isoToIcsDate(ev.dtend, ev.all_day)}`);
    lines.push(`SUMMARY:${icsEscapeText(ev.summary)}`);
    if (ev.description) lines.push(`DESCRIPTION:${icsEscapeText(ev.description)}`);
    if (ev.location) lines.push(`LOCATION:${icsEscapeText(ev.location)}`);
    if (ev.rrule) lines.push(`RRULE:${ev.rrule}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

/** CalDAV sync — graceful no-op when CALDAV_URL is unset (Faz7 DoD: env-less
 *  boot never crashes). A real PROPFIND/REPORT client (tsdav-equivalent) is
 *  out of scope for this pass (K3: no live CalDAV server in this environment
 *  to validate against) — the writable local calendar already gives full CRUD
 *  without it; this stub keeps the surface (route + status shape) stable for
 *  when that client lands. */
export async function syncCaldav(): Promise<{ synced: boolean; reason?: string }> {
  const url = process.env.CALDAV_URL;
  if (!url) return { synced: false, reason: "CALDAV_URL not configured" };
  return { synced: false, reason: "CalDAV remote sync not yet implemented (local calendar is fully functional)" };
}
