// O5 NotesTasksPanel (docs/odyssey/handoff/notes-tasks/design.html) — ported UI.
// Data via apiClient (/api/modules/notes-tasks/{notes,tasks}) — never a
// hard-coded list. Ported, not copied verbatim (Golden Rule): design.html's
// `.np[data-theme=dark|light]` token set becomes a COMPONENT-SCOPED `.nt-scope`
// class (PIPELINE-LESSONS #10), driven by the app's real useTheme() so the
// panel flips with the rest of the app instead of carrying its own toggle.
// FONTS: Inter/JetBrains Mono are referenced via `var(--font-*, fallback)` —
// no Google @import here (PWA/CSP, lesson #11); the panel falls back to the
// existing font stack until the shared self-host step lands.
import { useCallback, useEffect, useState } from 'react';
import { useLingui } from '@lingui/react';
import { RefreshCw, AlertTriangle, NotebookPen, ListChecks } from 'lucide-react';
import { api } from '../lib/apiClient';
import { useTheme } from '../lib/theme';

interface NoteRecord {
  id: string;
  title: string;
  body: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

type TaskStatus = 'todo' | 'running' | 'done' | 'failed';
type TaskPriority = 'high' | 'med' | 'low';

interface TaskRecord {
  id: string;
  title: string;
  detail: string;
  status: TaskStatus;
  priority: TaskPriority;
  due_at: string | null;
  created_at: string;
  updated_at: string;
}

type Mode = 'notes' | 'tasks';
type Tr = (id: string) => string;

const STATUS_VAR: Record<TaskStatus, string> = {
  todo: 'var(--s-todo)',
  running: 'var(--s-run)',
  done: 'var(--s-done)',
  failed: 'var(--s-fail)',
};

const PRIORITY_VAR: Record<TaskPriority, string> = {
  high: 'var(--p-high)',
  med: 'var(--p-med)',
  low: 'var(--p-low)',
};

export default function NotesTasksPanel() {
  const { _: rawT } = useLingui();
  const _: Tr = (id: string) => rawT(id);
  const { theme } = useTheme();

  const [mode, setMode] = useState<Mode>('notes');
  const [notes, setNotes] = useState<NoteRecord[] | null>(null);
  const [tasks, setTasks] = useState<TaskRecord[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const notesReq = api.get('/api/modules/notes-tasks/notes') as Promise<{ notes: NoteRecord[] }>;
      const tasksReq = api.get('/api/modules/notes-tasks/tasks') as Promise<{ tasks: TaskRecord[] }>;
      const [n, t] = await Promise.all([notesReq, tasksReq]);
      setNotes(n.notes);
      setTasks(t.tasks);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statusLabel = (s: TaskStatus) => _(`notesTasks.status.${s}`);
  const priorityLabel = (p: TaskPriority) => _(`notesTasks.priority.${p}`);

  return (
    <section aria-label="notes-tasks-panel" className="nt-scope" data-theme={theme}>
      <style>{`
        .nt-scope[data-theme="dark"] {
          --nt-app: #0a0b10; --nt-panel: #0e0f16; --nt-elev: #14151d; --nt-elev2: #1c1d27;
          --nt-line: rgba(255,255,255,.08); --nt-line2: rgba(255,255,255,.14);
          --nt-tx1: #e7e8ef; --nt-tx2: #9a9cab; --nt-tx3: #676a7a;
          --nt-acc: #6366f1; --nt-acc-h: #818cf8; --nt-acc-soft: rgba(99,102,241,.16); --nt-acc-line: rgba(99,102,241,.4);
          --p-high: #fb7185; --p-med: #fbbf24; --p-low: #94a3b8;
          --s-todo: #94a3b8; --s-run: #818cf8; --s-done: #34d399; --s-fail: #fb7185;
          --nt-danger: #fb7185;
          color: var(--nt-tx1);
        }
        .nt-scope[data-theme="light"] {
          --nt-app: #e9ebf1; --nt-panel: #ffffff; --nt-elev: #f5f6f9; --nt-elev2: #eceef4;
          --nt-line: rgba(12,14,22,.08); --nt-line2: rgba(12,14,22,.14);
          --nt-tx1: #15161e; --nt-tx2: #565a6c; --nt-tx3: #8b8f9f;
          --nt-acc: #6366f1; --nt-acc-h: #4f46e5; --nt-acc-soft: rgba(99,102,241,.1); --nt-acc-line: rgba(99,102,241,.32);
          --p-high: #f43f5e; --p-med: #d97706; --p-low: #94a3b8;
          --s-todo: #94a3b8; --s-run: #6366f1; --s-done: #059669; --s-fail: #e11d48;
          --nt-danger: #e11d48;
          color: var(--nt-tx1);
        }
        .nt-scope .nt-mono { font-family: var(--font-mono, ui-monospace, monospace); }
        .nt-scope .nt-eyebrow { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; font-weight: 600; }
        @keyframes ntScan { 0% { transform: translateX(-120%); } 100% { transform: translateX(420%); } }
      `}</style>

      {/* ── Tab switch (Notes / Tasks) ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
        <button
          onClick={() => setMode('notes')}
          aria-pressed={mode === 'notes'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7,
            border: 'none', cursor: 'pointer', fontWeight: mode === 'notes' ? 700 : 500, fontSize: 12.5,
            background: mode === 'notes' ? 'var(--nt-elev2)' : 'transparent',
            color: mode === 'notes' ? 'var(--nt-tx1)' : 'var(--nt-tx3)',
          }}
        >
          <NotebookPen className="w-3.5 h-3.5" /> {_('notesTasks.tab.notes')}
        </button>
        <button
          onClick={() => setMode('tasks')}
          aria-pressed={mode === 'tasks'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 7,
            border: 'none', cursor: 'pointer', fontWeight: mode === 'tasks' ? 700 : 500, fontSize: 12.5,
            background: mode === 'tasks' ? 'var(--nt-elev2)' : 'transparent',
            color: mode === 'tasks' ? 'var(--nt-tx1)' : 'var(--nt-tx3)',
          }}
        >
          <ListChecks className="w-3.5 h-3.5" /> {_('notesTasks.tab.tasks')}
        </button>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => void load()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'var(--nt-tx2)',
            border: '1px solid var(--nt-line2)', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
          }}
        >
          <RefreshCw className="w-3.5 h-3.5" /> {_('notesTasks.refresh')}
        </button>
      </div>

      {/* ── LOADING ── */}
      {loading && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'relative', overflow: 'hidden', background: 'var(--nt-panel)',
            border: '1px solid var(--nt-acc-line)', borderRadius: 14, padding: '22px 20px',
          }}
        >
          <div
            style={{
              position: 'absolute', top: 0, left: 0, height: 2, width: '26%',
              background: 'linear-gradient(90deg,transparent,var(--nt-acc),transparent)',
              animation: 'ntScan 0.85s linear infinite',
            }}
          />
          <div className="nt-mono" style={{ color: 'var(--nt-acc-h)', fontSize: 12 }}>
            {_('notesTasks.state.loading')}
          </div>
        </div>
      )}

