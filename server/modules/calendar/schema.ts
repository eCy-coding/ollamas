// O6 calendar module — wire types + input validation (honest 400 before any
// work). Mirrors server/modules/notes-tasks/schema.ts style: explicit enums,
// no silent coercion. Types are shared with the frontend CalendarPanel via the
// /api/modules/calendar/* JSON payloads.

export const CALENDAR_SOURCES = ["caldav", "google", "ics"] as const;
export type CalendarSource = (typeof CALENDAR_SOURCES)[number];

/** Only CalDAV calendars are writable (design spec: google + ics are read-only feeds). */
export function isWritableSource(source: CalendarSource): boolean {
  return source === "caldav";
}

export interface CalendarRecord {
  id: string;
  name: string;
  color: string;
  source: CalendarSource;
  caldav_url: string | null;
  read_only: boolean;
  created_at: string;
}

export interface EventRecord {
  id: string;
  calendar_id: string;
  uid: string;
  summary: string;
  description: string;
  location: string;
  dtstart: string; // ISO datetime, or YYYY-MM-DD for all-day
  dtend: string; // ISO datetime, or YYYY-MM-DD for all-day
  all_day: boolean;
  tzid: string;
  rrule: string | null;
  exdate: string[]; // ISO datetime/date strings excluded from the recurrence set
  reminder_offset_sec: number | null; // relative reminder, e.g. -600 = 10 min before
  created_at: string;
  updated_at: string;
}

/** A single expanded occurrence of an (optionally recurring) event, for a query window. */
export interface EventOccurrence {
  event: EventRecord;
  start: string;
  end: string;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim() !== "";
}

function isValidDateOrDateTime(v: unknown): v is string {
  if (typeof v !== "string" || v.trim() === "") return false;
  // Accept YYYY-MM-DD (all-day) or a value Date.parse understands (ISO datetime).
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return true;
  return !Number.isNaN(Date.parse(v));
}

export function sanitizeSource(raw: unknown): CalendarSource {
  if (typeof raw !== "string" || !(CALENDAR_SOURCES as readonly string[]).includes(raw)) {
    throw new Error(`invalid source (allowed: ${CALENDAR_SOURCES.join(", ")})`);
  }
  return raw as CalendarSource;
}

/** Validate a { name, color?, source?, caldavUrl? } calendar-create body. */
export function parseCalendarInput(body: unknown): {
  name: string;
  color: string;
  source: CalendarSource;
  caldavUrl: string | null;
} {
  const name = (body as { name?: unknown })?.name;
  if (!isNonEmptyString(name)) throw new Error("field 'name' must be a non-empty string");
  const rawColor = (body as { color?: unknown })?.color;
  if (rawColor !== undefined && typeof rawColor !== "string") throw new Error("field 'color' must be a string");
  const rawSource = (body as { source?: unknown })?.source;
  const source = rawSource === undefined ? "caldav" : sanitizeSource(rawSource);
  const rawCaldavUrl = (body as { caldavUrl?: unknown })?.caldavUrl;
  if (rawCaldavUrl !== undefined && rawCaldavUrl !== null && typeof rawCaldavUrl !== "string") {
    throw new Error("field 'caldavUrl' must be a string");
  }
  return {
    name: (name as string).trim(),
    color: typeof rawColor === "string" ? rawColor : "#7B5EA7",
    source,
    caldavUrl: typeof rawCaldavUrl === "string" ? rawCaldavUrl : null,
  };
}

/** Validate a { summary, description?, location?, dtstart, dtend, allDay?, tzid?, rrule?,
 *  exdate?, calendarId?, reminderOffsetSec? } event-create body. */
