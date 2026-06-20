import { useLingui } from '@lingui/react';
import { RotateCw, Activity } from 'lucide-react';
import { useLogbook } from '../hooks/useLogbook';
import {
  vitalsSummary,
  errorCounts,
  totalErrors,
  errorBuckets,
  healthVerdict,
  frontendEvents,
  type Rating,
  type Verdict,
  type ErrorCategory,
  type VitalMetric,
} from '../lib/observability';
import { Sparkline } from './Sparkline';
import { Skeleton } from './Skeleton';

const RATING_COLOR: Record<Rating, string> = {
  good: 'text-emerald-400',
  'needs-improvement': 'text-amber-400',
  poor: 'text-rose-400',
};

const VERDICT_COLOR: Record<Verdict, string> = {
  healthy: 'text-emerald-400 border-emerald-500/30 bg-emerald-500/10',
  degraded: 'text-amber-400 border-amber-500/30 bg-amber-500/10',
  critical: 'text-rose-400 border-rose-500/30 bg-rose-500/10',
};

const ERROR_CATEGORIES: ErrorCategory[] = ['react', 'window', 'unhandled', 'api'];

function formatVital(metric: VitalMetric, value: number | null): string {
  if (value === null) return '—';
  if (metric === 'CLS') return value.toFixed(3);
  return `${Math.round(value)}ms`;
}

// vF10 — in-cockpit RUM. Reads /api/logbook, derives p75 web-vitals + client-error
// rate + a health verdict (self-heal-lite). Theme-aware (token utilities), so it
// reads in both light and dark.
export function ObservabilityPanel() {
  const { _ } = useLingui();
  const { entries, isLoading, error, refetch } = useLogbook({ limit: 200 });

  if (isLoading) {
    return (
      <section aria-busy="true" aria-label={_('app.obs.title')} className="space-y-3">
        <Skeleton height="4rem" />
        <Skeleton height="6rem" />
      </section>
    );
  }

  const vitals = vitalsSummary(entries);
  const counts = errorCounts(entries);
  const errsTotal = totalErrors(counts);
  const health = healthVerdict(vitals, counts);
  const buckets = errorBuckets(entries, Date.now(), 60_000, 20);
  const recent = frontendEvents(entries).slice(-8).reverse();

  return (
    <section aria-label={_('app.obs.title')} className="space-y-4">
      {/* Health verdict + refresh */}
      <div className={`rounded border p-4 flex items-start justify-between gap-4 ${VERDICT_COLOR[health.verdict]}`}>
        <div className="flex items-start gap-3">
          <Activity className="w-5 h-5 shrink-0 mt-0.5" />
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold font-mono uppercase tracking-wider">{_('app.obs.title')}</h3>
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full border border-current">
                {_(`app.obs.verdict.${health.verdict}`)}
              </span>
            </div>
            <p className="text-xs mt-1 text-immersive-text-muted">{_(health.reasonKey)}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={refetch}
          aria-label={_('app.obs.refresh')}
          title={_('app.obs.refresh')}
          className="text-immersive-text-muted hover:text-immersive-text-bright border border-immersive-border rounded p-1.5 transition-colors shrink-0"
        >
          <RotateCw className="w-4 h-4" />
        </button>
      </div>

      {error && (
        <p role="alert" className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2 font-mono">
          {_('app.obs.loadError')}
        </p>
      )}

      {entries.length === 0 && !error ? (
        <p className="text-xs text-immersive-text-dim font-mono py-6 text-center">{_('app.obs.noData')}</p>
      ) : (
        <>
          {/* Web Vitals p75 */}
          <div>
            <h4 className="text-[10px] text-immersive-text-dim font-mono uppercase tracking-widest font-bold mb-2">
              {_('app.obs.vitals')}
            </h4>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {vitals.map((v) => (
                <div key={v.metric} className="bg-immersive-panel border border-immersive-border rounded p-3">
                  <div className="text-[10px] text-immersive-text-dim font-mono uppercase tracking-widest">{v.metric}</div>
                  <div className={`text-lg font-bold font-mono mt-1 ${v.rating ? RATING_COLOR[v.rating] : 'text-immersive-text-dim'}`}>
                    {formatVital(v.metric, v.p75)}
                  </div>
                  <div className="text-[10px] text-immersive-text-dim font-mono mt-0.5">n={v.count}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Client errors + sparkline */}
          <div className="bg-immersive-panel border border-immersive-border rounded p-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-[10px] text-immersive-text-dim font-mono uppercase tracking-widest font-bold">
                {_('app.obs.errors')}
              </h4>
              <span className={`text-sm font-bold font-mono ${errsTotal > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{errsTotal}</span>
            </div>
            <div className={`mb-3 ${errsTotal > 0 ? 'text-rose-400' : 'text-emerald-400'}`}>
              <Sparkline data={buckets} width={320} height={28} ariaLabel={`${_('app.obs.errors')} — ${errsTotal}`} className="w-full" />
            </div>
            <div className="grid grid-cols-4 gap-2">
              {ERROR_CATEGORIES.map((cat) => (
                <div key={cat} className="text-center">
                  <div className="text-[10px] text-immersive-text-dim font-mono uppercase tracking-widest">{_(`app.obs.err.${cat}`)}</div>
                  <div className={`text-sm font-bold font-mono ${counts[cat] > 0 ? 'text-rose-400' : 'text-immersive-text-muted'}`}>{counts[cat]}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Recent events */}
          <div>
            <h4 className="text-[10px] text-immersive-text-dim font-mono uppercase tracking-widest font-bold mb-2">
              {_('app.obs.recent')}
            </h4>
            <ul className="space-y-1">
              {recent.map((e, i) => (
                <li key={`${e.ts ?? ''}-${i}`} className="flex items-center justify-between gap-3 text-[11px] font-mono bg-immersive-panel border border-immersive-border rounded px-3 py-1.5">
                  <span className="text-immersive-text-muted truncate">{String(e.note ?? e.kind ?? 'event')}</span>
                  <span className="text-immersive-text-dim shrink-0">{e.ts ? new Date(e.ts).toLocaleTimeString() : ''}</span>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </section>
  );
}