      {/* ── ERROR ── */}
      {!loading && error && (
        <div
          role="alert"
          style={{
            display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(251,113,133,0.08)',
            border: '1px solid var(--nt-danger)', borderRadius: 12, padding: '16px 18px', color: 'var(--nt-danger)',
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span style={{ flex: 1, fontSize: 13 }}>{_('notesTasks.state.error')}</span>
          <button
            onClick={() => void load()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'var(--nt-acc-h)',
              border: '1px solid var(--nt-acc-line)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" /> {_('notesTasks.retry')}
          </button>
        </div>
      )}

      {/* ── NOTES tab ── */}
      {!loading && !error && mode === 'notes' && (
        notes && notes.length > 0 ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {notes.map((n) => (
              <li
                key={n.id}
                data-note-row
                style={{
                  background: 'var(--nt-panel)', border: '1px solid var(--nt-line2)', borderRadius: 10,
                  padding: '11px 13px',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: 13.5, color: 'var(--nt-tx1)' }}>{n.title}</div>
                {n.tags.length > 0 && (
                  <div className="nt-mono" style={{ fontSize: 10.5, color: 'var(--nt-tx3)', marginTop: 4 }}>
                    {n.tags.join(' · ')}
                  </div>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div
            style={{
              textAlign: 'center', color: 'var(--nt-tx3)', background: 'var(--nt-panel)',
              border: '1px solid var(--nt-line)', borderRadius: 12, padding: '40px 20px', fontSize: 13,
            }}
          >
            {_('notesTasks.state.emptyNotes')}
          </div>
        )
      )}

      {/* ── TASKS tab ── */}
      {!loading && !error && mode === 'tasks' && (
        tasks && tasks.length > 0 ? (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
            {tasks.map((t) => (
              <li
                key={t.id}
                data-task-row
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, background: 'var(--nt-panel)',
                  border: '1px solid var(--nt-line2)', borderRadius: 10, padding: '11px 13px',
                }}
              >
                <span style={{ flex: 1, minWidth: 0, fontWeight: 500, fontSize: 13, color: 'var(--nt-tx1)' }}>
                  {t.title}
                </span>
                {/* TEXT-based badges, not color-only (a11y, PIPELINE-LESSONS #9). */}
                <span
                  className="nt-mono"
                  style={{
                    fontSize: 10.5, fontWeight: 600, color: PRIORITY_VAR[t.priority],
                    background: 'var(--nt-elev)', border: '1px solid var(--nt-line2)', borderRadius: 6, padding: '2px 7px',
                  }}
                >
                  {priorityLabel(t.priority)}
                </span>
                <span
                  style={{
                    fontSize: 10.5, fontWeight: 600, color: STATUS_VAR[t.status],
                    background: 'var(--nt-elev)', border: '1px solid var(--nt-line2)', borderRadius: 999, padding: '2px 9px',
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                  }}
                >
                  <span style={{ width: 6, height: 6, borderRadius: '50%', background: STATUS_VAR[t.status] }} />
                  {statusLabel(t.status)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div
            style={{
              textAlign: 'center', color: 'var(--nt-tx3)', background: 'var(--nt-panel)',
              border: '1px solid var(--nt-line)', borderRadius: 12, padding: '40px 20px', fontSize: 13,
            }}
          >
            {_('notesTasks.state.emptyTasks')}
          </div>
        )
      )}
    </section>
  );
}
