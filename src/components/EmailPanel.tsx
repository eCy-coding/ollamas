// O4 EmailPanel (docs/odyssey/handoff/email/design.html "MailPanel") — ported
// UI, not copied verbatim (Golden Rule). design.html's dark canvas token set
// (indigo #6366f1 accent, amber #f8b74d action / info #5cc8f5 waiting / muted
// #71738a archive) becomes a COMPONENT-SCOPED `.email-scope` class
// (PIPELINE-LESSONS #10), driven by the app's real useTheme() so the panel
// flips with the rest of the app instead of carrying its own toggle.
// FONTS: Inter/JetBrains Mono referenced via `var(--font-*, fallback)` — no
// Google @import (PWA/CSP, lesson #11).
// States (design.html showcase 1a-1e): notconnected / syncing / error /
// filled / compose. Triage labels are rendered as TEXT badges, not color-only
// (a11y, lesson #9) — "Action" / "Waiting" / "Archive", never a bare dot.
// Send (in the compose modal) is the ONE SMTP-privileged action — labeled
// explicitly so it never reads as a harmless button.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLingui } from '@lingui/react';
import { Mail, RefreshCw, AlertTriangle, Send, Sparkles, Inbox, X, Paperclip } from 'lucide-react';
import { api } from '../lib/apiClient';
import { useTheme } from '../lib/theme';

type TriageLabel = 'action' | 'waiting' | 'archive';

interface MessageRecord {
  id: string;
  folder: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  bodyText: string;
  bodyHtml: string | null;
  triage: TriageLabel;
  createdAt: string;
}

interface StatusResponse {
  connected: boolean;
  folders?: string[];
  error?: string;
}

interface SummaryResult {
  summary: string;
  bullets: string[];
  suggestedAction?: string;
}

type View = 'notconnected' | 'syncing' | 'error' | 'filled';
type Tr = (id: string) => string;

const TRIAGE_VAR: Record<TriageLabel, string> = {
  action: 'var(--em-action)',
  waiting: 'var(--em-waiting)',
  archive: 'var(--em-archive)',
};

const FOLDER = 'INBOX';

