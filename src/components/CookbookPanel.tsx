// O7 Cookbook — hardware-aware local-model recommendations (PILOT panel of the
// HANDOFF-PIPELINE). Ported from docs/odyssey/handoff/cookbook/design.html
// (Golden Rule: reference, not verbatim). Data comes from the backend module via
// apiClient (/api/modules/cookbook/recommend) — never a hard-coded catalog.
//
// THEME: the eCy design palette is scoped to `.cookbook-scope` (component-local
// CSS vars), so no raw hex leaks into global CSS. FONTS: Space Grotesk / DM Sans
// are NOT imported here (PWA/CSP — no Google @import); the panel falls back to the
// existing font stack until the shared font-selfhost step lands.
import { Fragment, useCallback, useEffect, useState } from 'react';
import { useLingui } from '@lingui/react';
import { RefreshCw, Sparkles, Download, Check, AlertTriangle, Cpu } from 'lucide-react';
import { api } from '../lib/apiClient';

interface ScoredModel {
  id: string;
  family: string;
  role: string;
  params: number;
  quant: string;
  ctx: number;
  ctxMax: number;
  fit: number;
  tier: 'excellent' | 'good' | 'tight' | 'wont';
  badge: 'fit' | 'tight' | 'wont';
  fits: boolean;
  headroomLabel: string;
  installed: boolean;
  reason: string;
  why: string;
  sizeLabel: string;
  config: { numCtx: number; keepAlive: string };
  estTokS?: number;
  measured?: boolean;
}

interface Hardware {
  ramGb: number;
  usableGb: number;
  cores: number;
  chip: string;
  metal: boolean;
  memType: string;
  accelLabel: string;
  name: string;
  sub: string;
}

interface Recommendation {
  hardware: Hardware | null;
  ruleClass?: string;
  primary: ScoredModel | null;
  alternatives: ScoredModel[];
  fallback: ScoredModel | null;
}

const TIER_COLOR: Record<ScoredModel['tier'], string> = {
  excellent: '#00D4FF',
  good: '#00C896',
  tight: '#F5A623',
  wont: '#FF4757',
};

type Tr = (id: string) => string;

