// O2 ResearchPanel — deep_research UI tab, ported from docs/odyssey/handoff/
// research/design.html (Golden Rule: reference, not verbatim). Data comes from
// the backend module via apiClient (/api/modules/research/run) — no client-side
// fabrication of a report.
//
// THEME: the indigo-cockpit palette (design.html --accent:#6366f1 etc.) is
// scoped to `.research-scope` (component-local CSS vars) — PIPELINE-LESSONS #10,
// no raw hex leaks into global CSS. FONTS: no Google @import (PWA/CSP) —
// PIPELINE-LESSONS #11, falls back to the existing font stack via var(--font-*).
import { useCallback, useState, type KeyboardEvent } from 'react';
import { useLingui } from '@lingui/react';
import { Compass, RefreshCw, AlertTriangle, Search } from 'lucide-react';
import { api } from '../lib/apiClient';

interface Citation {
  n: number;
  title: string;
  url: string;
  domain: string;
}

interface SourceSummary {
  url: string;
  title: string;
  summary: string;
  keyPoints: string[];
}

interface RoundRecord {
  round: number;
  queries: string[];
}

interface ResearchResult {
  runId: string;
  question: string;
  report: string;
  citations: Citation[];
  sources: SourceSummary[];
  rounds: RoundRecord[];
}

type Tr = (id: string) => string;
type Status = 'idle' | 'loading' | 'error' | 'done';

const STEPS = ['plan', 'fetch', 'summarize', 'verify', 'synthesize'] as const;
const EXAMPLE_KEYS = ['research.example.privacy', 'research.example.embeddings', 'research.example.perf'];

/** Render a report string, wrapping bare `[n]` citation markers in a highlighted span
 *  so they read as inline citations rather than stray brackets (design.html §04). */
