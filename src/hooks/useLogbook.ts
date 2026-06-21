import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/apiClient';
import type { LogEntry, LogbookResponse } from '../lib/observability';

// vF10 — fetch /api/logbook through the choke-point (auth + GET retries). Optional
// polling skips when the tab is hidden (energy budget, App.fetchTelemetry pattern);
// unmount guard prevents post-unmount setState (vF8 FE-017 lesson).
interface UseLogbookOpts {
  limit?: number;
  pollMs?: number;
}
interface UseLogbookResult {
  entries: LogEntry[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useLogbook({ limit = 200, pollMs = 0 }: UseLogbookOpts = {}): UseLogbookResult {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchOnce = useCallback(
    async (silent: boolean) => {
      if (silent && typeof document !== 'undefined' && document.hidden) return;
      try {
        const data = await api.get<LogbookResponse>(`/api/logbook?limit=${limit}`, { retries: 2 });
        if (!mountedRef.current) return;
        setEntries(Array.isArray(data?.entries) ? data.entries : []);
        setError(null);
      } catch (e) {
        if (!mountedRef.current) return;
        setError(e instanceof Error ? e.message : 'logbook fetch failed');
      } finally {
        if (mountedRef.current) setIsLoading(false);
      }
    },
    [limit],
  );

  const refetch = useCallback(() => void fetchOnce(false), [fetchOnce]);

  useEffect(() => {
    mountedRef.current = true;
    void fetchOnce(false);
    let id: ReturnType<typeof setInterval> | undefined;
    if (pollMs > 0) id = setInterval(() => void fetchOnce(true), pollMs);
    return () => {
      mountedRef.current = false;
      if (id) clearInterval(id);
    };
  }, [fetchOnce, pollMs]);

  return { entries, isLoading, error, refetch };
}
