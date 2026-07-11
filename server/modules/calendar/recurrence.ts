// O6 calendar — recurrence engine (docs/odyssey/05-features/calendar-caldav.md
// Faz 1). Pure functions, no I/O: expands an RRULE (DAILY/WEEKLY/MONTHLY/YEARLY
// + INTERVAL/COUNT/UNTIL/BYDAY) over a bounded [from,to] window, honoring EXDATE.
// K4 guard (calendar-caldav.md §6): every call is window-bounded AND
// occurrence/iteration-capped so an UNTIL/COUNT-less rule can never spin
// unbounded or OOM. All-day events are handled as date-only strings (no Date
// timezone math) so there is no DST shift (calendar-caldav.md Faz1 DoD).

export type Frequency = "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";

const WEEKDAY_CODES = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;
type WeekdayCode = (typeof WEEKDAY_CODES)[number];
// JS Date#getUTCDay(): 0=Sun..6=Sat. Map to RRULE 2-letter codes.
const JS_DOW_TO_CODE: WeekdayCode[] = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

export interface RRuleParts {
  freq: Frequency;
  interval: number;
  byday?: WeekdayCode[];
  count?: number;
  until?: string; // ISO datetime
}

const FREQ_VALUES: readonly Frequency[] = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"];

/** Parse an RFC5545 RRULE value string, e.g. "FREQ=WEEKLY;BYDAY=MO,WE;INTERVAL=2". */
export function parseRRule(rrule: string): RRuleParts {
  const parts: Record<string, string> = {};
  for (const kv of rrule.split(";")) {
    const [k, v] = kv.split("=");
    if (k && v !== undefined) parts[k.trim().toUpperCase()] = v.trim();
  }
  const freq = parts.FREQ as Frequency;
  if (!FREQ_VALUES.includes(freq)) {
    throw new Error(`invalid or missing FREQ in RRULE (allowed: ${FREQ_VALUES.join(", ")})`);
  }
  const out: RRuleParts = { freq, interval: parts.INTERVAL ? Number.parseInt(parts.INTERVAL, 10) : 1 };
  if (parts.BYDAY) {
    out.byday = parts.BYDAY.split(",").map((d) => d.trim().toUpperCase()) as WeekdayCode[];
    for (const d of out.byday) {
      if (!(WEEKDAY_CODES as readonly string[]).includes(d)) throw new Error(`invalid BYDAY code '${d}'`);
    }
  }
  if (parts.COUNT) out.count = Number.parseInt(parts.COUNT, 10);
  if (parts.UNTIL) out.until = normalizeUntil(parts.UNTIL);
  return out;
}

