// O6 CalendarPanel (docs/odyssey/05-features/calendar-caldav.md) — ported UI.
// Data via apiClient.api.get('/api/modules/calendar/{calendars,events}'). Covers
// the 4 states (syncing/loading, error, empty, filled), the month/week/day view
// switch, source-chip toggling, and the event drawer (writable vs read-only).
// TEST-MOCK note (PIPELINE-LESSONS handoff): `get` must tolerate a non-string
// endpoint arg — provider mounts (theme/i18n) may call api.get during effects
// unrelated to this panel.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderUI } from './helpers';

const { get, post, put, del } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
}));
vi.mock('../../src/lib/apiClient', () => ({ api: { get, post, put, del } }));

import CalendarPanel from '../../src/components/CalendarPanel';

const calendar = (over: Record<string, unknown> = {}) => ({
  id: 'cal-1',
  name: 'My Calendar',
  color: '#7B5EA7',
  source: 'caldav',
  read_only: false,
  ...over,
});

const event = (over: Record<string, unknown> = {}) => ({
  id: 'ev-1',
  calendar_id: 'cal-1',
  summary: 'Team sync',
  description: 'Weekly planning',
  location: 'Room 4',
  dtstart: '2026-07-06T09:00:00.000Z',
  dtend: '2026-07-06T09:30:00.000Z',
  all_day: false,
  tzid: 'UTC',
  rrule: null,
  reminder_offset_sec: null,
  ...over,
});

const occurrence = (ev: ReturnType<typeof event>) => ({ event: ev, start: ev.dtstart, end: ev.dtend });

function mockRoutes(calendars: unknown[], occurrences: unknown[]) {
  get.mockImplementation(async (endpoint?: string) => {
    // Providers (theme/i18n) may hit api.get on mount — tolerate non-panel calls.
    if (typeof endpoint !== 'string') return {};
    if (endpoint.includes('/calendars')) return { calendars };
    if (endpoint.includes('/events')) return { occurrences };
    throw new Error(`unexpected endpoint ${endpoint}`);
  });
}

