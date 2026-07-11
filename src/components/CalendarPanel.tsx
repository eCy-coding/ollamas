// O6 CalendarPanel (docs/odyssey/05-features/calendar-caldav.md, design spec
// extracted from the Claude Design CalendarFrame panel — eCy-cyan theme). Data
// via apiClient (/api/modules/calendar/*) — never a hard-coded list. Token set
// is COMPONENT-SCOPED (`.cal-scope`, PIPELINE-LESSONS #10 — no global hex),
// driven by the app's real useTheme(). Fonts via `var(--font-*, fallback)`
// (lesson #11 — no Google @import/CSP risk). a11y: source/status carry TEXT
// labels, never color-only (lesson #9).
//
// Deviations from the literal design spec (time-boxed, noted for the PR):
//  - The mock's own left nav-rail is omitted — ollamas already has a single
//    global sidebar (App.tsx); duplicating it here would be a second nav.
//  - Week/day view renders events as simple top/height-positioned blocks
//    against an hour ruler (7am–9pm, 44px/hr) rather than a full column-packing
//    overlap-layout algorithm; concurrent events stack in reading order.
//  - The drawer's inline "Edit" is a minimal field form (summary/location/
//    notes/when), not the full creation form's every field.
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useLingui } from '@lingui/react';
import {
  RefreshCw,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  Plus,
  Lock,
  X,
  CalendarDays,
} from 'lucide-react';
import { api } from '../lib/apiClient';
import { useTheme } from '../lib/theme';

type CalendarSource = 'caldav' | 'google' | 'ics';
type ViewMode = 'month' | 'week' | 'day';
type PanelState = 'loading' | 'error' | 'empty' | 'filled';

interface CalendarRecord {
  id: string;
  name: string;
  color: string;
  source: CalendarSource;
  read_only: boolean;
}

interface EventRecord {
  id: string;
  calendar_id: string;
  summary: string;
  description: string;
  location: string;
  dtstart: string;
  dtend: string;
  all_day: boolean;
  tzid: string;
  rrule: string | null;
  reminder_offset_sec: number | null;
}

interface Occurrence {
  event: EventRecord;
  start: string;
  end: string;
}

type Tr = (id: string) => string;