export function parseEventInput(body: unknown): {
  summary: string;
  description: string;
  location: string;
  dtstart: string;
  dtend: string;
  allDay: boolean;
  tzid: string;
  rrule: string | null;
  exdate: string[];
  calendarId: string | undefined;
  reminderOffsetSec: number | null;
} {
  const b = (body ?? {}) as Record<string, unknown>;
  const summary = b.summary;
  if (!isNonEmptyString(summary)) throw new Error("field 'summary' must be a non-empty string");
  if (!isValidDateOrDateTime(b.dtstart)) throw new Error("field 'dtstart' must be a valid date/datetime string");
  if (!isValidDateOrDateTime(b.dtend)) throw new Error("field 'dtend' must be a valid date/datetime string");
  if (b.description !== undefined && typeof b.description !== "string") {
    throw new Error("field 'description' must be a string");
  }
  if (b.location !== undefined && typeof b.location !== "string") {
    throw new Error("field 'location' must be a string");
  }
  if (b.rrule !== undefined && b.rrule !== null && typeof b.rrule !== "string") {
    throw new Error("field 'rrule' must be a string");
  }
  if (b.exdate !== undefined && (!Array.isArray(b.exdate) || b.exdate.some((d) => typeof d !== "string"))) {
    throw new Error("field 'exdate' must be an array of strings");
  }
  if (b.calendarId !== undefined && typeof b.calendarId !== "string") {
    throw new Error("field 'calendarId' must be a string");
  }
  if (b.reminderOffsetSec !== undefined && b.reminderOffsetSec !== null && typeof b.reminderOffsetSec !== "number") {
    throw new Error("field 'reminderOffsetSec' must be a number");
  }
  return {
    summary: (summary as string).trim(),
    description: typeof b.description === "string" ? b.description : "",
    location: typeof b.location === "string" ? b.location : "",
    dtstart: b.dtstart as string,
    dtend: b.dtend as string,
    allDay: b.allDay === true,
    tzid: typeof b.tzid === "string" && b.tzid.trim() !== "" ? b.tzid : "UTC",
    rrule: typeof b.rrule === "string" ? b.rrule : null,
    exdate: Array.isArray(b.exdate) ? (b.exdate as string[]) : [],
    calendarId: typeof b.calendarId === "string" ? b.calendarId : undefined,
    reminderOffsetSec: typeof b.reminderOffsetSec === "number" ? b.reminderOffsetSec : null,
  };
}

/** Validate a PUT event patch — every field optional, but present fields must be well-typed. */
export function parseEventUpdate(body: unknown): Partial<{
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
}> {
  const b = (body ?? {}) as Record<string, unknown>;
  const out: ReturnType<typeof parseEventUpdate> = {};
  if (b.summary !== undefined) {
    if (!isNonEmptyString(b.summary)) throw new Error("field 'summary' must be a non-empty string");
    out.summary = (b.summary as string).trim();
  }
  if (b.description !== undefined) {
    if (typeof b.description !== "string") throw new Error("field 'description' must be a string");
    out.description = b.description;
  }
  if (b.location !== undefined) {
    if (typeof b.location !== "string") throw new Error("field 'location' must be a string");
    out.location = b.location;
  }
  if (b.dtstart !== undefined) {
    if (!isValidDateOrDateTime(b.dtstart)) throw new Error("field 'dtstart' must be a valid date/datetime string");
    out.dtstart = b.dtstart as string;
  }
  if (b.dtend !== undefined) {
    if (!isValidDateOrDateTime(b.dtend)) throw new Error("field 'dtend' must be a valid date/datetime string");
    out.dtend = b.dtend as string;
  }
  if (b.allDay !== undefined) out.allDay = b.allDay === true;
  if (b.tzid !== undefined) {
    if (typeof b.tzid !== "string" || b.tzid.trim() === "") throw new Error("field 'tzid' must be a non-empty string");
    out.tzid = b.tzid;
  }
  if (b.rrule !== undefined) {
    if (b.rrule !== null && typeof b.rrule !== "string") throw new Error("field 'rrule' must be a string or null");
    out.rrule = b.rrule as string | null;
  }
  if (b.exdate !== undefined) {
    if (!Array.isArray(b.exdate) || b.exdate.some((d) => typeof d !== "string")) {
      throw new Error("field 'exdate' must be an array of strings");
    }
    out.exdate = b.exdate as string[];
  }
  if (b.reminderOffsetSec !== undefined) {
    if (b.reminderOffsetSec !== null && typeof b.reminderOffsetSec !== "number") {
      throw new Error("field 'reminderOffsetSec' must be a number or null");
    }
    out.reminderOffsetSec = b.reminderOffsetSec as number | null;
  }
  return out;
}

/** Validate a { from, to } range-query — both required, `to` must be >= `from`. */
export function parseRange(query: unknown): { from: string; to: string } {
  const q = (query ?? {}) as Record<string, unknown>;
  if (!isValidDateOrDateTime(q.from)) throw new Error("query 'from' must be a valid date/datetime string");
  if (!isValidDateOrDateTime(q.to)) throw new Error("query 'to' must be a valid date/datetime string");
  const from = q.from as string;
  const to = q.to as string;
  if (Date.parse(to) < Date.parse(from)) throw new Error("query 'to' must be >= 'from'");
  return { from, to };
}