function ReportBody({ text }: { text: string }) {
  const parts = text.split(/(\[\d+\])/g);
  return (
    <p style={{ margin: 0, fontSize: 14, lineHeight: 1.7, color: 'var(--rp-fg)' }}>
      {parts.map((part, i) =>
        /^\[\d+\]$/.test(part) ? (
          <span key={i} className="rp-mono" style={{ color: 'var(--rp-accent-2)', fontWeight: 600 }}>
            {part}
          </span>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </p>
  );
}

export default function ResearchPanel() {
  const { _: rawT } = useLingui();
  const _: Tr = (id: string) => rawT(id);
  const [question, setQuestion] = useState('');
  const [deep, setDeep] = useState(true);
  const [status, setStatus] = useState<Status>('idle');
  const [result, setResult] = useState<ResearchResult | null>(null);

  const reset = useCallback(() => {
    setStatus('idle');
    setResult(null);
  }, []);

  const run = useCallback(
    async (q: string) => {
      const trimmed = q.trim();
      if (!trimmed) return;
      setStatus('loading');
      try {
        const res = await api.post<ResearchResult>('/api/modules/research/run', { question: trimmed, deep });
        setResult(res);
        setStatus('done');
      } catch {
        setStatus('error');
      }
    },
    [deep],
  );

  const onComposerKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void run(question);
    }
  };

  const onPanelKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') reset();
  };

  return (
    <section
      aria-label="research-panel"
      role="region"
      tabIndex={-1}
      onKeyDown={onPanelKeyDown}
      className="research-scope"
    >
      <style>{`
        .research-scope {
          --rp-bg: #0a0b10; --rp-canvas: #070810; --rp-surface: #101119; --rp-raised: #15161f;
          --rp-line: rgba(255,255,255,0.08); --rp-line-strong: rgba(255,255,255,0.14);
          --rp-fg: #e8eaf3; --rp-fg-2: #9498ac; --rp-fg-3: #666b7e;
          --rp-accent: #6366f1; --rp-accent-2: #818cf8; --rp-accent-dim: rgba(99,102,241,0.14);
          --rp-accent-line: rgba(99,102,241,0.38);
          --rp-ok: #34d399; --rp-warn: #f5a623; --rp-bad: #f43f5e; --rp-bad-dim: rgba(244,63,94,0.13);
          color: var(--rp-fg);
        }
        .research-scope .rp-mono { font-family: var(--font-mono, ui-monospace, monospace); }
        .research-scope .rp-eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; }
        @keyframes rpSpin { to { transform: rotate(360deg); } }
      `}</style>

      {(status === 'idle') && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <Compass className="w-4 h-4" style={{ color: 'var(--rp-accent-2)' }} />
            <span style={{ fontSize: 15, fontWeight: 600 }}>{_('research.title')}</span>
          </div>
          <div style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-line)', borderRadius: 14, padding: '14px 16px' }}>
            <textarea
              rows={2}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onComposerKeyDown}
              placeholder={_('research.placeholder')}
              style={{ width: '100%', resize: 'none', border: 'none', background: 'transparent', color: 'var(--rp-fg)', fontSize: 15, lineHeight: 1.5 }}
            />
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: 'var(--rp-fg-2)' }}>
                <input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} />
                {_('research.deep')}
              </label>
              <button
                onClick={() => void run(question)}
                style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--rp-accent)', color: '#fff', border: 'none', borderRadius: 10, padding: '10px 18px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}
              >
                <Search className="w-3.5 h-3.5" /> {_('research.submit')}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {EXAMPLE_KEYS.map((key) => (
              <button
                key={key}
                onClick={() => { setQuestion(_(key)); void run(_(key)); }}
                style={{ textAlign: 'left', fontSize: 12.5, color: 'var(--rp-fg-2)', background: 'var(--rp-surface)', border: '1px solid var(--rp-line)', borderRadius: 9999, padding: '7px 13px', cursor: 'pointer' }}
              >
                {_(key)}
              </button>
            ))}
          </div>
        </div>
      )}

      {status === 'loading' && (
        <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 10, background: 'var(--rp-surface)', border: '1px solid var(--rp-accent-line)', borderRadius: 14, padding: '18px 20px' }}>
          {STEPS.map((step) => (
            <div key={step} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--rp-fg-2)' }}>
              <RefreshCw className="w-3.5 h-3.5" style={{ color: 'var(--rp-accent-2)', animation: 'rpSpin 0.9s linear infinite' }} />
              {_(`research.step.${step}`)}
            </div>
          ))}
        </div>
      )}

      {status === 'error' && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'var(--rp-bad-dim)', border: '1px solid var(--rp-bad)', borderRadius: 12, padding: '16px 18px', color: 'var(--rp-bad)' }}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span style={{ flex: 1, fontSize: 13 }}>{_('research.state.error')}</span>
          <button
            onClick={() => void run(question)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'var(--rp-accent-2)', border: '1px solid var(--rp-accent-line)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            <RefreshCw className="w-3.5 h-3.5" /> {_('research.retry')}
          </button>
        </div>
      )}

      {status === 'done' && result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="rp-eyebrow" style={{ color: 'var(--rp-accent-2)' }}>{_('research.section.report')}</span>
            <button
              onClick={reset}
              style={{ background: 'transparent', color: 'var(--rp-fg-2)', border: '1px solid var(--rp-line-strong)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}
            >
              {_('research.new')}
            </button>
          </div>
          <div style={{ background: 'var(--rp-surface)', border: '1px solid var(--rp-line)', borderRadius: 14, padding: '18px 20px' }}>
            <ReportBody text={result.report} />
          </div>
          {result.sources.length > 0 && (
            <>
              <span className="rp-eyebrow" style={{ color: 'var(--rp-fg-3)' }}>{_('research.section.sources')}</span>
              <ul role="list" aria-label="research-sources" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {result.sources.map((s, i) => (
                  <li
                    key={s.url}
                    style={{ background: 'var(--rp-raised)', border: '1px solid var(--rp-line)', borderRadius: 10, padding: '10px 14px' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                      <span className="rp-mono" style={{ color: 'var(--rp-accent-2)', fontSize: 11 }}>[{i + 1}]</span>
                      <a href={s.url} style={{ color: 'var(--rp-fg)', fontSize: 13, fontWeight: 600, textDecoration: 'none' }}>{s.title}</a>
                    </div>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--rp-fg-2)' }}>{s.summary}</p>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}
