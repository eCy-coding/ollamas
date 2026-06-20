import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/apiClient';
import { seriesToCalls, type UsageSummary, type UsageSeriesPoint } from '../lib/usage';

// vF12 — tenant self-service usage via the choke-point (Bearer apiKey). 401/403
// (no tenant key) is a first-class state, not an error. Timeseries is best-effort
// so the panel still renders if only the summary is available.
export type UsageState = 'loading' | 'ok' | 'unauthorized' | 'error';

interface UseUsageResult {
  usage: UsageSummary | null;
  series: number[];
  state: UsageState;
  error: string | null;
  refetch: () => void;
}

export function useUsage(): UseUsageResult {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [series, setSeries] = useState<number[]>([]);
  const [state, setState] = useState<UsageState>('loading');
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchOnce = useCallback(async () => {
    try {
      const u = await api.get<UsageSummary>('/api/saas/self/usage', { retries: 1 });
      if (!mountedRef.current) return;
      setUsage(u);
      setState('ok');
      setError(null);
      try {
        const ts = await api.get<{ series: UsageSeriesPoint[] }>('/api/saas/usage/timeseries', { retries: 1 });
        if (mountedRef.current) setSeries(seriesToCalls(ts?.series));
      } catch {
        if (mountedRef.current) setSeries([]);
      }
    } catch (e) {
      if (!mountedRef.current) return;
      const status = (e as { status?: number }).status;
      if (status === 401 || status === 403) {
        setState('unauthorized');
        setError(null);
      } else {
        setState('error');
        setError(e instanceof Error ? e.message : 'usage fetch failed');
      }
    }
  }, []);

  const refetch = useCallback(() => {
    setState('loading');
    void fetchOnce();
  }, [fetchOnce]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchOnce();
    return () => {
      mountedRef.current = false;
    };
  }, [fetchOnce]);

  return { usage, series, state, error, refetch };
}