const SOURCE_ORDER: CalendarSource[] = ['caldav', 'google', 'ics'];
const SOURCE_COLOR: Record<CalendarSource, string> = {
  caldav: 'var(--cal-src-caldav)',
  google: 'var(--cal-src-google)',
  ics: 'var(--cal-src-ics)',
};

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfWeekMonday(d: Date): Date {
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const offset = day === 0 ? -6 : 1 - day;
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  out.setUTCDate(out.getUTCDate() + offset);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

function humanizeRRuleLocal(rrule: string): string {
  // Small client-side mirror of server/modules/calendar/recurrence.ts's
  // humanizeRRule — the drawer needs a label without a network round-trip.
  const parts: Record<string, string> = {};
  for (const kv of rrule.split(';')) {
    const [k, v] = kv.split('=');
    if (k && v !== undefined) parts[k.toUpperCase()] = v;
  }
  const freq = parts.FREQ;
  const interval = parts.INTERVAL ? Number.parseInt(parts.INTERVAL, 10) : 1;
  const byday = parts.BYDAY ? parts.BYDAY.split(',') : undefined;
  const dayNames: Record<string, string> = { MO: 'Mon', TU: 'Tue', WE: 'Wed', TH: 'Thu', FR: 'Fri', SA: 'Sat', SU: 'Sun' };
  const isWeekday = byday && byday.length === 5 && ['MO', 'TU', 'WE', 'TH', 'FR'].every((d) => byday.includes(d));
  if (freq === 'WEEKLY' && interval === 1 && isWeekday) return 'Every weekday';
  if (freq === 'DAILY') return interval === 1 ? 'Daily' : `Every ${interval} days`;
  if (freq === 'WEEKLY') {
    const label = byday && byday.length > 0 ? byday.map((d) => dayNames[d] ?? d).join(', ') : undefined;
    if (interval === 1) return label ? `Weekly on ${label}` : 'Weekly';
    return label ? `Every ${interval} weeks on ${label}` : `Every ${interval} weeks`;
  }
  if (freq === 'MONTHLY') return interval === 1 ? 'Monthly' : `Every ${interval} months`;
  if (freq === 'YEARLY') return interval === 1 ? 'Yearly' : `Every ${interval} years`;
  return rrule;
}

export default function CalendarPanel() {
  const { _: rawT } = useLingui();
  const _: Tr = (id: string) => rawT(id);
  const { theme } = useTheme();

  const [view, setView] = useState<ViewMode>('week');
  const [anchor, setAnchor] = useState(() => new Date());
  const [calendars, setCalendars] = useState<CalendarRecord[] | null>(null);
  const [occurrences, setOccurrences] = useState<Occurrence[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [hiddenSources, setHiddenSources] = useState<Set<CalendarSource>>(new Set());
  const [selected, setSelected] = useState<Occurrence | null>(null);
  const [editing, setEditing] = useState(false);
  const [creating, setCreating] = useState(false);

  const range = useMemo(() => {
    if (view === 'day') {
      const from = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
      return { from: from.toISOString(), to: addDays(from, 1).toISOString() };
    }
    if (view === 'week') {
      const from = startOfWeekMonday(anchor);
      return { from: from.toISOString(), to: addDays(from, 7).toISOString() };
    }
    // month: full 6x7 grid window (may spill into adjacent months)
    const first = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
    const gridStart = startOfWeekMonday(first);
    return { from: gridStart.toISOString(), to: addDays(gridStart, 42).toISOString() };
  }, [view, anchor]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const calsReq = api.get('/api/modules/calendar/calendars') as Promise<{ calendars: CalendarRecord[] }>;
      const occReq = api.get(
        `/api/modules/calendar/events?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`,
      ) as Promise<{ occurrences: Occurrence[] }>;
      const [c, o] = await Promise.all([calsReq, occReq]);
      setCalendars(c.calendars);
      setOccurrences(o.occurrences);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to]);

  useEffect(() => {
    void load();
  }, [load]);

  const calendarById = useMemo(() => {
    const map = new Map<string, CalendarRecord>();
    for (const c of calendars ?? []) map.set(c.id, c);
    return map;
  }, [calendars]);

  const visibleOccurrences = useMemo(() => {
    return (occurrences ?? []).filter((o) => {
      const cal = calendarById.get(o.event.calendar_id);
      const source = cal?.source ?? 'caldav';
      return !hiddenSources.has(source);
    });
  }, [occurrences, calendarById, hiddenSources]);

  const panelState: PanelState = loading ? 'loading' : error ? 'error' : visibleOccurrences.length === 0 ? 'empty' : 'filled';

  const rangeTitle = useMemo(() => {
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    if (view === 'month') {
      return anchor.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    }
    if (view === 'day') {
      return anchor.toLocaleDateString('en-US', { ...opts, year: 'numeric', timeZone: 'UTC' });
    }
    const from = new Date(range.from);
    const to = addDays(new Date(range.from), 6);
    return `${from.toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' })} – ${to.toLocaleDateString('en-US', { day: 'numeric', timeZone: 'UTC' })}, ${from.getUTCFullYear()}`;
  }, [view, anchor, range.from]);

  const goToday = () => setAnchor(new Date());
  const goPrev = () => {
    if (view === 'month') setAnchor((d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));
    else if (view === 'week') setAnchor((d) => addDays(d, -7));
    else setAnchor((d) => addDays(d, -1));
  };
  const goNext = () => {
    if (view === 'month') setAnchor((d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
    else if (view === 'week') setAnchor((d) => addDays(d, 7));
    else setAnchor((d) => addDays(d, 1));
  };

  const toggleSource = (s: CalendarSource) => {
    setHiddenSources((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const isWritable = (occ: Occurrence) => calendarById.get(occ.event.calendar_id)?.source === 'caldav';

  const handleDelete = async (occ: Occurrence) => {
    await api.del(`/api/modules/calendar/events/${occ.event.id}`);
    setSelected(null);
    await load();
  };

  const handleDuplicate = async (occ: Occurrence) => {
    await api.post('/api/modules/calendar/events', {
      summary: `${occ.event.summary} (copy)`,
      description: occ.event.description,
      location: occ.event.location,
      dtstart: occ.event.dtstart,
      dtend: occ.event.dtend,
      allDay: occ.event.all_day,
    });
    await load();
  };

  const handleCreate = async (form: { summary: string; dtstart: string; dtend: string; location: string }) => {
    await api.post('/api/modules/calendar/events', form);
    setCreating(false);
    await load();
  };

  const handleSaveEdit = async (occ: Occurrence, form: { summary: string; location: string; description: string }) => {
    await api.put(`/api/modules/calendar/events/${occ.event.id}`, form);
    setEditing(false);
    setSelected(null);
    await load();
  };

  return (
    <section aria-label="calendar-panel" className="cal-scope" data-theme={theme}>
      <style>{`
        .cal-scope[data-theme="dark"] {
          --cal-app: #050A14; --cal-panel: #0a101c; --cal-elev: #101827; --cal-elev2: #182234;
          --cal-line: rgba(255,255,255,.08); --cal-line2: rgba(255,255,255,.14);
          --cal-tx1: #e7edf5; --cal-tx2: #9aa7bb; --cal-tx3: #66748a;
          --cal-acc: #00D4FF; --cal-acc-h: #33ddff; --cal-acc-soft: rgba(0,212,255,.16); --cal-acc-line: rgba(0,212,255,.4);
          --cal-success: #00C896; --cal-danger: #FF4757;
          --cal-src-caldav: #7B5EA7; --cal-src-google: #F5A623; --cal-src-ics: #00D4FF;
          color: var(--cal-tx1);
        }
        .cal-scope[data-theme="light"] {
          --cal-app: #E9EEF6; --cal-panel: #ffffff; --cal-elev: #f2f5fa; --cal-elev2: #e7ecf5;
          --cal-line: rgba(12,20,34,.08); --cal-line2: rgba(12,20,34,.14);
          --cal-tx1: #0f1626; --cal-tx2: #4d5a70; --cal-tx3: #7c879b;
          --cal-acc: #0091ad; --cal-acc-h: #007891; --cal-acc-soft: rgba(0,145,173,.1); --cal-acc-line: rgba(0,145,173,.32);
          --cal-success: #059669; --cal-danger: #e11d48;
          --cal-src-caldav: #7B5EA7; --cal-src-google: #b5790e; --cal-src-ics: #0091ad;
          color: var(--cal-tx1);
        }
        .cal-scope .cal-mono { font-family: var(--font-mono, ui-monospace, monospace); }
        @keyframes calScan { 0% { transform: translateX(-120%); } 100% { transform: translateX(420%); } }
      `}</style>

      {/* ── Toolbar ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <button onClick={goToday} style={toolbarBtnStyle()}>{_('calendar.today')}</button>
        <button aria-label="previous" onClick={goPrev} style={iconBtnStyle()}>
          <ChevronLeft className="w-4 h-4" />
        </button>
        <button aria-label="next" onClick={goNext} style={iconBtnStyle()}>
          <ChevronRight className="w-4 h-4" />
        </button>
        <span className="cal-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--cal-tx1)' }}>{rangeTitle}</span>

        <span style={{ flex: 1 }} />

        {/* Source chips */}
        {SOURCE_ORDER.map((s) => (
          <button
            key={s}
            data-testid={`source-chip-${s}`}
            onClick={() => toggleSource(s)}
            aria-pressed={!hiddenSources.has(s)}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 5, padding: '4px 9px', borderRadius: 999,
              border: `1px solid ${hiddenSources.has(s) ? 'var(--cal-line2)' : SOURCE_COLOR[s]}`,
              background: hiddenSources.has(s) ? 'transparent' : 'var(--cal-elev)',
              color: hiddenSources.has(s) ? 'var(--cal-tx3)' : 'var(--cal-tx1)',
              fontSize: 11, cursor: 'pointer', opacity: hiddenSources.has(s) ? 0.55 : 1,
            }}
          >
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: SOURCE_COLOR[s] }} />
            {_(`calendar.source.${s}`)}
            {s !== 'caldav' && <Lock className="w-3 h-3" aria-label={_('calendar.readOnly')} />}
          </button>
        ))}

        {/* Sync pill */}
        <span className="cal-mono" style={{ fontSize: 10.5, color: 'var(--cal-tx3)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          {loading ? _('calendar.sync.syncing') : _('calendar.sync.synced')}
        </span>

        {/* View tabs */}
        <div style={{ display: 'flex', gap: 2 }}>
          {(['month', 'week', 'day'] as ViewMode[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              style={{
                padding: '6px 10px', borderRadius: 7, border: 'none', cursor: 'pointer', fontSize: 12,
                fontWeight: view === v ? 700 : 500,
                background: view === v ? 'var(--cal-elev2)' : 'transparent',
                color: view === v ? 'var(--cal-tx1)' : 'var(--cal-tx3)',
              }}
            >
              {_(`calendar.view.${v}`)}
            </button>
          ))}
        </div>

        <button onClick={() => setCreating(true)} style={{ ...toolbarBtnStyle(), display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <Plus className="w-3.5 h-3.5" /> {_('calendar.newEvent')}
        </button>
        <button aria-label="refresh" onClick={() => void load()} style={iconBtnStyle()}>
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ── LOADING (syncing) ── */}
      {panelState === 'loading' && (
        <div role="status" aria-live="polite" style={{ position: 'relative', overflow: 'hidden', background: 'var(--cal-panel)', border: '1px solid var(--cal-acc-line)', borderRadius: 14, padding: '22px 20px' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, height: 2, width: '26%', background: 'linear-gradient(90deg,transparent,var(--cal-acc),transparent)', animation: 'calScan 0.85s linear infinite' }} />
          <div className="cal-mono" style={{ color: 'var(--cal-acc-h)', fontSize: 12 }}>{_('calendar.state.loading')}</div>
        </div>
      )}

      {/* ── ERROR ── */}
      {panelState === 'error' && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(255,71,87,0.08)', border: '1px solid var(--cal-danger)', borderRadius: 12, padding: '16px 18px', color: 'var(--cal-danger)' }}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span style={{ flex: 1, fontSize: 13 }}>{_('calendar.state.error')}</span>
          <button onClick={() => void load()} style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'var(--cal-acc-h)', border: '1px solid var(--cal-acc-line)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
            <RefreshCw className="w-3.5 h-3.5" /> {_('calendar.retry')}
          </button>
        </div>
      )}

      {/* ── EMPTY ── */}
      {panelState === 'empty' && (
        <div style={{ textAlign: 'center', color: 'var(--cal-tx3)', background: 'var(--cal-panel)', border: '1px solid var(--cal-line)', borderRadius: 12, padding: '40px 20px', fontSize: 13 }}>
          <CalendarDays className="w-6 h-6" style={{ margin: '0 auto 10px', color: 'var(--cal-tx3)' }} />
          <div style={{ marginBottom: 12 }}>{_('calendar.state.empty.title')}</div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
            <button onClick={() => setCreating(true)} style={toolbarBtnStyle()}>{_('calendar.state.empty.create')}</button>
            <button style={toolbarBtnStyle()}>{_('calendar.state.empty.import')}</button>
          </div>
        </div>
      )}

      {/* ── FILLED: body ── */}
      {panelState === 'filled' && view === 'month' && (
        <MonthGrid range={range} occurrences={visibleOccurrences} calendarById={calendarById} onSelect={setSelected} _={_} />
      )}
      {panelState === 'filled' && (view === 'week' || view === 'day') && (
        <TimeGrid
          view={view}
          range={range}
          occurrences={visibleOccurrences}
          calendarById={calendarById}
          onSelect={setSelected}
        />
      )}

      {/* ── Create form ── */}
      {creating && (
        <CreateEventForm onCancel={() => setCreating(false)} onSubmit={handleCreate} _={_} />
      )}

      {/* ── Drawer ── */}
      {selected && (
        <EventDrawer
          occ={selected}
          calendar={calendarById.get(selected.event.calendar_id)}
          writable={isWritable(selected)}
          editing={editing}
          onClose={() => { setSelected(null); setEditing(false); }}
          onDelete={() => void handleDelete(selected)}
          onDuplicate={() => void handleDuplicate(selected)}
          onStartEdit={() => setEditing(true)}
          onCancelEdit={() => setEditing(false)}
          onSaveEdit={(form) => void handleSaveEdit(selected, form)}
          _={_}
        />
      )}
    </section>
  );
}

function toolbarBtnStyle(): CSSProperties {
  return {
    background: 'transparent', color: 'var(--cal-tx2)', border: '1px solid var(--cal-line2)',
    borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
  };
}
function iconBtnStyle(): CSSProperties {
  return {
    background: 'transparent', color: 'var(--cal-tx2)', border: '1px solid var(--cal-line2)',
    borderRadius: 7, padding: '6px 8px', fontSize: 12, cursor: 'pointer',
  };
}

// ── Month grid (6x7) ──────────────────────────────────────────────────────────

function MonthGrid({
  range, occurrences, calendarById, onSelect, _,
}: {
  range: { from: string; to: string };
  occurrences: Occurrence[];
  calendarById: Map<string, CalendarRecord>;
  onSelect: (o: Occurrence) => void;
  _: Tr;
}) {
  const gridStart = new Date(range.from);
  const today = isoDate(new Date());
  const anchorMonth = addDays(gridStart, 10).getUTCMonth(); // any day well inside the visible month

  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const byDay = new Map<string, Occurrence[]>();
  for (const occ of occurrences) {
    const key = occ.start.slice(0, 10);
    const list = byDay.get(key) ?? [];
    list.push(occ);
    byDay.set(key, list);
  }

  return (
    <div role="grid" aria-label="month-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--cal-line)', border: '1px solid var(--cal-line)', borderRadius: 10, overflow: 'hidden' }}>
      {cells.map((d, i) => {
        const key = isoDate(d);
        const dayOccs = byDay.get(key) ?? [];
        const isOtherMonth = d.getUTCMonth() !== anchorMonth;
        const isWeekend = d.getUTCDay() === 0 || d.getUTCDay() === 6;
        const isToday = key === today;
        return (
          <div
            key={i}
            role="gridcell"
            data-day-cell={key}
            style={{
              background: isOtherMonth ? 'var(--cal-elev)' : isWeekend ? 'var(--cal-elev)' : 'var(--cal-panel)',
              minHeight: 92, padding: 6, opacity: isOtherMonth ? 0.5 : 1,
            }}
          >
            <span
              className="cal-mono"
              style={{
                fontSize: 11, color: isToday ? 'var(--cal-app)' : 'var(--cal-tx2)',
                background: isToday ? 'var(--cal-acc)' : 'transparent',
                borderRadius: 999, padding: isToday ? '1px 6px' : 0, fontWeight: isToday ? 700 : 400,
              }}
            >
              {d.getUTCDate()}
            </span>
            <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 2 }}>
              {dayOccs.slice(0, 3).map((occ) => {
                const cal = calendarById.get(occ.event.calendar_id);
                return (
                  <button
                    key={occ.event.id + occ.start}
                    onClick={() => onSelect(occ)}
                    style={{
                      textAlign: 'left', fontSize: 10.5, padding: '2px 5px', borderRadius: 5, border: 'none',
                      cursor: 'pointer', background: 'var(--cal-elev2)', color: 'var(--cal-tx1)',
                      borderLeft: `3px solid ${cal ? SOURCE_COLOR[cal.source] : 'var(--cal-src-caldav)'}`,
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}
                  >
                    {occ.event.summary}
                  </button>
                );
              })}
              {dayOccs.length > 3 && (
                <span className="cal-mono" style={{ fontSize: 10, color: 'var(--cal-tx3)' }}>
                  +{dayOccs.length - 3} {_('calendar.moreEvents')}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Week/Day time-grid (simplified — see file-header deviation note) ─────────

const HOUR_START = 7;
const HOUR_END = 21;
const HOUR_PX = 44;

function TimeGrid({
  view, range, occurrences, calendarById, onSelect,
}: {
  view: 'week' | 'day';
  range: { from: string; to: string };
  occurrences: Occurrence[];
  calendarById: Map<string, CalendarRecord>;
  onSelect: (o: Occurrence) => void;
}) {
  const days = view === 'day' ? [new Date(range.from)] : Array.from({ length: 7 }, (_, i) => addDays(new Date(range.from), i));
  const byDay = new Map<string, Occurrence[]>();
  for (const occ of occurrences) {
    const key = occ.start.slice(0, 10);
    const list = byDay.get(key) ?? [];
    list.push(occ);
    byDay.set(key, list);
  }
  const hours = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);

  return (
    <div role="grid" aria-label={`${view}-grid`} style={{ display: 'flex', border: '1px solid var(--cal-line)', borderRadius: 10, overflow: 'hidden', background: 'var(--cal-panel)' }}>
      <div style={{ width: 44, flexShrink: 0, borderRight: '1px solid var(--cal-line)' }}>
        <div style={{ height: 22 }} />
        {hours.map((h) => (
          <div key={h} className="cal-mono" style={{ height: HOUR_PX, fontSize: 9.5, color: 'var(--cal-tx3)', padding: '2px 4px' }}>
            {h}:00
          </div>
        ))}
      </div>
      {days.map((d) => {
        const key = isoDate(d);
        const dayOccs = (byDay.get(key) ?? []).filter((o) => !o.event.all_day);
        const allDayOccs = (byDay.get(key) ?? []).filter((o) => o.event.all_day);
        return (
          <div key={key} style={{ flex: 1, borderRight: '1px solid var(--cal-line)', position: 'relative' }} data-day-column={key}>
            <div className="cal-mono" style={{ height: 22, fontSize: 10.5, textAlign: 'center', color: 'var(--cal-tx2)', borderBottom: '1px solid var(--cal-line)' }}>
              {d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', timeZone: 'UTC' })}
            </div>
            {allDayOccs.map((occ) => {
              const cal = calendarById.get(occ.event.calendar_id);
              return (
                <button key={occ.event.id} onClick={() => onSelect(occ)} style={{ display: 'block', width: '100%', textAlign: 'left', fontSize: 10, padding: '2px 6px', border: 'none', cursor: 'pointer', background: 'var(--cal-elev2)', color: 'var(--cal-tx1)', borderLeft: `3px solid ${cal ? SOURCE_COLOR[cal.source] : 'var(--cal-src-caldav)'}` }}>
                  {occ.event.summary}
                </button>
              );
            })}
            <div style={{ position: 'relative', height: hours.length * HOUR_PX }}>
              {dayOccs.map((occ) => {
                const cal = calendarById.get(occ.event.calendar_id);
                const startH = new Date(occ.start).getUTCHours() + new Date(occ.start).getUTCMinutes() / 60;
                const endH = new Date(occ.end).getUTCHours() + new Date(occ.end).getUTCMinutes() / 60;
                const top = Math.max(0, (startH - HOUR_START) * HOUR_PX);
                const height = Math.max(18, (endH - startH) * HOUR_PX);
                return (
                  <button
                    key={occ.event.id + occ.start}
                    onClick={() => onSelect(occ)}
                    style={{
                      position: 'absolute', top, height, left: 2, right: 2, borderRadius: 5, border: 'none',
                      cursor: 'pointer', fontSize: 10.5, textAlign: 'left', padding: '3px 6px', overflow: 'hidden',
                      background: 'var(--cal-elev2)', color: 'var(--cal-tx1)',
                      borderLeft: `3px solid ${cal ? SOURCE_COLOR[cal.source] : 'var(--cal-src-caldav)'}`,
                    }}
                  >
                    {occ.event.summary}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Drawer ────────────────────────────────────────────────────────────────────

function EventDrawer({
  occ, calendar, writable, editing, onClose, onDelete, onDuplicate, onStartEdit, onCancelEdit, onSaveEdit, _,
}: {
  occ: Occurrence;
  calendar: CalendarRecord | undefined;
  writable: boolean;
  editing: boolean;
  onClose: () => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (form: { summary: string; location: string; description: string }) => void;
  _: Tr;
}) {
  const [summary, setSummary] = useState(occ.event.summary);
  const [location, setLocation] = useState(occ.event.location);
  const [description, setDescription] = useState(occ.event.description);
  const source = calendar?.source ?? 'caldav';

  return (
    <aside
      aria-label="event-drawer"
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 320, background: 'var(--cal-panel)',
        borderLeft: '1px solid var(--cal-line2)', padding: 18, overflowY: 'auto', zIndex: 40,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--cal-tx1)' }}>{occ.event.summary}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <span className="cal-mono" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: 'var(--cal-elev)', color: SOURCE_COLOR[source] }}>
              {_(`calendar.source.${source}`)}
            </span>
            {!writable && (
              <span className="cal-mono" style={{ fontSize: 10, padding: '2px 7px', borderRadius: 999, background: 'var(--cal-elev)', color: 'var(--cal-tx3)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <Lock className="w-3 h-3" /> {_('calendar.readOnly')}
              </span>
            )}
          </div>
        </div>
        <button aria-label="close" onClick={onClose} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--cal-tx3)' }}>
          <X className="w-4 h-4" />
        </button>
      </div>

      {!editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
          <Row label={_('calendar.drawer.when')} value={`${new Date(occ.start).toLocaleString()} → ${new Date(occ.end).toLocaleString()}`} />
          <Row label={_('calendar.drawer.timezone')} value={occ.event.tzid} />
          {occ.event.rrule && <Row label={_('calendar.drawer.recurrence')} value={`${humanizeRRuleLocal(occ.event.rrule)}  ·  ${occ.event.rrule}`} />}
          {occ.event.reminder_offset_sec !== null && (
            <Row label={_('calendar.drawer.reminder')} value={`${Math.abs(occ.event.reminder_offset_sec) / 60} min before`} />
          )}
          {occ.event.location && <Row label={_('calendar.drawer.location')} value={occ.event.location} />}
          {occ.event.description && <Row label={_('calendar.drawer.notes')} value={occ.event.description} />}
        </div>
      )}

      {editing && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <input aria-label="summary" value={summary} onChange={(e) => setSummary(e.target.value)} style={inputStyle()} />
          <input aria-label="location" value={location} onChange={(e) => setLocation(e.target.value)} style={inputStyle()} placeholder={_('calendar.drawer.location')} />
          <textarea aria-label="notes" value={description} onChange={(e) => setDescription(e.target.value)} style={{ ...inputStyle(), minHeight: 60 }} placeholder={_('calendar.drawer.notes')} />
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => onSaveEdit({ summary, location, description })} style={{ ...toolbarBtnStyle(), color: 'var(--cal-success)' }}>{_('calendar.drawer.save')}</button>
            <button onClick={onCancelEdit} style={toolbarBtnStyle()}>{_('calendar.drawer.cancel')}</button>
          </div>
        </div>
      )}

      {!editing && (
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--cal-line)' }}>
          {writable ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={onDelete} style={{ ...toolbarBtnStyle(), color: 'var(--cal-danger)' }}>{_('calendar.drawer.delete')}</button>
              <button onClick={onDuplicate} style={toolbarBtnStyle()}>{_('calendar.drawer.duplicate')}</button>
              <button onClick={onStartEdit} style={toolbarBtnStyle()}>{_('calendar.drawer.edit')}</button>
            </div>
          ) : (
            <div style={{ fontSize: 11.5, color: 'var(--cal-tx3)' }}>{_('calendar.drawer.readonlyNote')}</div>
          )}
        </div>
      )}
    </aside>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="cal-mono" style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--cal-tx3)' }}>{label}</div>
      <div style={{ color: 'var(--cal-tx1)' }}>{value}</div>
    </div>
  );
}

function inputStyle(): CSSProperties {
  return {
    background: 'var(--cal-elev)', border: '1px solid var(--cal-line2)', borderRadius: 7,
    padding: '7px 10px', fontSize: 12.5, color: 'var(--cal-tx1)',
  };
}

// ── Create event form (minimal) ───────────────────────────────────────────────

function CreateEventForm({
  onCancel, onSubmit, _,
}: {
  onCancel: () => void;
  onSubmit: (form: { summary: string; dtstart: string; dtend: string; location: string }) => void;
  _: Tr;
}) {
  const [summary, setSummary] = useState('');
  const [dtstart, setDtstart] = useState('');
  const [dtend, setDtend] = useState('');
  const [location, setLocation] = useState('');

  return (
    <div role="dialog" aria-label="create-event" style={{ marginTop: 12, background: 'var(--cal-panel)', border: '1px solid var(--cal-acc-line)', borderRadius: 10, padding: 14, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <input aria-label="new-event-summary" placeholder={_('calendar.newEvent')} value={summary} onChange={(e) => setSummary(e.target.value)} style={inputStyle()} />
      <div style={{ display: 'flex', gap: 8 }}>
        <input aria-label="new-event-start" type="datetime-local" value={dtstart} onChange={(e) => setDtstart(e.target.value)} style={inputStyle()} />
        <input aria-label="new-event-end" type="datetime-local" value={dtend} onChange={(e) => setDtend(e.target.value)} style={inputStyle()} />
      </div>
      <input aria-label="new-event-location" placeholder={_('calendar.drawer.location')} value={location} onChange={(e) => setLocation(e.target.value)} style={inputStyle()} />
      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => onSubmit({
            summary,
            dtstart: dtstart ? new Date(dtstart).toISOString() : new Date().toISOString(),
            dtend: dtend ? new Date(dtend).toISOString() : new Date(Date.now() + 3_600_000).toISOString(),
            location,
          })}
          style={{ ...toolbarBtnStyle(), color: 'var(--cal-success)' }}
        >
          {_('calendar.drawer.save')}
        </button>
        <button onClick={onCancel} style={toolbarBtnStyle()}>{_('calendar.drawer.cancel')}</button>
      </div>
    </div>
  );
}