/** RRULE UNTIL is often the compact "20260101T000000Z" basic ISO form. Normalize to full ISO. */
function normalizeUntil(raw: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/.exec(raw);
  if (!m) return raw; // already ISO (or best-effort passthrough — Date.parse will validate downstream)
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:${s}.000Z`;
}

export interface RecurringEventLike {
  dtstart: string;
  dtend: string;
  allDay?: boolean;
  rrule?: string | null;
  exdate?: string[] | null;
}

export interface Occurrence {
  start: string;
  end: string;
}

const MAX_ITERATIONS = 20_000; // hard iteration guard, independent of maxOccurrences (K4)

/** Expand `event` into concrete occurrences overlapping the [from,to] window (inclusive).
 *  Non-recurring events yield at most one occurrence. `maxOccurrences` bounds the result
 *  size (K4 OOM guard — calendar-caldav.md §6). Pure: no I/O, no wall-clock reads. */
export function expandOccurrences(
  event: RecurringEventLike,
  window: { from: string; to: string },
  maxOccurrences = 1000,
): Occurrence[] {
  const allDay = event.allDay === true;
  const durationMs = allDay
    ? dateOnlyToDays(event.dtend) - dateOnlyToDays(event.dtstart)
    : Date.parse(event.dtend) - Date.parse(event.dtstart);
  const windowFromMs = allDay ? dateOnlyToDays(window.from) : Date.parse(window.from);
  const windowToMs = allDay ? dateOnlyToDays(window.to) : Date.parse(window.to);
  const exdateSet = new Set((event.exdate ?? []).map((d) => canonicalKey(d, allDay)));

  if (!event.rrule) {
    const startMs = allDay ? dateOnlyToDays(event.dtstart) : Date.parse(event.dtstart);
    const endMs = startMs + durationMs;
    if (overlaps(startMs, endMs, windowFromMs, windowToMs)) {
      return [{ start: event.dtstart, end: event.dtend }];
    }
    return [];
  }

  const rule = parseRRule(event.rrule);
  const untilMs = rule.until ? (allDay ? dateOnlyToDays(rule.until) : Date.parse(rule.until)) : undefined;
  const out: Occurrence[] = [];
  let generatedCount = 0; // counts EVERY generated instance (for COUNT), independent of window/exdate
  let iterations = 0;

  const emit = (startMs: number): "continue" | "stop" => {
    generatedCount += 1;
    if (rule.count !== undefined && generatedCount > rule.count) return "stop";
    if (untilMs !== undefined && startMs > untilMs) return "stop";
    if (startMs > windowToMs) return rule.count === undefined ? "stop" : "continue";
    if (!exdateSet.has(canonicalKey(fromMs(startMs, allDay), allDay))) {
      const endMs = startMs + durationMs;
      if (overlaps(startMs, endMs, windowFromMs, windowToMs)) {
        out.push({ start: fromMs(startMs, allDay), end: fromMs(endMs, allDay) });
        if (out.length >= maxOccurrences) return "stop";
      }
    }
    return "continue";
  };

  const dtstartMs = allDay ? dateOnlyToDays(event.dtstart) : Date.parse(event.dtstart);

  outer: switch (rule.freq) {
    case "DAILY": {
      const stepDays = rule.interval;
      for (let n = 0; ; n += 1) {
        if (++iterations > MAX_ITERATIONS) break outer;
        const startMs = addDays(dtstartMs, n * stepDays, allDay);
        if (emit(startMs) === "stop") break outer;
      }
      break;
    }
    case "WEEKLY": {
      const days = rule.byday && rule.byday.length > 0 ? rule.byday : [JS_DOW_TO_CODE[weekdayOf(dtstartMs, allDay)]];
      const weekStart = startOfWeek(dtstartMs, allDay);
      for (let week = 0; ; week += 1) {
        const weekBaseMs = addDays(weekStart, week * 7 * rule.interval, allDay);
        for (const code of orderedByWeek(days)) {
          if (++iterations > MAX_ITERATIONS) break outer;
          const offset = WEEKDAY_CODES.indexOf(code);
          const candidateMs = addDays(weekBaseMs, offset, allDay);
          if (candidateMs < dtstartMs) continue; // RRULE instances never precede DTSTART
          // emit() itself decides when to stop (COUNT/UNTIL/window exhausted) — no
          // extra week-level early-exit needed; MAX_ITERATIONS is the outer backstop.
          if (emit(candidateMs) === "stop") break outer;
        }
      }
      break;
    }
    case "MONTHLY": {
      const dayOfMonth = dayOfMonthOf(dtstartMs, allDay);
      for (let n = 0; ; n += 1) {
        if (++iterations > MAX_ITERATIONS) break outer;
        const startMs = addMonths(dtstartMs, n * rule.interval, dayOfMonth, allDay);
        if (emit(startMs) === "stop") break outer;
      }
      break;
    }
    case "YEARLY": {
      for (let n = 0; ; n += 1) {
        if (++iterations > MAX_ITERATIONS) break outer;
        const startMs = addYears(dtstartMs, n * rule.interval, allDay);
        if (emit(startMs) === "stop") break outer;
      }
      break;
    }
  }

  return out;
}

/** Human-readable summary of an RRULE (calendar-caldav.md drawer requirement). */
export function humanizeRRule(rrule: string): string {
  const rule = parseRRule(rrule);
  const weekdaySet = new Set(rule.byday ?? []);
  const isWeekday = (s: Set<string>) =>
    s.size === 5 && ["MO", "TU", "WE", "TH", "FR"].every((d) => s.has(d));

  if (rule.freq === "WEEKLY" && rule.interval === 1 && isWeekday(weekdaySet)) return "Every weekday";
  if (rule.freq === "DAILY" && rule.interval === 1) return "Daily";
  if (rule.freq === "DAILY") return `Every ${rule.interval} days`;
  if (rule.freq === "WEEKLY") {
    const dayNames: Record<string, string> = { MO: "Mon", TU: "Tue", WE: "Wed", TH: "Thu", FR: "Fri", SA: "Sat", SU: "Sun" };
    const label = rule.byday && rule.byday.length > 0 ? rule.byday.map((d) => dayNames[d]).join(", ") : undefined;
    if (rule.interval === 1) return label ? `Weekly on ${label}` : "Weekly";
    return label ? `Every ${rule.interval} weeks on ${label}` : `Every ${rule.interval} weeks`;
  }
  if (rule.freq === "MONTHLY") return rule.interval === 1 ? "Monthly" : `Every ${rule.interval} months`;
  if (rule.freq === "YEARLY") return rule.interval === 1 ? "Yearly" : `Every ${rule.interval} years`;
  return rrule;
}

// ── date-only-safe arithmetic helpers (no DST shift for all-day events) ────────

function dateOnlyToDays(dateStr: string): number {
  // dateStr is YYYY-MM-DD (all-day) — parse as UTC midnight, express as whole days.
  const ms = Date.parse(`${dateStr.slice(0, 10)}T00:00:00.000Z`);
  return Math.round(ms / 86_400_000);
}

function fromMs(ms: number, allDay: boolean): string {
  if (allDay) return new Date(ms * 86_400_000).toISOString().slice(0, 10);
  return new Date(ms).toISOString();
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA <= endB && endA >= startB;
}

function addDays(baseMs: number, n: number, allDay: boolean): number {
  return allDay ? baseMs + n : baseMs + n * 86_400_000;
}

function weekdayOf(ms: number, allDay: boolean): number {
  const d = allDay ? new Date(ms * 86_400_000) : new Date(ms);
  return d.getUTCDay();
}

function startOfWeek(ms: number, allDay: boolean): number {
  // Monday-aligned week start (ISO-ish), matches design spec's week grid.
  const dow = weekdayOf(ms, allDay); // 0=Sun..6=Sat
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  return addDays(ms, mondayOffset, allDay);
}

function orderedByWeek(codes: WeekdayCode[]): WeekdayCode[] {
  return [...codes].sort((a, b) => WEEKDAY_CODES.indexOf(a) - WEEKDAY_CODES.indexOf(b));
}

function dayOfMonthOf(ms: number, allDay: boolean): number {
  const d = allDay ? new Date(ms * 86_400_000) : new Date(ms);
  return d.getUTCDate();
}

function addMonths(baseMs: number, n: number, dayOfMonth: number, allDay: boolean): number {
  const base = allDay ? new Date(baseMs * 86_400_000) : new Date(baseMs);
  const target = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + n, 1));
  const daysInTarget = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(dayOfMonth, daysInTarget));
  if (!allDay) {
    target.setUTCHours(base.getUTCHours(), base.getUTCMinutes(), base.getUTCSeconds(), base.getUTCMilliseconds());
  }
  return allDay ? Math.round(target.getTime() / 86_400_000) : target.getTime();
}

function addYears(baseMs: number, n: number, allDay: boolean): number {
  const base = allDay ? new Date(baseMs * 86_400_000) : new Date(baseMs);
  const targetYear = base.getUTCFullYear() + n;
  // Clamp Feb 29 → Feb 28 on non-leap target years (no crash/no roll-to-March, K4-adjacent).
  const daysInTargetMonth = new Date(Date.UTC(targetYear, base.getUTCMonth() + 1, 0)).getUTCDate();
  const day = Math.min(base.getUTCDate(), daysInTargetMonth);
  const target = new Date(
    Date.UTC(
      targetYear,
      base.getUTCMonth(),
      day,
      base.getUTCHours(),
      base.getUTCMinutes(),
      base.getUTCSeconds(),
      base.getUTCMilliseconds(),
    ),
  );
  return allDay ? Math.round(target.getTime() / 86_400_000) : target.getTime();
}

function canonicalKey(dateStr: string, allDay: boolean): string {
  return allDay ? dateStr.slice(0, 10) : new Date(Date.parse(dateStr)).toISOString();
}