export default function EmailPanel() {
  const { _: rawT } = useLingui();
  const _: Tr = (id: string) => rawT(id);
  const { theme } = useTheme();

  const [view, setView] = useState<View>('syncing');
  const [statusError, setStatusError] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<MessageRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [summaries, setSummaries] = useState<Record<string, SummaryResult>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeText, setComposeText] = useState('');
  const [sendState, setSendState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [sendError, setSendError] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setView('syncing');
    setStatusError(undefined);
    try {
      const status = (await api.get('/api/modules/email/status')) as StatusResponse;
      if (!status.connected) {
        setMessages([]);
        setStatusError(status.error);
        setView(status.error ? 'error' : 'notconnected');
        return;
      }
      const res = (await api.get(`/api/modules/email/messages?folder=${FOLDER}`)) as {
        messages: MessageRecord[];
        connected: boolean;
        error?: string;
      };
      setMessages(res.messages ?? []);
      if (!res.connected && res.error) {
        setStatusError(res.error);
        setView('error');
        return;
      }
      setView('filled');
    } catch {
      // Fallback text comes from the JSX (`statusError || _('email.state.error')`)
      // so `load` doesn't need `_` in its deps — `_`'s identity is unstable across
      // renders, and including it here caused a reload loop (every re-render made
      // a new `load`, which the mount effect re-ran, snapping the view back to
      // "syncing" on any state change).
      setStatusError(undefined);
      setView('error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(() => messages.find((m) => m.id === selectedId) ?? null, [messages, selectedId]);

  const triageLabel = (t: TriageLabel) => _(`email.triage.${t}`);

  const summarizeSelected = useCallback(async () => {
    if (!selected) return;
    try {
      const out = (await api.post(`/api/modules/email/messages/${selected.id}/summarize`)) as SummaryResult;
      setSummaries((prev) => ({ ...prev, [selected.id]: out }));
    } catch {
      /* summary is best-effort — the message body is still readable without it */
    }
  }, [selected]);

  const draftSelected = useCallback(async () => {
    if (!selected) return;
    try {
      const out = (await api.post(`/api/modules/email/messages/${selected.id}/draft`, {})) as { draft: string };
      setDrafts((prev) => ({ ...prev, [selected.id]: out.draft }));
    } catch {
      /* draft is best-effort — never touches SMTP either way */
    }
  }, [selected]);

  const openCompose = useCallback(() => {
    if (selected) {
      setComposeTo(selected.from);
      setComposeSubject(selected.subject.startsWith('Re:') ? selected.subject : `Re: ${selected.subject}`);
      setComposeText(drafts[selected.id] ?? '');
    } else {
      setComposeTo('');
      setComposeSubject('');
      setComposeText('');
    }
    setSendState('idle');
    setSendError(undefined);
    setComposeOpen(true);
  }, [selected, drafts]);

  const submitSend = useCallback(async () => {
    setSendState('sending');
    setSendError(undefined);
    try {
      const to = composeTo
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
      await api.post('/api/modules/email/send', { to, subject: composeSubject, text: composeText });
      setSendState('sent');
    } catch (e) {
      setSendState('error');
      setSendError(e instanceof Error ? e.message : 'send failed');
    }
  }, [composeTo, composeSubject, composeText]);

  return (
    <section aria-label="email-panel" className="email-scope" data-theme={theme}>
      <style>{`
        .email-scope[data-theme="dark"] {
          --em-app: #0b0c11; --em-panel: #12131c; --em-elev: #181927; --em-line: rgba(255,255,255,.09);
          --em-tx1: #e8e9f0; --em-tx2: #9a9cb0; --em-tx3: #63657c;
          --em-acc: #6366f1; --em-acc-h: #818cf8; --em-acc-soft: rgba(99,102,241,.14); --em-acc-line: rgba(99,102,241,.4);
          --em-action: #f8b74d; --em-waiting: #5cc8f5; --em-archive: #71738a; --em-danger: #fb7185;
          color: var(--em-tx1);
        }
        .email-scope[data-theme="light"] {
          --em-app: #eef0f5; --em-panel: #ffffff; --em-elev: #f5f6f9; --em-line: rgba(12,14,22,.1);
          --em-tx1: #15161e; --em-tx2: #565a6c; --em-tx3: #8b8f9f;
          --em-acc: #6366f1; --em-acc-h: #4f46e5; --em-acc-soft: rgba(99,102,241,.1); --em-acc-line: rgba(99,102,241,.32);
          --em-action: #b45309; --em-waiting: #0369a1; --em-archive: #71738a; --em-danger: #e11d48;
          color: var(--em-tx1);
        }
        .email-scope .em-mono { font-family: var(--font-mono, ui-monospace, monospace); }
        @keyframes emScan { 0% { transform: translateX(-120%); } 100% { transform: translateX(420%); } }
      `}</style>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Mail className="w-4 h-4" style={{ color: 'var(--em-acc-h)' }} />
        <span style={{ fontWeight: 700, fontSize: 14 }}>{_('app.tab.email')}</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={openCompose}
          disabled={view !== 'filled'}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--em-acc)', color: '#fff',
            border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12.5, fontWeight: 600,
            cursor: view === 'filled' ? 'pointer' : 'not-allowed', opacity: view === 'filled' ? 1 : 0.5,
          }}
        >
          <Send className="w-3.5 h-3.5" /> {_('email.compose.open')}
        </button>
        <button
          onClick={() => void load()}
          style={{
            display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'var(--em-tx2)',
            border: '1px solid var(--em-acc-line)', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
          }}
        >
          <RefreshCw className="w-3.5 h-3.5" /> {_('email.refresh')}
        </button>
      </div>

      {/* ── SYNCING ── */}
      {view === 'syncing' && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'relative', overflow: 'hidden', background: 'var(--em-panel)',
            border: '1px solid var(--em-acc-line)', borderRadius: 14, padding: '22px 20px',
          }}
        >
          <div
            style={{
              position: 'absolute', top: 0, left: 0, height: 2, width: '26%',
              background: 'linear-gradient(90deg,transparent,var(--em-acc),transparent)',
              animation: 'emScan 0.85s linear infinite',
            }}
          />
          <div className="em-mono" style={{ color: 'var(--em-acc-h)', fontSize: 12 }}>
            {_('email.state.syncing')}
          </div>
        </div>
      )}

      {/* ── NOT CONNECTED ── */}
      {view === 'notconnected' && (
        <div
          style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center',
            background: 'var(--em-panel)', border: '1px solid var(--em-line)', borderRadius: 12, padding: '40px 24px',
          }}
        >
          <Inbox className="w-6 h-6" style={{ color: 'var(--em-tx3)' }} />
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{_('email.state.notConnected')}</div>
          <div style={{ fontSize: 12, color: 'var(--em-tx3)', maxWidth: 420 }}>{_('email.state.notConnectedHint')}</div>
        </div>
      )}

      {/* ── ERROR ── */}
      {view === 'error' && (
        <div
          role="alert"
          style={{
            display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(251,113,133,0.08)',
            border: '1px solid var(--em-danger)', borderRadius: 12, padding: '16px 18px', color: 'var(--em-danger)',
          }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span style={{ flex: 1, fontSize: 13 }}>{statusError || _('email.state.error')}</span>
          <button
            onClick={() => void load()}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'var(--em-acc-h)',
              border: '1px solid var(--em-acc-line)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer',
            }}
          >
            <RefreshCw className="w-3.5 h-3.5" /> {_('email.retry')}
          </button>
        </div>
      )}

      {/* ── FILLED ── */}
      {view === 'filled' && (
        messages.length === 0 ? (
          <div
            style={{
              textAlign: 'center', color: 'var(--em-tx3)', background: 'var(--em-panel)',
              border: '1px solid var(--em-line)', borderRadius: 12, padding: '40px 20px', fontSize: 13,
            }}
          >
            {_('email.state.empty')}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 14, minHeight: 0 }}>
            {/* message list */}
            <ul
              style={{
                listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6,
                flex: '0 0 320px',
              }}
            >
              {messages.map((m) => (
                <li key={m.id}>
                  <button
                    data-message-row
                    aria-current={m.id === selectedId}
                    onClick={() => setSelectedId(m.id)}
                    style={{
                      width: '100%', textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 4,
                      background: m.id === selectedId ? 'var(--em-acc-soft)' : 'var(--em-panel)',
                      border: `1px solid ${m.id === selectedId ? 'var(--em-acc-line)' : 'var(--em-line)'}`,
                      borderRadius: 10, padding: '10px 12px', cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 13, color: 'var(--em-tx1)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {m.subject}
                      </span>
                      {/* TEXT-based triage badge, not color-only (a11y, PIPELINE-LESSONS #9). */}
                      <span
                        className="em-mono"
                        style={{
                          fontSize: 10, fontWeight: 700, color: TRIAGE_VAR[m.triage], background: 'var(--em-elev)',
                          border: '1px solid var(--em-line)', borderRadius: 6, padding: '2px 6px', flex: '0 0 auto',
                        }}
                      >
                        {triageLabel(m.triage)}
                      </span>
                    </div>
                    <span className="em-mono" style={{ fontSize: 10.5, color: 'var(--em-tx3)' }}>{m.from}</span>
                    <span style={{ fontSize: 11.5, color: 'var(--em-tx2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {m.snippet}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {/* reading column */}
            <div style={{ flex: 1, minWidth: 0, background: 'var(--em-panel)', border: '1px solid var(--em-line)', borderRadius: 12, padding: 16 }}>
              {!selected ? (
                <div style={{ color: 'var(--em-tx3)', fontSize: 13 }}>{_('email.state.selectAMessage')}</div>
              ) : (
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{selected.subject}</div>
                  <div className="em-mono" style={{ fontSize: 11.5, color: 'var(--em-tx3)', marginTop: 6 }}>
                    {selected.from} · {selected.date}
                  </div>

                  <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                    <button
                      onClick={() => void summarizeSelected()}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--em-acc-soft)',
                        color: 'var(--em-acc-h)', border: '1px solid var(--em-acc-line)', borderRadius: 8,
                        padding: '6px 11px', fontSize: 12, cursor: 'pointer',
                      }}
                    >
                      <Sparkles className="w-3.5 h-3.5" /> {_('email.ai.summarize')}
                    </button>
                    <button
                      onClick={() => void draftSelected()}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6, background: 'transparent',
                        color: 'var(--em-tx2)', border: '1px solid var(--em-line)', borderRadius: 8,
                        padding: '6px 11px', fontSize: 12, cursor: 'pointer',
                      }}
                    >
                      <Sparkles className="w-3.5 h-3.5" /> {_('email.ai.draft')}
                    </button>
                  </div>

                  {summaries[selected.id] && (
                    <div
                      role="note"
                      aria-label="email-ai-summary"
                      style={{
                        marginTop: 12, borderRadius: 12, border: '1px solid var(--em-acc-line)',
                        background: 'linear-gradient(160deg, var(--em-acc-soft), transparent)', padding: 13,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                        <Sparkles className="w-3.5 h-3.5" style={{ color: 'var(--em-acc-h)' }} />
                        <span style={{ fontSize: 11.5, fontWeight: 700 }}>{_('email.ai.summaryTitle')}</span>
                        <span style={{ flex: 1 }} />
                        {/* honest $0/model badge — matches design.html's AI Summary card */}
                        <span className="em-mono" style={{ fontSize: 10, color: 'var(--em-tx3)' }}>
                          $0 · qwen3:8b
                        </span>
                      </div>
                      <p style={{ fontSize: 12.5, color: 'var(--em-tx1)', marginTop: 8, lineHeight: 1.55 }}>
                        {summaries[selected.id].summary}
                      </p>
                      {summaries[selected.id].bullets.length > 0 && (
                        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                          {summaries[selected.id].bullets.map((b, i) => (
                            <li key={i} style={{ fontSize: 11.5, color: 'var(--em-tx2)' }}>{b}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  <p style={{ fontSize: 13, color: 'var(--em-tx2)', lineHeight: 1.65, marginTop: 14, whiteSpace: 'pre-wrap' }}>
                    {selected.bodyText}
                  </p>

                  {drafts[selected.id] && (
                    <div
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, padding: '9px 12px',
                        borderRadius: 10, border: '1px solid var(--em-line)', background: 'var(--em-elev)',
                      }}
                    >
                      <Paperclip className="w-3.5 h-3.5" style={{ color: 'var(--em-acc-h)', flex: '0 0 auto' }} />
                      <span style={{ flex: 1, fontSize: 12, color: 'var(--em-tx2)' }}>{drafts[selected.id]}</span>
                      <button
                        onClick={openCompose}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 6, background: 'var(--em-acc)',
                          color: '#fff', border: 'none', borderRadius: 8, padding: '7px 12px', fontSize: 12,
                          fontWeight: 600, cursor: 'pointer', flex: '0 0 auto',
                        }}
                      >
                        <Send className="w-3.5 h-3.5" /> {_('email.compose.open')}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )
      )}

      {/* ── COMPOSE (docked modal) ── */}
      {composeOpen && (
        <div
          role="dialog"
          aria-label="email-compose-modal"
          aria-modal="true"
          style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex',
            alignItems: 'flex-end', justifyContent: 'center', zIndex: 50,
          }}
        >
          <div
            style={{
              width: 'min(560px, 96vw)', background: 'var(--em-panel)', border: '1px solid var(--em-line)',
              borderRadius: '16px 16px 0 0', padding: 18, boxShadow: '0 -20px 60px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 13.5 }}>{_('email.compose.title')}</span>
              <span style={{ flex: 1 }} />
              <button
                aria-label={_('email.compose.close')}
                onClick={() => setComposeOpen(false)}
                style={{ background: 'transparent', border: 'none', color: 'var(--em-tx2)', cursor: 'pointer' }}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <label style={{ display: 'block', fontSize: 11, color: 'var(--em-tx3)', marginBottom: 4 }}>
              {_('email.compose.to')}
            </label>
            <input
              value={composeTo}
              onChange={(e) => setComposeTo(e.target.value)}
              placeholder="name@example.com"
              style={{
                width: '100%', boxSizing: 'border-box', background: 'var(--em-elev)', color: 'var(--em-tx1)',
                border: '1px solid var(--em-line)', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 10,
              }}
            />

            <label style={{ display: 'block', fontSize: 11, color: 'var(--em-tx3)', marginBottom: 4 }}>
              {_('email.compose.subject')}
            </label>
            <input
              value={composeSubject}
              onChange={(e) => setComposeSubject(e.target.value)}
              style={{
                width: '100%', boxSizing: 'border-box', background: 'var(--em-elev)', color: 'var(--em-tx1)',
                border: '1px solid var(--em-line)', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 10,
              }}
            />

            <label style={{ display: 'block', fontSize: 11, color: 'var(--em-tx3)', marginBottom: 4 }}>
              {_('email.compose.body')}
            </label>
            <textarea
              value={composeText}
              onChange={(e) => setComposeText(e.target.value)}
              rows={5}
              style={{
                width: '100%', boxSizing: 'border-box', background: 'var(--em-elev)', color: 'var(--em-tx1)',
                border: '1px solid var(--em-line)', borderRadius: 8, padding: '8px 10px', fontSize: 13, marginBottom: 10,
                fontFamily: 'inherit', resize: 'vertical',
              }}
            />

            {sendState === 'error' && (
              <div role="alert" style={{ fontSize: 12, color: 'var(--em-danger)', marginBottom: 8 }}>
                {sendError || _('email.compose.sendError')}
              </div>
            )}
            {sendState === 'sent' && (
              <div role="status" style={{ fontSize: 12, color: 'var(--em-acc-h)', marginBottom: 8 }}>
                {_('email.compose.sent')}
              </div>
            )}

            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <button
                onClick={() => void submitSend()}
                disabled={sendState === 'sending'}
                aria-label={_('email.compose.send')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 7, background: 'var(--em-acc)', color: '#fff',
                  border: 'none', borderRadius: 10, padding: '10px 16px', fontSize: 13, fontWeight: 700,
                  cursor: sendState === 'sending' ? 'not-allowed' : 'pointer', opacity: sendState === 'sending' ? 0.6 : 1,
                }}
              >
                <Send className="w-3.5 h-3.5" /> {_('email.compose.send')}
              </button>
              <span className="em-mono" style={{ fontSize: 10, color: 'var(--em-tx3)' }}>
                {_('email.compose.privilegedNote')}
              </span>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
