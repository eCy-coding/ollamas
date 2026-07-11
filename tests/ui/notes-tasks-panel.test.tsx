// O5 NotesTasksPanel (docs/odyssey/handoff/notes-tasks/design.html) — ported UI.
// Data via apiClient.api.get('/api/modules/notes-tasks/{notes,tasks}'). Covers
// the 4 states (loading / error / empty / list) for both the Notes and Tasks
// tabs, text-based status/priority badges (a11y, PIPELINE-LESSONS #9 — no
// color-only signal), and the tab switch.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, fireEvent, within } from '@testing-library/react';
import { renderUI } from './helpers';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../src/lib/apiClient', () => ({ api: { get } }));

import NotesTasksPanel from '../../src/components/NotesTasksPanel';

const note = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  title: 'Weekly review checklist',
  body: '# Weekly review checklist\n\n- [ ] Ship something',
  tags: ['ritual'],
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-02T00:00:00.000Z',
  ...over,
});

const task = (over: Record<string, unknown> = {}) => ({
  id: 't1',
  title: 'Ship the scheduler',
  detail: '',
  status: 'todo',
  priority: 'high',
  due_at: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

function mockRoutes(notes: unknown[], tasks: unknown[]) {
  get.mockImplementation(async (endpoint?: string) => {
    // Providers (theme/i18n) may hit api.get on mount — tolerate non-panel calls.
    if (typeof endpoint !== 'string') return {};
    if (endpoint.includes('/tasks')) return { tasks };
    if (endpoint.includes('/notes')) return { notes };
    throw new Error(`unexpected endpoint ${endpoint}`);
  });
}

describe('NotesTasksPanel — 4 states (loading/error/empty/list) + tab switch', () => {
  beforeEach(() => get.mockReset());

  it('loading: shows a status indicator before data resolves', async () => {
    // Panel fires notes+tasks concurrently via Promise.all; hold /notes pending to
    // keep the loading state, but resolve /tasks so Promise.all can settle on release.
    let resolveNotes!: (v: unknown) => void;
    get.mockImplementation((endpoint?: string) => {
      if (typeof endpoint !== 'string') return Promise.resolve({});
      if (endpoint.includes('/tasks')) return Promise.resolve({ tasks: [] });
      return new Promise((r) => { resolveNotes = r; });
    });
    renderUI(<NotesTasksPanel />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    resolveNotes({ notes: [note()] });
    await waitFor(() => expect(screen.getByText('Weekly review checklist')).toBeInTheDocument());
  });

  it('list (notes tab, default): renders note titles from the backend', async () => {
    mockRoutes([note(), note({ id: 'n2', title: 'Reading queue' })], [task()]);
    renderUI(<NotesTasksPanel />);
    await waitFor(() => expect(screen.getByText('Weekly review checklist')).toBeInTheDocument());
    expect(screen.getByText('Reading queue')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/modules/notes-tasks/notes');
  });

  it('tab switch: clicking Tasks renders tasks with TEXT status + priority badges (a11y)', async () => {
    mockRoutes([note()], [task(), task({ id: 't2', title: 'Fix flaky test', status: 'done', priority: 'low' })]);
    renderUI(<NotesTasksPanel />);
    await waitFor(() => expect(screen.getByText('Weekly review checklist')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /tasks/i }));
    await waitFor(() => expect(screen.getByText('Ship the scheduler')).toBeInTheDocument());
    expect(screen.getByText('Fix flaky test')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/api/modules/notes-tasks/tasks');

    // status/priority are WORDS, not just color (a11y) — text-based badge (lesson #9).
    const row = screen.getByText('Ship the scheduler').closest('[data-task-row]') as HTMLElement;
    expect(within(row).getByText(/to do/i)).toBeInTheDocument();
    expect(within(row).getByText(/high/i)).toBeInTheDocument();
  });

  it('error: rejected fetch → error banner + a retry that re-fetches', async () => {
    get.mockRejectedValue(new Error('offline'));
    renderUI(<NotesTasksPanel />);
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());

    mockRoutes([note()], [task()]);
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText('Weekly review checklist')).toBeInTheDocument());
  });

  it('empty: no notes and no tasks → honest empty message per tab (no fabricated rows)', async () => {
    mockRoutes([], []);
    renderUI(<NotesTasksPanel />);
    await waitFor(() => expect(screen.getByText(/no notes/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /tasks/i }));
    await waitFor(() => expect(screen.getByText(/no tasks/i)).toBeInTheDocument());
  });
});