export default function CookbookPanel() {
  const { _: rawT } = useLingui();
  // The lingui `_` is overloaded; narrow it to a plain id→string for child props
  // (keeps JSX `key` handling on the sub-components clean).
  const _: Tr = (id: string) => rawT(id);
  const [data, setData] = useState<Recommendation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const rec = await api.get<Recommendation>('/api/modules/cookbook/recommend');
      setData(rec);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const tierLabel = (t: ScoredModel['tier']) => _(`cookbook.tier.${t}`);

  return (
    <section aria-label="cookbook-panel" className="cookbook-scope">
      <style>{`
        .cookbook-scope {
          --cb-bg: #0D1B2E; --cb-raised: #132338; --cb-accent: #00D4FF;
          --cb-violet: #7B5EA7; --cb-ok: #00C896; --cb-warn: #F5A623; --cb-err: #FF4757;
          --cb-fg: #F0F4FF; --cb-muted: #8A9BB0; --cb-dim: #536882;
          --cb-border: rgba(255,255,255,0.08); --cb-border-accent: rgba(0,212,255,0.30);
          color: var(--cb-fg);
        }
        .cookbook-scope .cb-eyebrow { font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; font-weight: 600; }
        .cookbook-scope .cb-mono { font-family: var(--font-mono, ui-monospace, monospace); }
        @keyframes cbScan { 0% { transform: translateX(-120%); } 100% { transform: translateX(420%); } }
      `}</style>

      {/* ── LOADING ── */}
      {loading && (
        <div role="status" aria-live="polite"
          style={{ position: 'relative', overflow: 'hidden', background: 'var(--cb-bg)', border: '1px solid var(--cb-border-accent)', borderRadius: 14, padding: '22px 20px' }}>
          <div style={{ position: 'absolute', top: 0, left: 0, height: 2, width: '26%', background: 'linear-gradient(90deg,transparent,var(--cb-accent),transparent)', animation: 'cbScan 0.85s linear infinite' }} />
          <div className="cb-mono" style={{ color: 'var(--cb-accent)', fontSize: 12 }}>{_('cookbook.state.loading')}</div>
        </div>
      )}

      {/* ── ERROR ── */}
      {!loading && error && (
        <div role="alert"
          style={{ display: 'flex', alignItems: 'center', gap: 12, background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)', borderRadius: 12, padding: '16px 18px', color: 'var(--cb-warn)' }}>
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span style={{ flex: 1, fontSize: 13 }}>{_('cookbook.state.error')}</span>
          <button onClick={() => void load()}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'var(--cb-accent)', border: '1px solid var(--cb-border-accent)', borderRadius: 8, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
            <RefreshCw className="w-3.5 h-3.5" /> {_('cookbook.retry')}
          </button>
        </div>
      )}

      {/* ── EMPTY ── */}
      {!loading && !error && data && !data.primary && (
        <div style={{ textAlign: 'center', color: 'var(--cb-muted)', background: 'var(--cb-bg)', border: '1px solid var(--cb-border)', borderRadius: 12, padding: '40px 20px', fontSize: 13 }}>
          {_('cookbook.state.empty')}
        </div>
      )}

      {/* ── FILLED ── */}
      {!loading && !error && data && data.primary && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Sparkles className="w-4 h-4" style={{ color: 'var(--cb-accent)' }} />
              <span style={{ fontSize: 15, fontWeight: 600 }}>{_('cookbook.title')}</span>
              <span className="cb-mono" style={{ fontSize: 10, color: 'var(--cb-accent)', background: 'rgba(0,212,255,0.10)', border: '1px solid var(--cb-border-accent)', borderRadius: 5, padding: '2px 7px' }}>{_('cookbook.subtitle')}</span>
            </div>
            <button onClick={() => void load()}
              style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'transparent', color: 'var(--cb-muted)', border: '1px solid var(--cb-border)', borderRadius: 7, padding: '6px 12px', fontSize: 12, cursor: 'pointer' }}>
              <RefreshCw className="w-3.5 h-3.5" /> {_('cookbook.redetect')}
            </button>
          </div>

          {/* hardware card */}
          {data.hardware && (
            <section style={{ background: 'linear-gradient(180deg, rgba(19,35,56,0.9), rgba(13,27,46,0.65))', border: '1px solid var(--cb-border-accent)', borderRadius: 14, padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cb-ok)' }} />
                <span className="cb-eyebrow" style={{ color: 'var(--cb-accent)' }}>{_('cookbook.hardware.eyebrow')}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 11, marginTop: 7 }}>
                <h3 style={{ fontSize: 22, margin: 0 }}>{data.hardware.name}</h3>
                <span className="cb-mono" style={{ fontSize: 11, color: 'var(--cb-muted)', background: 'var(--cb-bg)', border: '1px solid var(--cb-border)', borderRadius: 5, padding: '3px 8px' }}>{data.hardware.sub}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginTop: 16 }}>
                <Stat label={data.hardware.memType} value={`${data.hardware.ramGb}`} unit="GB" />
                <Stat label={_('cookbook.hardware.usable')} value={`${data.hardware.usableGb}`} unit="GB" glow />
                <Stat label={data.hardware.accelLabel} value={`${data.hardware.cores}`} unit="core" />
              </div>
            </section>
          )}

          {/* recommended section header */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Sparkles className="w-4 h-4" style={{ color: 'var(--cb-accent)' }} />
            <h4 style={{ fontSize: 15, margin: 0, fontWeight: 600 }}>{_('cookbook.section.recommended')}</h4>
            <span style={{ flex: 1, height: 1, background: 'var(--cb-border)' }} />
          </div>

          {/* primary hero */}
          <PrimaryHero model={data.primary} fallback={data.fallback} tierLabel={tierLabel} _={_} />

          {/* alternatives */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
            <Cpu className="w-4 h-4" style={{ color: 'var(--cb-muted)' }} />
            <h4 style={{ fontSize: 15, margin: 0, fontWeight: 600 }}>{_('cookbook.section.alternatives')}</h4>
            <span style={{ flex: 1, height: 1, background: 'var(--cb-border)' }} />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 14 }}>
            {data.alternatives.map((m) => (
              <Fragment key={m.id}>
                <AltCard model={m} tierLabel={tierLabel} _={_} />
              </Fragment>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value, unit, glow }: { label: string; value: string; unit: string; glow?: boolean }) {
  return (
    <div style={{ background: 'var(--cb-raised)', border: `1px solid ${glow ? 'var(--cb-border-accent)' : 'var(--cb-border)'}`, borderRadius: 10, padding: '12px 14px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 5 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: glow ? 'var(--cb-accent)' : 'var(--cb-fg)' }}>{value}</span>
        <span className="cb-mono" style={{ fontSize: 11, color: 'var(--cb-muted)' }}>{unit}</span>
      </div>
      <div className="cb-mono" style={{ fontSize: 10, color: 'var(--cb-dim)', marginTop: 4 }}>{label}</div>
    </div>
  );
}

function TokLabel({ m, _ }: { m: ScoredModel; _: (id: string) => string }) {
  if (!m.estTokS) return null;
  return (
    <span className="cb-mono" style={{ fontSize: 11, color: 'var(--cb-fg)', background: 'var(--cb-raised)', borderRadius: 6, padding: '4px 9px' }}>
      ~{m.estTokS} tok/s · {m.measured ? _('cookbook.badge.measured') : _('cookbook.badge.estimated')}
    </span>
  );
}

function PrimaryHero({ model, fallback, tierLabel, _ }: { model: ScoredModel; fallback: ScoredModel | null; tierLabel: (t: ScoredModel['tier']) => string; _: Tr }) {
  return (
    <section style={{ background: 'rgba(13,27,46,0.85)', border: '1px solid var(--cb-border-accent)', borderRadius: 16, padding: '22px 24px', boxShadow: '0 0 30px rgba(0,212,255,0.1)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span className="cb-eyebrow" style={{ color: '#050A14', background: 'var(--cb-accent)', borderRadius: 9999, padding: '3px 11px' }}>{_('cookbook.primary.badge')}</span>
        <span className="cb-mono" style={{ fontSize: 10.5, color: 'var(--cb-ok)', background: 'rgba(0,200,150,0.10)', border: '1px solid rgba(0,200,150,0.25)', borderRadius: 9999, padding: '3px 10px' }}>{_('cookbook.cost.free')}</span>
        {model.installed && (
          <span className="cb-mono" style={{ fontSize: 10.5, color: 'var(--cb-ok)', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Check className="w-3 h-3" /> {_('cookbook.installed')}</span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 13, marginTop: 15 }}>
        <div style={{ fontSize: 21, fontWeight: 700, fontFamily: 'var(--font-mono, monospace)' }}>{model.id}</div>
        <span className="cb-eyebrow" style={{ color: TIER_COLOR[model.tier] }}>{tierLabel(model.tier)}</span>
        <span className="cb-mono" style={{ fontSize: 12, color: 'var(--cb-muted)' }}>{model.fit}/100 fit</span>
        <TokLabel m={model} _={_} />
      </div>

      <div style={{ marginTop: 12, fontSize: 12.5, color: '#B0BFCF', background: 'rgba(123,94,167,0.08)', border: '1px solid rgba(123,94,167,0.22)', borderRadius: 10, padding: '12px 14px' }}>
        <div className="cb-eyebrow" style={{ color: '#9B80CC', marginBottom: 6 }}>{_('cookbook.why')}</div>
        {model.why}
      </div>

      {/* action / state */}
      {model.fits ? (
        <div style={{ marginTop: 14 }}>
          {model.installed ? (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--cb-ok)', fontSize: 13, fontWeight: 600 }}>
              <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--cb-ok)' }} /> {_('cookbook.active')}
            </div>
          ) : (
            <button style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--cb-accent)', color: '#050A14', border: 'none', borderRadius: 10, padding: '11px 16px', fontSize: 13.5, fontWeight: 600, cursor: 'pointer' }}>
              <Download className="w-4 h-4" /> {_('cookbook.install.pull')} {model.id} · {model.sizeLabel}
            </button>
          )}
        </div>
      ) : (
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, color: 'var(--cb-err)', fontWeight: 600, fontSize: 13 }}>
            <AlertTriangle className="w-4 h-4" /> {_('cookbook.exceeds')}
          </div>
          {fallback && (
            <button style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8, background: 'var(--cb-accent)', color: '#050A14', border: 'none', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
              {_('cookbook.install.pull')} {fallback.id} {_('cookbook.instead')}
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function AltCard({ model, tierLabel, _ }: { model: ScoredModel; tierLabel: (t: ScoredModel['tier']) => string; _: Tr }) {
  return (
    <div style={{ background: 'rgba(13,27,46,0.7)', border: '1px solid var(--cb-border)', borderRadius: 13, padding: '15px 16px', display: 'flex', flexDirection: 'column', gap: 10, opacity: !model.fits && !model.installed ? 0.6 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="cb-mono" style={{ fontSize: 14, fontWeight: 600 }}>{model.id}</div>
          <div style={{ fontSize: 11, color: 'var(--cb-dim)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{model.role}</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: TIER_COLOR[model.tier], lineHeight: 1 }}>{model.fit}</div>
          <div className="cb-mono" style={{ fontSize: 9, color: 'var(--cb-dim)' }}>/ 100</div>
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="cb-eyebrow" style={{ color: TIER_COLOR[model.tier] }}>{tierLabel(model.tier)}</span>
        <span className="cb-mono" style={{ fontSize: 10.5, color: 'var(--cb-muted)' }}>{model.headroomLabel}</span>
      </div>
      <div style={{ height: 5, borderRadius: 9999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${model.fit}%`, background: TIER_COLOR[model.tier], borderRadius: 9999 }} />
      </div>
      <p style={{ margin: 0, fontSize: 11.5, lineHeight: 1.5, color: 'var(--cb-muted)', minHeight: 34 }}>{model.reason}</p>
      <div style={{ marginTop: 'auto' }}>
        {model.installed ? (
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--cb-ok)', fontSize: 12, fontWeight: 600 }}><Check className="w-3.5 h-3.5" /> {_('cookbook.installed')}</div>
        ) : model.fits ? (
          <button style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: 'rgba(0,212,255,0.10)', color: 'var(--cb-accent)', border: '1px solid var(--cb-border-accent)', borderRadius: 8, padding: 8, fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
            <Download className="w-3.5 h-3.5" /> {_('cookbook.install.pull')} · {model.sizeLabel}
          </button>
        ) : (
          <div style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7, background: 'rgba(255,71,87,0.06)', color: 'var(--cb-err)', border: '1px solid rgba(255,71,87,0.2)', borderRadius: 8, padding: 8, fontSize: 11.5, fontWeight: 600 }}>
            <AlertTriangle className="w-3 h-3" /> {model.headroomLabel}
          </div>
        )}
      </div>
    </div>
  );
}
