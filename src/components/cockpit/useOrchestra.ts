import { useEffect, useState } from "react";

// Live view-model for the $0 conductor daemon — polls GET /api/orchestra (host reads ~/.ollamas/*),
// so the cockpit shows the SAME real state as Terminal.app (`ollamas status/progress/deps`).

export interface OrchestraVM {
  live: boolean;
  phase: string | null;
  conductorModel: string | null;
  preferredModel: string | null;
  failoverCount: number;
  currentTask: string | null;
  queue: number;
  retry: { count: number; max: number } | null;
  progress: { total: number; done: number; proposed: number; pending: number } | null;
  deps: { present: number; total: number } | null;
}

const EMPTY: OrchestraVM = {
  live: false, phase: null, conductorModel: null, preferredModel: null, failoverCount: 0,
  currentTask: null, queue: 0, retry: null, progress: null, deps: null,
};

/** Poll /api/orchestra every `intervalMs` (default 5s). Never throws — a failed fetch keeps the last value. */
export function useOrchestra(intervalMs = 5000): OrchestraVM {
  const [vm, setVm] = useState<OrchestraVM>(EMPTY);
  useEffect(() => {
    let closed = false;
    const pull = async () => {
      try {
        const r = await fetch("/api/orchestra", { signal: AbortSignal.timeout(4000) });
        if (!r.ok) return;
        const j = (await r.json()) as OrchestraVM;
        if (!closed) setVm(j);
      } catch { /* keep last value */ }
    };
    pull();
    const t = setInterval(pull, intervalMs);
    return () => { closed = true; clearInterval(t); };
  }, [intervalMs]);
  return vm;
}
