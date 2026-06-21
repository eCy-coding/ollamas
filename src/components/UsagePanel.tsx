import { useState } from 'react';
import { useLingui } from '@lingui/react';
import { CreditCard, ArrowUpCircle } from 'lucide-react';
import { api } from '../lib/apiClient';
import { useUsage } from '../hooks/useUsage';
import { usageRatio, usageStatus, usagePercent } from '../lib/usage';
import { UsageMeter } from './UsageMeter';
import { Sparkline } from './Sparkline';
import { Skeleton } from './Skeleton';

// vF12 — tenant self-service usage + Stripe billing. Billing endpoints return a
// redirect {url} (or 501 / no-url when Stripe isn't configured → graceful note);
// no Stripe SDK on the client.
export function UsagePanel() {
  const { _ } = useLingui();
  const { usage, series, state, error, refetch } = useUsage();
  const [billingNote, setBillingNote] = useState<'idle' | 'notConfigured' | 'error'>('idle');
  const [billingBusy, setBillingBusy] = useState(false);

  const openBilling = async (endpoint: string) => {
    setBillingBusy(true);
    setBillingNote('idle');
    try {
      const r = await api.post<{ url?: string }>(endpoint, {});
      if (r?.url) {
        try {
          window.location.assign(r.url);
        } catch {
          setBillingNote('error');
        }
        return;
      }
      setBillingNote('notConfigured');
    } catch (e) {
      const status = (e as { status?: number }).status;
      setBillingNote(status === 501 ? 'notConfigured' : 'error');
    } finally {
      setBillingBusy(false);
    }
  };

  if (state === 'loading') {
    return (
      <section aria-busy="true" aria-label={_('app.usage.title')} className="space-y-3">
        <Skeleton height="5rem" />
      </section>
    );
  }

  if (state === 'unauthorized') {
    return (
      <section aria-label={_('app.usage.title')} className="bg-immersive-panel border border-immersive-border rounded p-6 text-center">
        <p className="text-xs text-immersive-text-muted font-mono">{_('app.usage.connectKey')}</p>
      </section>
    );
  }

  if (state === 'error') {
    return (
      <section aria-label={_('app.usage.title')}>
        <p role="alert" className="text-xs text-status-err bg-rose-500/10 border border-rose-500/20 rounded px-3 py-2 font-mono">
          {error ?? _('app.usage.loadError')}
        </p>
      </section>
    );
  }

  const ratio = usage ? usageRatio(usage.used, usage.quota) : 0;
  const status = usageStatus(ratio);
  const percent = usagePercent(ratio);
  const unlimited = !usage || usage.quota <= 0;

  return (
    <section aria-label={_('app.usage.title')} className="bg-immersive-sidebar border border-immersive-border rounded p-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold font-mono uppercase tracking-wider text-immersive-text-bright">{_('app.usage.title')}</h3>
        <span className="text-[10px] font-mono text-immersive-text-dim uppercase">
          {_('app.usage.plan')}: {usage?.plan ?? '—'} · {_('app.usage.period')}: {usage?.period ?? '—'}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px] font-mono text-immersive-text-muted">
          <span>
            {_('app.usage.used')}: {usage?.used ?? 0} / {unlimited ? _('app.usage.unlimited') : usage?.quota}
          </span>
          {!unlimited && <span className={status === 'over' ? 'text-status-err' : status === 'warn' ? 'text-status-warn' : 'text-status-ok'}>{percent}%</span>}
        </div>
        <UsageMeter percent={percent} status={status} label={_('app.usage.meterLabel')} />
      </div>

      {series.length > 0 && (
        <div>
          <div className="text-[10px] text-immersive-text-dim font-mono uppercase tracking-widest mb-1">{_('app.usage.trend')}</div>
          <div className="text-immersive-text-muted">
            <Sparkline data={series} width={320} height={28} ariaLabel={_('app.usage.trend')} className="w-full" />
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={billingBusy}
          onClick={() => void openBilling('/api/billing/portal')}
          className="flex items-center gap-2 text-xs font-mono border border-immersive-border rounded px-3 py-1.5 text-immersive-text-muted hover:text-immersive-text-bright transition-colors disabled:opacity-50"
        >
          <CreditCard className="w-4 h-4" />
          {_('app.usage.manageBilling')}
        </button>
        <button
          type="button"
          disabled={billingBusy}
          onClick={() => void openBilling('/api/billing/checkout')}
          className="flex items-center gap-2 text-xs font-mono border border-immersive-border rounded px-3 py-1.5 text-immersive-text-muted hover:text-immersive-text-bright transition-colors disabled:opacity-50"
        >
          <ArrowUpCircle className="w-4 h-4" />
          {_('app.usage.upgrade')}
        </button>
        {billingNote === 'notConfigured' && <span className="text-[11px] font-mono text-status-warn">{_('app.usage.notConfigured')}</span>}
        {billingNote === 'error' && (
          <span role="alert" className="text-[11px] font-mono text-status-err">
            {_('app.usage.loadError')}{' '}
            <button type="button" onClick={refetch} className="underline">↻</button>
          </span>
        )}
      </div>
    </section>
  );
}