describe('CalendarPanel — 4 states + view switch + source chips + drawer', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    put.mockReset();
    del.mockReset();
    // CalendarPanel defaults its view anchor to `new Date()` (real wall clock).
    // The fixture events below are pinned to 2026-07-06 — fake only `Date` (not
    // timers) so the default week/month/day view renders the same range the
    // fixtures were authored against, independent of the real system date.
    // `waitFor`/`fireEvent` still use real timers and keep working normally.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-07-06T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('loading/syncing: shows a status indicator before data resolves', async () => {
    let resolveEvents!: (v: unknown) => void;
    get.mockImplementation((endpoint?: string) => {
      if (typeof endpoint !== 'string') return Promise.resolve({});
      if (endpoint.includes('/calendars')) return Promise.resolve({ calendars: [calendar()] });
      return new Promise((r) => { resolveEvents = r; });
    });
    renderUI(<CalendarPanel />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    resolveEvents({ occurrences: [occurrence(event())] });
    await waitFor(() => expect(screen.getByText('Team sync')).toBeInTheDocument());
  });

  it('filled (week view, default): renders event chips from the backend', async () => {
    mockRoutes([calendar()], [occurrence(event())]);
    renderUI(<CalendarPanel />);
    await waitFor(() => expect(screen.getByText('Team sync')).toBeInTheDocument());
    expect(get).toHaveBeenCalledWith(expect.stringContaining('/api/modules/calendar/calendars'));
  });

  it('view switch: clicking Month renders the 42-cell month grid', async () => {
    mockRoutes([calendar()], [occurrence(event())]);
    renderUI(<CalendarPanel />);
    await waitFor(() => expect(screen.getByText('Team sync')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    await waitFor(() => expect(screen.getByRole('grid', { name: 'month-grid' })).toBeInTheDocument());
    const grid = screen.getByRole('grid', { name: 'month-grid' });
    expect(within(grid).getAllByRole('gridcell')).toHaveLength(42);
  });

  it('view switch: clicking Day renders the single-column day grid', async () => {
    mockRoutes([calendar()], [occurrence(event())]);
    renderUI(<CalendarPanel />);
    await waitFor(() => expect(screen.getByText('Team sync')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    await waitFor(() => expect(screen.getByRole('grid', { name: 'day-grid' })).toBeInTheDocument());
  });

  it('error: rejected fetch → error banner + a retry that re-fetches', async () => {
    get.mockRejectedValue(new Error('offline'));
    renderUI(<CalendarPanel />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByText(/can't reach caldav/i)).toBeInTheDocument();

    mockRoutes([calendar()], [occurrence(event())]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('Team sync')).toBeInTheDocument());
  });

  it('empty: no occurrences in range → honest empty-state card with Create/Import actions', async () => {
    mockRoutes([calendar()], []);
    renderUI(<CalendarPanel />);
    await waitFor(() => expect(screen.getByText(/your week is clear/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /create event/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /import \.ics/i })).toBeInTheDocument();
  });

  it('source chips: text-labeled, read-only sources carry a lock (a11y — not color-only)', async () => {
    mockRoutes([calendar()], [occurrence(event())]);
    renderUI(<CalendarPanel />);
    await waitFor(() => expect(screen.getByText('Team sync')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /caldav/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /google/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ics feed/i })).toBeInTheDocument();
  });

  it('source chips: toggling a source hides its events from the grid', async () => {
    const googleCal = calendar({ id: 'cal-g', source: 'google', read_only: true });
    const googleEvent = event({ id: 'ev-g', calendar_id: 'cal-g', summary: 'Google-only event' });
    mockRoutes([calendar(), googleCal], [occurrence(event()), occurrence(googleEvent)]);
    renderUI(<CalendarPanel />);
    await waitFor(() => expect(screen.getByText('Google-only event')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('source-chip-google'));
    await waitFor(() => expect(screen.queryByText('Google-only event')).not.toBeInTheDocument());
    expect(screen.getByText('Team sync')).toBeInTheDocument(); // caldav event unaffected
  });

  it('drawer: clicking a writable (caldav) event shows Delete/Duplicate/Edit', async () => {
    mockRoutes([calendar()], [occurrence(event())]);
    renderUI(<CalendarPanel />);
    await waitFor(() => expect(screen.getByText('Team sync')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Team sync'));
    const drawer = await screen.findByRole('complementary', { name: 'event-drawer' });
    expect(within(drawer).getByRole('button', { name: /delete/i })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /duplicate/i })).toBeInTheDocument();
    expect(within(drawer).getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
  });

  it('drawer: clicking a read-only (ics) event shows the read-only badge + duplicate-to-edit note, no Delete', async () => {
    const icsCal = calendar({ id: 'cal-ics', source: 'ics', read_only: true });
    const icsEvent = event({ id: 'ev-ics', calendar_id: 'cal-ics', summary: 'Subscribed holiday' });
    mockRoutes([icsCal], [occurrence(icsEvent)]);
    renderUI(<CalendarPanel />);
    await waitFor(() => expect(screen.getByText('Subscribed holiday')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Subscribed holiday'));
    const drawer = await screen.findByRole('complementary', { name: 'event-drawer' });
    expect(within(drawer).getByText(/read-only/i)).toBeInTheDocument();
    expect(within(drawer).getByText(/duplicate to your calendar to edit/i)).toBeInTheDocument();
    expect(within(drawer).queryByRole('button', { name: /delete/i })).not.toBeInTheDocument();
  });

  it('drawer: Delete calls the DELETE endpoint and closes the drawer', async () => {
    mockRoutes([calendar()], [occurrence(event())]);
    del.mockResolvedValue({ ok: true });
    renderUI(<CalendarPanel />);
    await waitFor(() => expect(screen.getByText('Team sync')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Team sync'));
    const drawer = await screen.findByRole('complementary', { name: 'event-drawer' });
    fireEvent.click(within(drawer).getByRole('button', { name: /delete/i }));

    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/modules/calendar/events/ev-1'));
    await waitFor(() => expect(screen.queryByRole('complementary', { name: 'event-drawer' })).not.toBeInTheDocument());
  });

  it('new event: the create form POSTs to /events', async () => {
    mockRoutes([calendar()], [occurrence(event())]);
    post.mockResolvedValue({ id: 'ev-new' });
    renderUI(<CalendarPanel />);
    await waitFor(() => expect(screen.getByText('Team sync')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /new event/i }));
    const dialog = await screen.findByRole('dialog', { name: 'create-event' });
    fireEvent.change(within(dialog).getByLabelText('new-event-summary'), { target: { value: 'Dentist' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /save/i }));

    await waitFor(() => expect(post).toHaveBeenCalledWith(
      '/api/modules/calendar/events',
      expect.objectContaining({ summary: 'Dentist' }),
    ));
  });
});
